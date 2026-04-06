import { initializeApp } from "firebase/app";
import { getFirestore, collection, onSnapshot, doc, setDoc, deleteDoc, query, orderBy, writeBatch } from "firebase/firestore";
import { getAuth, signInWithEmailAndPassword, onAuthStateChanged, signOut } from "firebase/auth";
import { getStorage, ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { firebaseConfig } from "./firebase-config.js";

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);
const storage = getStorage(app);

// ImgBB Config (Free Image Hosting alternative)
const IMGBB_API_KEY = "14a67838d94e610b36611cb094ba1b3e";

// Global State
let products = [];
let isAdmin = false;
let activeGenderFilter = 'Todos';
let isSaving = false; // Prevents re-renders during batch writes
let draggedProductSku = null; // For product card drag & drop
let autoScrollInterval = null; // For auto-scrolling during drag

// --- DOM Elements ---
const productsContainer = document.getElementById('products-container');
const loginModal = document.getElementById('login-modal');
const editModal = document.getElementById('edit-modal');
const btnDoLogin = document.getElementById('btn-do-login');
const btnAddProduct = document.getElementById('btn-add-product');

// --- Debounced render to avoid rapid re-renders from multiple snapshots ---
let renderTimeout = null;
function scheduleRender() {
    if (renderTimeout) clearTimeout(renderTimeout);
    renderTimeout = setTimeout(() => renderProducts(), 100);
}

// --- Real-time Products Sync ---
onSnapshot(
    collection(db, "products"),
    (snapshot) => {
        console.log(`[Magnolia] Firestore sync: ${snapshot.docs.length} productos cargados`);
        products = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id }));
        if (!isSaving) scheduleRender();
    },
    (error) => {
        console.error('[Magnolia] ERROR de Firestore:', error.code, error.message);
        // Show a visible error banner so the user knows something is wrong
        const banner = document.createElement('div');
        banner.id = 'firestore-error-banner';
        banner.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:9999;background:#dc2626;color:white;padding:16px;text-align:center;font-family:sans-serif;font-size:14px;';
        if (error.code === 'permission-denied') {
            banner.innerHTML = '⚠️ <b>Error de permisos en Firebase.</b> Las reglas de seguridad pueden haber vencido. Contactá al administrador.';
        } else {
            banner.innerHTML = `⚠️ <b>Error al cargar productos:</b> ${error.message}. Intentá recargar la página.`;
        }
        if (!document.getElementById('firestore-error-banner')) {
            document.body.prepend(banner);
        }
    }
);

// --- Auth Handling ---
onAuthStateChanged(auth, (user) => {
    isAdmin = !!user;
    document.body.classList.toggle('is-admin', isAdmin);
    if (btnAddProduct) btnAddProduct.classList.toggle('hidden', !isAdmin);
    // Show/hide filter bar is always visible to everyone
    renderProducts(); // Re-render to show/hide edit buttons
    if (isAdmin && window.location.hash === '#admin') {
        // Clean hash after successful login
        history.replaceState(null, '', window.location.pathname);
    }
});

// --- Hidden Admin Access via #admin ---
function checkAdminHash() {
    if (window.location.hash === '#admin' && !isAdmin) {
        loginModal.classList.remove('hidden');
    }
}
checkAdminHash();
window.addEventListener('hashchange', checkAdminHash);

window.showLogin = () => loginModal.classList.remove('hidden');
window.closeLoginModal = () => loginModal.classList.add('hidden');

btnDoLogin.onclick = async () => {
    const email = document.getElementById('login-email').value;
    const pass = document.getElementById('login-pass').value;
    try {
        await signInWithEmailAndPassword(auth, email, pass);
        window.closeLoginModal();
        // Clean hash so admin URL is not visible
        history.replaceState(null, '', window.location.pathname);
    } catch (e) {
        alert("Error de acceso: " + e.message);
    }
};

window.doLogout = () => signOut(auth);

// --- Gender Filter ---
window.filterByGender = (gender) => {
    activeGenderFilter = gender;
    // Update active button
    document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.classList.toggle('active', btn.textContent.includes(gender === 'Todos' ? 'Todos' : gender));
    });
    renderProducts();
};

