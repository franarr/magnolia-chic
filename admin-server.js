const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const PORT = 8000;
const ROOT = __dirname;
const IMAGES_DIR = path.join(ROOT, 'assets', 'images');

// Ensure images directory exists
if (!fs.existsSync(IMAGES_DIR)) fs.mkdirSync(IMAGES_DIR, { recursive: true });

// MIME types
const MIME = {
  '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.svg': 'image/svg+xml',
  '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
};

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// Update a single product in the products array inside index.html
function updateProductInHTML(sku, updates) {
  const htmlPath = path.join(ROOT, 'index.html');
  let html = fs.readFileSync(htmlPath, 'utf8');

  // Find the product block by SKU
  const skuPattern = `sku: '${sku}'`;
  const idx = html.indexOf(skuPattern);
  if (idx === -1) return { ok: false, error: `SKU ${sku} not found` };

  // Find the start of this product object (the opening {)
  let braceStart = html.lastIndexOf('{', idx);
  // Find the end of this product object (matching closing })
  let depth = 1;
  let i = braceStart + 1;
  while (i < html.length && depth > 0) {
    if (html[i] === '{') depth++;
    if (html[i] === '}') depth--;
    i++;
  }
  let braceEnd = i;

  // Parse current product to get category info
  const currentBlock = html.substring(braceStart, braceEnd);
  const catMatch = currentBlock.match(/category:\s*'([^']+)'/);
  const catIdMatch = currentBlock.match(/categoryId:\s*'([^']+)'/);
  const category = catMatch ? catMatch[1] : 'Sin Categoría';
  const categoryId = catIdMatch ? catIdMatch[1] : 'sin-categoria';

  // Build new product block
  const desc = (updates.description || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n');
  const name = (updates.name || '').replace(/'/g, "\\'");
  const imagesArray = (updates.images || []).map(img => `'${img}'`).join(', ');

  const newBlock = `{
        sku: '${sku}',
        category: '${category}',
        categoryId: '${categoryId}',
        name: '${name}',
        description: '${desc}',
        priceTransfer: '${updates.priceTransfer || 'Consultar'}',
        priceCard: '${updates.priceCard || 'Consultar'}',
        colors: [${(updates.colors || []).map(c => `'${c}'`).join(', ')}],
        images: [${imagesArray}]
      }`;

  html = html.substring(0, braceStart) + newBlock + html.substring(braceEnd);
  fs.writeFileSync(htmlPath, html, 'utf8');
  return { ok: true };
}

const server = http.createServer(async (req, res) => {
  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;

  // CORS headers for API
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }

  // API: Upload image
  if (req.method === 'POST' && pathname === '/api/upload-image') {
    try {
      const body = await readBody(req);
      const json = JSON.parse(body.toString());
      // json = { filename: "BM-005_1.jpg", data: "data:image/jpeg;base64,..." }
      const { filename, data } = json;
      if (!filename || !data) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Missing filename or data' }));
        return;
      }
      // Strip data URL prefix
      const base64 = data.replace(/^data:image\/\w+;base64,/, '');
      const buffer = Buffer.from(base64, 'base64');
      const filePath = path.join(IMAGES_DIR, filename);
      fs.writeFileSync(filePath, buffer);
      console.log(`✅ Image saved: ${filePath} (${buffer.length} bytes)`);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, path: `./assets/images/${filename}` }));
    } catch (e) {
      console.error('Upload error:', e);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // API: Save product data to index.html
  if (req.method === 'POST' && pathname === '/api/save-product') {
    try {
      const body = await readBody(req);
      const json = JSON.parse(body.toString());
      // json = { sku, name, description, priceTransfer, priceCard, colors, images }
      const result = updateProductInHTML(json.sku, json);
      res.writeHead(result.ok ? 200 : 400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
      if (result.ok) console.log(`✅ Product updated: ${json.sku} - ${json.name}`);
    } catch (e) {
      console.error('Save error:', e);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // API: Add new product to index.html
  if (req.method === 'POST' && pathname === '/api/add-product') {
    try {
      const body = await readBody(req);
      const json = JSON.parse(body.toString());
      const { sku, category, categoryId, name, description, priceTransfer, priceCard, colors, images } = json;

      const htmlPath = path.join(ROOT, 'index.html');
      let html = fs.readFileSync(htmlPath, 'utf8');

      const desc = (description || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n');
      const cleanName = (name || '').replace(/'/g, "\\'");
      const imagesArray = (images || []).map(img => `'${img}'`).join(', ');

      const newProduct = `,\n      {\n        sku: '${sku}',\n        category: '${category}',\n        categoryId: '${categoryId}',\n        name: '${cleanName}',\n        description: '${desc}',\n        priceTransfer: '${priceTransfer || 'Consultar'}',\n        priceCard: '${priceCard || 'Consultar'}',\n        colors: [${(colors || []).map(c => `'${c}'`).join(', ')}],\n        images: [${imagesArray}]\n      }`;

      // Find the end of the products array (the closing ];)
      const productsEnd = html.indexOf('];', html.indexOf('const products = ['));
      if (productsEnd === -1) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Could not find products array end' }));
        return;
      }

      // Insert before ];
      html = html.substring(0, productsEnd) + newProduct + '\n    ' + html.substring(productsEnd);
      fs.writeFileSync(htmlPath, html, 'utf8');

      console.log(`✅ New product added: ${sku} - ${name}`);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, sku }));
    } catch (e) {
      console.error('Add product error:', e);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // Static file serving
  let filePath = path.join(ROOT, pathname === '/' ? 'index.html' : pathname);
  filePath = path.normalize(filePath);

  // Security: prevent directory traversal
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403); res.end('Forbidden'); return;
  }

  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    const ext = path.extname(filePath).toLowerCase();
    const mime = MIME[ext] || 'application/octet-stream';
    const content = fs.readFileSync(filePath);
    res.writeHead(200, { 'Content-Type': mime });
    res.end(content);
  } else {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
  }
});

server.listen(PORT, () => {
  console.log(`\n🚀 Magnolia Admin Server running at http://localhost:${PORT}`);
  console.log(`📁 Serving files from: ${ROOT}`);
  console.log(`🖼️  Images directory: ${IMAGES_DIR}`);
  console.log(`\n📝 API endpoints:`);
  console.log(`   POST /api/upload-image  - Upload an image`);
  console.log(`   POST /api/save-product  - Save product data to index.html\n`);
});
