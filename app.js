import { initializeApp } from "firebase/app";
import { getFirestore, collection, onSnapshot, doc, setDoc, deleteDoc, query, orderBy } from "firebase/firestore";
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

// --- DOM Elements ---
const productsContainer = document.getElementById('products-container');
const loginModal = document.getElementById('login-modal');
const editModal = document.getElementById('edit-modal');
const btnDoLogin = document.getElementById('btn-do-login');
const btnAddProduct = document.getElementById('btn-add-product');

// --- Real-time Products Sync ---
onSnapshot(collection(db, "products"), (snapshot) => {
    products = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id }));
    renderProducts();
});

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

          // Admin order arrows
          const orderArrowsHtml = isAdmin ? `
            <div class="order-arrows">
              <button class="order-arrow" onclick="event.stopPropagation(); moveProduct('${product.sku}', -1)" title="Mover arriba">↑</button>
              <button class="order-arrow" onclick="event.stopPropagation(); moveProduct('${product.sku}', 1)" title="Mover abajo">↓</button>
            </div>
          ` : '';
          
          sectionHtml += `
             <article class="product-card group ${cardBgColor} rounded-2xl overflow-hidden shadow-sm hover:shadow-xl transition-all duration-500">
              <div class="relative overflow-hidden aspect-square rounded-t-2xl">
                 ${isAdmin ? `<button class="edit-btn" onclick="event.stopPropagation(); openEditModal('${product.sku}')">✏️</button>` : ''}
                 ${orderArrowsHtml}
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
    
    productsContainer.innerHTML = html;
    new Swiper('.product-swiper', { loop: true, pagination: { el: '.swiper-pagination', clickable: true } });
}

// --- Product Reordering ---
window.moveProduct = async (sku, direction) => {
    const product = products.find(p => p.sku === sku);
    if (!product) return;

    // Get products in same category, sorted by order
    const catProducts = products
        .filter(p => p.category === product.category)
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    
    // Ensure all products have distinct, sequential order values
    // (fixes the case where all products start with order=0 or undefined)
    const needsInit = catProducts.every(p => (p.order ?? 0) === (catProducts[0].order ?? 0));
    if (needsInit) {
        for (let i = 0; i < catProducts.length; i++) {
            catProducts[i].order = i;
        }
        // Save all initial orders to Firestore
        try {
            for (const p of catProducts) {
                const data = { ...p };
                delete data.id;
                await setDoc(doc(db, "products", p.sku), data);
            }
        } catch (e) {
            console.error("Error initializing order:", e);
        }
    }

    const currentIdx = catProducts.findIndex(p => p.sku === sku);
    const targetIdx = currentIdx + direction;
    
    if (targetIdx < 0 || targetIdx >= catProducts.length) return; // already at edge
    
    const targetProduct = catProducts[targetIdx];
    
    // Swap order values
    const currentOrder = product.order ?? currentIdx;
    const targetOrder = targetProduct.order ?? targetIdx;
    
    try {
        const productData = { ...product, order: targetOrder };
        delete productData.id;
        const targetData = { ...targetProduct, order: currentOrder };
        delete targetData.id;
        
        await setDoc(doc(db, "products", product.sku), productData);
        await setDoc(doc(db, "products", targetProduct.sku), targetData);
    } catch (e) {
        alert("Error al reordenar: " + e.message);
    }
};

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

    try {
        // Generate SKU if new
        if (mode === 'new') {
            const prefix = { 'Billeteras y Accesorios': 'BA', 'Bolsos y Mochilas': 'BM', 'Sombreros y Gorras': 'SG' }[category] || 'XX';
            const count = products.filter(p => p.sku.startsWith(prefix)).length;
            sku = `${prefix}-${String(count + 1).padStart(3, '0')}`;
        }

        const finalImages = [];
        for (let i = 0; i < editImages.length; i++) {
            const img = editImages[i];
            if (img.startsWith('data:')) {
                // Upload to ImgBB
                const base64Data = img.split(',')[1];
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
                    } else {
                        throw new Error(result.error ? result.error.message : "Error desconocido en ImgBB");
                    }
                } catch (err) {
                    console.error("Error subiendo a ImgBB:", err);
                    throw new Error("No se pudo subir la imagen: " + err.message);
                }
            } else {
                finalImages.push(img);
            }
        }

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

        await setDoc(doc(db, "products", sku), productData);
        window.closeEditModal();
        alert("¡Guardado!");
    } catch (e) {
        alert("Error: " + e.message);
    } finally {
        saveBtn.disabled = false;
        saveBtn.textContent = "💾 Guardar Cambios";
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