// --- Rendering Logic ---
function renderProducts() {
    if (!productsContainer) return;
    
    // Default fallback: if this is the first load and cache is completely empty, 
    // wait for Firebase. If it's still empty, we still keep the skeleton unless we explicitly force it.
    const skeleton = document.getElementById('loading-skeleton');
    const isFirstLoad = !!skeleton;

    // Wait until products load before removing skeleton.
    // Give it a max of 2.5 seconds to wait for network products if cache is empty.
    if (isFirstLoad && products.length === 0) {
        if (!window.initialRenderTimeoutApplied) {
            window.initialRenderTimeoutApplied = true;
            setTimeout(() => {
                if (products.length === 0 && document.getElementById('loading-skeleton')) {
                    productsContainer.innerHTML = '<div style="text-align:center;padding:100px 20px;color:#6F1D1B;font-family:serif;font-size:20px;">Próximamente nuevos productos...</div>';
                }
            }, 2500);
        }
        return; 
    }
    
    // Apply gender filter
    let filteredProducts = products;
    if (activeGenderFilter !== 'Todos') {
        filteredProducts = products.filter(p => p.gender === activeGenderFilter);
    }

    // Group products by category
    const categoriesSet = new Set(filteredProducts.map(p => p.category));
    let html = '';
    let alternator = 0;

    categoriesSet.forEach(categoryName => {
        let catProducts = filteredProducts.filter(p => p.category === categoryName);
        // Sort by order field (lower = first)
        catProducts.sort((a, b) => (a.order || 0) - (b.order || 0));
        
        const catId = catProducts[0].categoryId;
        const bgColor = alternator % 2 === 0 ? 'bg-white' : 'bg-beige';
        
        let sectionHtml = `
          <section id="${catId}" class="py-20 ${bgColor}">
           <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div class="text-center mb-16">
             <span class="font-heading text-sm tracking-[0.3em] text-burgundy/60 uppercase">Colección</span>
             <h2 class="font-display text-4xl md:text-5xl text-burgundy mt-2 mb-4">${categoryName}</h2>
            </div>
            <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
        `;
        
        catProducts.forEach((product, idx) => {
          const productImages = product.images || [];
          const colorsHtml = (product.colors || []).map(c => 
            `<button class="swatch w-6 h-6 rounded-full border-2 border-white shadow-sm" style="background-color: ${c}"></button>`
          ).join('');
          
          const cardBgColor = alternator % 2 === 0 ? 'bg-beige' : 'bg-white';
          const innerBgColor = alternator % 2 === 0 ? 'bg-white' : 'bg-beige';

          // Gender badge
          const gender = product.gender || 'Unisex';
          const genderClass = gender.toLowerCase();
          const genderBadge = `<span class="gender-badge ${genderClass}">${gender}</span>`;

          let imagesHtml = '';
          if (productImages.length > 1) {
            imagesHtml = `
              <div class="swiper product-swiper w-full h-full">
                <div class="swiper-wrapper">
                  ${productImages.map(img => `<div class="swiper-slide bg-gradient-to-br from-burgundy/5 to-burgundy/15 flex items-center justify-center"><img src="${img}" alt="${product.name}" class="w-full h-full object-cover" loading="lazy"></div>`).join('')}
                </div>
                <div class="swiper-pagination"></div>
              </div>
            `;
          } else if (productImages.length === 1) {
            imagesHtml = `<div class="product-image w-full h-full bg-gradient-to-br from-burgundy/5 to-burgundy/15 flex items-center justify-center"><img src="${productImages[0]}" alt="${product.name}" class="w-full h-full object-cover" loading="lazy"></div>`;
          } else {
            imagesHtml = `<div class="product-image w-full h-full bg-gradient-to-br from-burgundy/5 to-burgundy/15 flex items-center justify-center"><span class="text-burgundy/40 text-sm">Sin imagen</span></div>`;
          }

          // Admin drag handle for reordering
          const dragHandleHtml = isAdmin ? `
            <div class="drag-handle" title="Arrastrá para reordenar">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="6" r="1.5"/><circle cx="15" cy="6" r="1.5"/><circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/><circle cx="9" cy="18" r="1.5"/><circle cx="15" cy="18" r="1.5"/></svg>
            </div>
          ` : '';

          // Admin draggable attributes
          const draggableAttr = isAdmin ? `draggable="true" data-sku="${product.sku}" data-category="${product.category}"` : '';
          
          sectionHtml += `
             <article class="product-card group ${cardBgColor} rounded-2xl overflow-hidden shadow-sm hover:shadow-xl transition-all duration-500" ${draggableAttr}>
              <div class="relative overflow-hidden aspect-square rounded-t-2xl">
                 ${isAdmin ? `<button class="edit-btn" onclick="event.stopPropagation(); openEditModal('${product.sku}')">✏️</button>` : ''}
                 ${dragHandleHtml}
                 ${imagesHtml}
              </div>
              <div class="p-6">
               <div class="flex items-center gap-2 mb-1">
                <span class="text-xs text-burgundy/60 font-medium tracking-wider">SKU: ${product.sku}</span>
                ${genderBadge}
               </div>
               <h3 class="font-display text-xl text-burgundy mt-1 mb-3">${product.name}</h3>
               <div class="flex gap-2 mb-4">${colorsHtml}</div>
               <div class="${innerBgColor} rounded-xl p-4 mb-4">
                 <div class="flex items-baseline justify-between mb-1">
                  <span class="text-xs text-gray-500 uppercase tracking-wide">Transf.</span> <span class="text-2xl font-bold text-burgundy price-transfer">${product.priceTransfer}</span>
                 </div>
                 <div class="flex items-baseline justify-between">
                  <span class="text-xs text-gray-500 uppercase tracking-wide">Tarjeta</span> <span class="text-lg text-gray-500">${product.priceCard}</span>
                 </div>
               </div>
               <div class="flex gap-2">
                 <button onclick="openWhatsApp('${product.sku}', '${product.name}', '')" class="flex-1 btn-whatsapp text-white py-3 rounded-xl text-sm font-medium flex items-center justify-center gap-2 min-h-[44px]">Pedir</button> 
                 <button onclick="openModalBySku('${product.sku}')" class="px-4 py-3 border-2 border-burgundy text-burgundy rounded-xl text-sm font-medium hover:bg-burgundy hover:text-white transition">Ver más</button>
               </div>
              </div>
             </article>
          `;
        });
        
        sectionHtml += `</div></div></section>`;
        html += sectionHtml;
        alternator++;
    });
    
    // We already checked this at the very top of renderProducts, just use the variables!
    // const skeleton = document.getElementById('loading-skeleton');
    // const isFirstLoad = !!skeleton;

    // Destroy any existing product swipers to prevent memory leaks
    document.querySelectorAll('.product-swiper').forEach(el => {
        if (el.swiper) el.swiper.destroy(true, true);
    });

    if (isFirstLoad) {
        // Smooth transition: fade out skeleton, then fade in products
        skeleton.style.transition = 'opacity 0.4s ease';
        skeleton.style.opacity = '0';
        setTimeout(() => {
            productsContainer.innerHTML = html;
            initAfterRender(true);
        }, 400);
    } else {
        productsContainer.innerHTML = html;
        initAfterRender(false);
    }
}

function initAfterRender(animateIn) {
    // Initialize new swipers
    document.querySelectorAll('.product-swiper').forEach(el => {
        new Swiper(el, { loop: true, pagination: { el: el.querySelector('.swiper-pagination'), clickable: true } });
    });

    // Animate product cards in with stagger effect
    if (animateIn) {
        const cards = productsContainer.querySelectorAll('.product-card');
        cards.forEach((card, i) => {
            card.style.opacity = '0';
            card.style.transform = 'translateY(30px)';
            card.style.transition = 'opacity 0.5s ease, transform 0.5s ease';
            setTimeout(() => {
                card.style.opacity = '1';
                card.style.transform = 'translateY(0)';
            }, 80 + i * 60); // staggered: each card 60ms after the previous
        });
        // Also fade in sections
        productsContainer.querySelectorAll('section').forEach((section, i) => {
            section.style.opacity = '0';
            section.style.transition = 'opacity 0.5s ease';
            setTimeout(() => { section.style.opacity = '1'; }, i * 150);
        });
    }

    // Attach drag & drop listeners to product cards when admin
    if (isAdmin) {
        productsContainer.querySelectorAll('.product-card[draggable]').forEach(card => {
            card.addEventListener('dragstart', handleProductDragStart);
            card.addEventListener('dragover', handleProductDragOver);
            card.addEventListener('dragenter', handleProductDragEnter);
            card.addEventListener('dragleave', handleProductDragLeave);
            card.addEventListener('drop', handleProductDrop);
            card.addEventListener('dragend', handleProductDragEnd);
        });
    }
}

// --- Product Drag & Drop Reordering ---
let lastDragY = 0;

function handleProductDragStart(e) {
    draggedProductSku = e.currentTarget.dataset.sku;
    e.currentTarget.classList.add('product-dragging');
    e.dataTransfer.effectAllowed = 'move';
    // Use a transparent image so the default ghost isn't shown with broken layout
    const ghost = e.currentTarget.cloneNode(true);
    ghost.style.width = e.currentTarget.offsetWidth + 'px';
    ghost.style.opacity = '0.8';
    ghost.style.position = 'absolute';
    ghost.style.top = '-9999px';
    document.body.appendChild(ghost);
    e.dataTransfer.setDragImage(ghost, ghost.offsetWidth / 2, 30);
    setTimeout(() => document.body.removeChild(ghost), 0);

    // Start auto-scroll interval
    startAutoScroll();
}

function startAutoScroll() {
    if (autoScrollInterval) clearInterval(autoScrollInterval);
    autoScrollInterval = setInterval(() => {
        const edgeSize = 80; // px from edge to trigger scroll
        const scrollSpeed = 12; // px per tick
        const y = lastDragY;
        if (y < edgeSize) {
            window.scrollBy(0, -scrollSpeed);
        } else if (y > window.innerHeight - edgeSize) {
            window.scrollBy(0, scrollSpeed);
        }
    }, 16); // ~60fps
}

function stopAutoScroll() {
    if (autoScrollInterval) {
        clearInterval(autoScrollInterval);
        autoScrollInterval = null;
    }
}

// Track mouse position during drag (dragover fires continuously)
document.addEventListener('dragover', (e) => {
    if (draggedProductSku) {
        lastDragY = e.clientY;
    }
});

function handleProductDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
}

function handleProductDragEnter(e) {
    e.preventDefault();
    const card = e.currentTarget;
    // Only highlight if same category
    if (card.dataset.category === products.find(p => p.sku === draggedProductSku)?.category) {
        card.classList.add('product-drag-over');
    }
}

function handleProductDragLeave(e) {
    e.currentTarget.classList.remove('product-drag-over');
}

async function handleProductDrop(e) {
    e.preventDefault();
    const targetCard = e.currentTarget;
    targetCard.classList.remove('product-drag-over');
    
    const targetSku = targetCard.dataset.sku;
    if (!draggedProductSku || draggedProductSku === targetSku) return;
    
    const srcProduct = products.find(p => p.sku === draggedProductSku);
    const tgtProduct = products.find(p => p.sku === targetSku);
    if (!srcProduct || !tgtProduct) return;
    
    // Only allow reorder within same category
    if (srcProduct.category !== tgtProduct.category) return;
    
    // Get all products in this category sorted by order
    const catProducts = products
        .filter(p => p.category === srcProduct.category)
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    
    // Initialize order values if needed
    const needsInit = catProducts.every(p => (p.order ?? 0) === (catProducts[0].order ?? 0));
    if (needsInit) {
        catProducts.forEach((p, i) => { p.order = i; });
    }
    
    const srcIdx = catProducts.findIndex(p => p.sku === draggedProductSku);
    const tgtIdx = catProducts.findIndex(p => p.sku === targetSku);
    if (srcIdx === -1 || tgtIdx === -1) return;
    
    // Remove source and insert at target position
    const [moved] = catProducts.splice(srcIdx, 1);
    catProducts.splice(tgtIdx, 0, moved);
    
    // Reassign order values sequentially
    catProducts.forEach((p, i) => { p.order = i; });
    
    // Atomic batch write — prevents partial snapshots from deleting products
    isSaving = true;
    try {
        const batch = writeBatch(db);
        for (const p of catProducts) {
            const data = { ...p };
            delete data.id;
            batch.set(doc(db, "products", p.sku), data);
        }
        await batch.commit();
    } catch (err) {
        alert("Error al reordenar: " + err.message);
    } finally {
        isSaving = false;
        renderProducts();
    }
}

function handleProductDragEnd(e) {
    e.currentTarget.classList.remove('product-dragging');
    document.querySelectorAll('.product-card').forEach(el => el.classList.remove('product-drag-over'));
    draggedProductSku = null;
    stopAutoScroll();
}

// --- Modals Logic ---
let modalQty = 1;
let currentModalData = {};
let modalSwiper = null;

window.openModalBySku = (sku) => {
    const product = products.find(p => p.sku === sku);
    if (!product) return;
    currentModalData = product;
    modalQty = 1;
    
    document.getElementById('modal-sku').textContent = `SKU: ${sku}`;
    document.getElementById('modal-name').textContent = product.name;
    document.getElementById('modal-desc').textContent = product.description;
    document.getElementById('modal-price-transfer').textContent = product.priceTransfer;
    document.getElementById('modal-price-card').textContent = product.priceCard;
    document.getElementById('modal-qty').textContent = modalQty;
    
    const wrapper = document.getElementById('modal-image-wrapper');
    wrapper.innerHTML = (product.images || []).map(img => `<div class="swiper-slide w-full h-full flex items-center justify-center"><img src="${img}" class="w-full h-full object-cover"></div>`).join('') || '<div class="swiper-slide w-full h-full flex items-center justify-center">Sin imagen</div>';
    
    document.getElementById('modal-colors').innerHTML = (product.colors || []).map(c => `<button class="swatch w-8 h-8 rounded-full border-2 border-white shadow-md" style="background-color: ${c}"></button>`).join('');
    
    document.getElementById('product-modal').classList.remove('hidden');
    document.body.style.overflow = 'hidden';
    
    if(modalSwiper) modalSwiper.destroy();
    modalSwiper = new Swiper('.modal-swiper', { loop: product.images?.length > 1, pagination: { el: '.swiper-pagination', clickable: true }, navigation: { nextEl: '.swiper-button-next', prevEl: '.swiper-button-prev' } });
};

window.closeModal = () => {
    document.getElementById('product-modal').classList.add('hidden');
    document.body.style.overflow = '';
};

window.changeQty = (delta) => {
    modalQty = Math.max(1, modalQty + delta);
    document.getElementById('modal-qty').textContent = modalQty;
};

window.openWhatsApp = (sku, name, color) => {
    const num = firebaseConfig.whatsapp_number || '5493425977934';
    const msg = encodeURIComponent(`Hola Magnolia Chic! 🌸 Quiero este producto:\n\n✨ ${name}\n📦 SKU: ${sku}\n🎨 Color: ${color || 'A consultar'}\n\n¿Tienen stock? ¡Gracias!`);
    window.open(`https://wa.me/${num}?text=${msg}`, '_blank');
};

window.orderFromModal = () => {
    const { sku, name } = currentModalData;
    const msg = encodeURIComponent(`Hola Magnolia Chic! 🌸 Quiero hacer un pedido:\n\n✨ Producto: ${name}\n📦 SKU: ${sku}\n🔢 Cantidad: ${modalQty}\n\n¡Gracias!`);
    window.open(`https://wa.me/5493425977934?text=${msg}`, '_blank');
};

// --- Admin Editor ---
let editImages = [];
let dragSrcIndex = null;

window.openEditModal = (sku) => {
    const product = products.find(p => p.sku === sku);
    if (!product) return;
    
    document.getElementById('edit-sku').value = sku;
    document.getElementById('edit-name').value = product.name;
    document.getElementById('edit-desc').value = product.description;
    document.getElementById('edit-price-transfer').value = product.priceTransfer;
    document.getElementById('edit-price-card').value = product.priceCard;
    document.getElementById('edit-colors').value = (product.colors || []).join(', ');
    document.getElementById('edit-category').value = product.category;
    document.getElementById('edit-gender').value = product.gender || 'Unisex';
    
    editImages = [...(product.images || [])];
    renderEditImages();
    updateColorPreview();
    
    document.getElementById('edit-mode').value = 'edit';
    document.getElementById('edit-reset-container').style.display = 'block';
    document.getElementById('edit-modal-title').textContent = 'Editar Producto';
    editModal.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
};

window.closeEditModal = () => {
    editModal.classList.add('hidden');
    document.body.style.overflow = '';
};

window.openNewProductModal = () => {
    document.getElementById('edit-sku').value = '';
    document.getElementById('edit-name').value = '';
    document.getElementById('edit-desc').value = '';
    document.getElementById('edit-price-transfer').value = '';
    document.getElementById('edit-price-card').value = '';
    document.getElementById('edit-colors').value = '#000000';
    document.getElementById('edit-gender').value = 'Unisex';
    
    editImages = [];
    renderEditImages();
    updateColorPreview();
    
    document.getElementById('edit-mode').value = 'new';
    document.getElementById('edit-reset-container').style.display = 'none';
    document.getElementById('edit-modal-title').textContent = 'Nuevo Producto';
    editModal.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
};

// --- Drag & Drop Image Reordering ---
function renderEditImages() {
    const grid = document.getElementById('edit-images-grid');
    grid.innerHTML = editImages.map((img, i) => `
        <div class="edit-img-thumb" draggable="true" data-index="${i}">
            <img src="${img}">
            <button class="remove-img" onclick="removeEditImage(${i})">✕</button>
        </div>`).join('') + `
        <div class="edit-img-add" onclick="document.getElementById('edit-file-input').click()"><span>+</span></div>`;
    
    // Attach drag & drop listeners to each thumb
    grid.querySelectorAll('.edit-img-thumb[draggable]').forEach(thumb => {
        thumb.addEventListener('dragstart', handleDragStart);
        thumb.addEventListener('dragover', handleDragOver);
        thumb.addEventListener('dragenter', handleDragEnter);
        thumb.addEventListener('dragleave', handleDragLeave);
        thumb.addEventListener('drop', handleDrop);
        thumb.addEventListener('dragend', handleDragEnd);
    });
}

function handleDragStart(e) {
    dragSrcIndex = parseInt(e.currentTarget.dataset.index);
    e.currentTarget.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
}

function handleDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
}

function handleDragEnter(e) {
    e.preventDefault();
    e.currentTarget.classList.add('drag-over');
}

function handleDragLeave(e) {
    e.currentTarget.classList.remove('drag-over');
}

function handleDrop(e) {
    e.preventDefault();
    const targetIndex = parseInt(e.currentTarget.dataset.index);
    e.currentTarget.classList.remove('drag-over');
    
    if (dragSrcIndex !== null && dragSrcIndex !== targetIndex) {
        // Swap images in array
        const movedImg = editImages.splice(dragSrcIndex, 1)[0];
        editImages.splice(targetIndex, 0, movedImg);
        renderEditImages();
    }
}

function handleDragEnd(e) {
    e.currentTarget.classList.remove('dragging');
    document.querySelectorAll('.edit-img-thumb').forEach(el => el.classList.remove('drag-over'));
    dragSrcIndex = null;
}

window.removeEditImage = (i) => { editImages.splice(i, 1); renderEditImages(); };

// Image Upload Handler
const imgInput = document.createElement('input');
imgInput.type = 'file'; imgInput.id = 'edit-file-input'; imgInput.multiple = true; imgInput.style.display = 'none';
document.body.appendChild(imgInput);
imgInput.onchange = (e) => {
    Array.from(e.target.files).forEach(file => {
        const reader = new FileReader();
        reader.onload = (ev) => { editImages.push(ev.target.result); renderEditImages(); };
        reader.readAsDataURL(file);
    });
};

function updateColorPreview() {
    const colors = document.getElementById('edit-colors').value.split(',').map(c => c.trim()).filter(c => c);
    document.getElementById('edit-colors-preview').innerHTML = colors.map(c => `<div style="width:28px;height:28px;border-radius:50%;background:${c};border:1px solid #ddd"></div>`).join('');
}
document.getElementById('edit-colors').oninput = updateColorPreview;

window.saveProduct = async () => {
    const mode = document.getElementById('edit-mode').value;
    let sku = document.getElementById('edit-sku').value;
    const name = document.getElementById('edit-name').value;
    const category = document.getElementById('edit-category').value;
    const gender = document.getElementById('edit-gender').value;
    const saveBtn = document.querySelector('.edit-save-btn');
    
    if (!name) return alert("Nombre obligatorio");
    
    saveBtn.disabled = true;
    saveBtn.textContent = "Guardando...";
    isSaving = true;

    try {
        // Generate SKU if new — use MAX existing number to avoid collisions
        if (mode === 'new') {
            const prefix = { 'Billeteras y Accesorios': 'BA', 'Bolsos y Mochilas': 'BM', 'Sombreros y Gorras': 'SG' }[category] || 'XX';
            // Find the highest existing SKU number for this prefix
            const existingNumbers = products
                .filter(p => p.sku.startsWith(prefix + '-'))
                .map(p => {
                    const num = parseInt(p.sku.split('-')[1], 10);
                    return isNaN(num) ? 0 : num;
                });
            const maxNum = existingNumbers.length > 0 ? Math.max(...existingNumbers) : 0;
            sku = `${prefix}-${String(maxNum + 1).padStart(3, '0')}`;
            console.log(`[Magnolia] Nuevo SKU generado: ${sku} (máx existente: ${maxNum})`);
        }

        const finalImages = [];
        for (let i = 0; i < editImages.length; i++) {
            const img = editImages[i];
            if (img.startsWith('data:')) {
                // Upload to ImgBB
                saveBtn.textContent = `Subiendo imagen ${i + 1}/${editImages.length}...`;
                const base64Data = img.split(',')[1];
                
                // Check base64 size before upload (ImgBB limit: ~32MB)
                const sizeInBytes = base64Data.length * 0.75;
                if (sizeInBytes > 30 * 1024 * 1024) {
                    throw new Error(`La imagen ${i + 1} es demasiado grande (${(sizeInBytes / 1024 / 1024).toFixed(1)}MB). Máximo: 30MB.`);
                }
                
                const formData = new FormData();
                formData.append('image', base64Data);
                
                try {
                    const response = await fetch(`https://api.imgbb.com/1/upload?key=${IMGBB_API_KEY}`, {
                        method: 'POST',
                        body: formData
                    });
                    const result = await response.json();
                    
                    if (result.success) {
                        finalImages.push(result.data.url);
                        console.log(`[Magnolia] Imagen ${i + 1} subida: ${result.data.url}`);
                    } else {
                        throw new Error(result.error ? result.error.message : "Error desconocido en ImgBB");
                    }
                } catch (err) {
                    console.error('[Magnolia] Error subiendo a ImgBB:', err);
                    throw new Error(`No se pudo subir la imagen ${i + 1}: ${err.message}`);
                }
            } else {
                finalImages.push(img);
            }
        }

        saveBtn.textContent = 'Guardando en Firebase...';

        const catIdMap = { 'Billeteras y Accesorios': 'billeteras-y-accesorios', 'Bolsos y Mochilas': 'bolsos-y-mochilas', 'Sombreros y Gorras': 'sombreros-y-gorras' };
        
        // Get current order or assign next order for new products
        let order = 0;
        if (mode === 'new') {
            const catProducts = products.filter(p => p.category === category);
            order = catProducts.length > 0 ? Math.max(...catProducts.map(p => p.order || 0)) + 1 : 0;
        } else {
            const existing = products.find(p => p.sku === sku);
            order = existing?.order || 0;
        }

        const productData = {
            sku, name, gender,
            category, categoryId: catIdMap[category],
            description: document.getElementById('edit-desc').value,
            priceTransfer: document.getElementById('edit-price-transfer').value,
            priceCard: document.getElementById('edit-price-card').value,
            colors: document.getElementById('edit-colors').value.split(',').map(c => c.trim()).filter(c => c),
            images: finalImages,
            order
        };

        // Check document size (Firestore limit: 1 MiB)
        const docSize = new Blob([JSON.stringify(productData)]).size;
        if (docSize > 900 * 1024) {
            throw new Error(`El producto es demasiado grande (${(docSize / 1024).toFixed(0)}KB). Reducí el tamaño de las descripciones o imágenes.`);
        }

        console.log('[Magnolia] Guardando producto:', sku, productData);
        await setDoc(doc(db, "products", sku), productData);
        
        // Verify the save was successful
        console.log(`[Magnolia] ✅ Producto ${sku} guardado exitosamente en Firestore`);
        
        window.closeEditModal();
        alert(`¡Guardado! Producto ${sku} guardado correctamente.`);
    } catch (e) {
        console.error('[Magnolia] ❌ Error al guardar:', e);
        alert(`Error al guardar: ${e.message}\n\nSi el problema persiste, verificá tu conexión a internet y que las reglas de Firebase no hayan vencido.`);
    } finally {
        isSaving = false;
        saveBtn.disabled = false;
        saveBtn.textContent = "💾 Guardar Cambios";
        renderProducts();
    }
};

window.deleteProduct = async (sku) => {
    if(confirm("¿Eliminar producto?")) {
        await deleteDoc(doc(db, "products", sku));
    }
};

window.toggleMobileMenu = () => {
    const menu = document.getElementById('mobile-menu');
    menu.classList.toggle('hidden');
    menu.classList.toggle('flex');
};
