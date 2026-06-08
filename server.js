const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { shopConfig, getPublicConfig, getDefaultPickupData } = require('./config');

const app = express();
const PORT = process.env.PORT || 3848;
const LOW_STOCK_DEFAULT = shopConfig.defaultLowStockThreshold;
const DEFAULT_PAYMENT_METHOD = shopConfig.defaultPaymentMethod;
const IS_RAILWAY = Boolean(process.env.RAILWAY_ENVIRONMENT);

function resolveDataDir() {
  if (IS_RAILWAY) {
    const volumeMount = process.env.RAILWAY_VOLUME_MOUNT_PATH;
    if (!volumeMount) {
      console.error(
        'Railway volume not linked. Attach a volume to this service at mount path /app/data, then redeploy.'
      );
      console.error('Without a volume, data is stored on ephemeral disk and is lost on every redeploy.');
      process.exit(1);
    }
    if (process.env.DATA_DIR && process.env.DATA_DIR !== volumeMount) {
      console.warn(
        `Ignoring DATA_DIR=${process.env.DATA_DIR} on Railway; using volume at ${volumeMount}`
      );
    }
    return volumeMount;
  }
  return process.env.DATA_DIR || path.join(__dirname, 'data');
}

const DATA_DIR = resolveDataDir();

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

try {
  fs.accessSync(DATA_DIR, fs.constants.R_OK | fs.constants.W_OK);
} catch {
  console.error(`Data directory is not readable/writable: ${DATA_DIR}`);
  if (IS_RAILWAY) {
    console.error('Try setting RAILWAY_RUN_UID=0 on the service, then redeploy.');
  }
  process.exit(1);
}
const HTTP_AUTH_USER = process.env.HTTP_AUTH_USER || '';
const HTTP_AUTH_PASSWORD = process.env.HTTP_AUTH_PASSWORD || '';
const HTTP_AUTH_ENABLED = Boolean(HTTP_AUTH_USER && HTTP_AUTH_PASSWORD);

if (IS_RAILWAY && !HTTP_AUTH_ENABLED) {
  console.error('On Railway, set HTTP_AUTH_USER and HTTP_AUTH_PASSWORD environment variables.');
  process.exit(1);
}

function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function httpAuth(req, res, next) {
  if (!HTTP_AUTH_ENABLED) return next();

  const header = req.headers.authorization;
  if (!header || !header.startsWith('Basic ')) {
    res.set('WWW-Authenticate', `Basic realm="${shopConfig.shopName}"`);
    return res.status(401).send('Authentication required');
  }

  let decoded;
  try {
    decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
  } catch {
    res.set('WWW-Authenticate', `Basic realm="${shopConfig.shopName}"`);
    return res.status(401).send('Invalid credentials');
  }

  const sep = decoded.indexOf(':');
  const user = sep >= 0 ? decoded.slice(0, sep) : decoded;
  const pass = sep >= 0 ? decoded.slice(sep + 1) : '';

  if (safeEqual(user, HTTP_AUTH_USER) && safeEqual(pass, HTTP_AUTH_PASSWORD)) {
    return next();
  }

  res.set('WWW-Authenticate', `Basic realm="${shopConfig.shopName}"`);
  return res.status(401).send('Invalid credentials');
}

app.use(httpAuth);
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

function readJson(filename) {
  const filePath = path.join(DATA_DIR, filename);
  if (!fs.existsSync(filePath)) return [];
  const raw = fs.readFileSync(filePath, 'utf8').trim();
  if (!raw) return [];
  return JSON.parse(raw);
}

function writeJson(filename, data) {
  const filePath = path.join(DATA_DIR, filename);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

function readJsonObject(filename, defaultValue) {
  const filePath = path.join(DATA_DIR, filename);
  if (!fs.existsSync(filePath)) return defaultValue;
  const raw = fs.readFileSync(filePath, 'utf8').trim();
  if (!raw) return defaultValue;
  return JSON.parse(raw);
}

function readPickup() {
  const data = readJsonObject('pickup.json', getDefaultPickupData());
  if (!data.contactNumber) data.contactNumber = shopConfig.contactNumber;
  if (!data.locations?.length) data.locations = shopConfig.pickupLocations;
  return data;
}

function writePickup(data) {
  writeJson('pickup.json', data);
}

function normalizeName(name) {
  return String(name || '').trim().toLowerCase();
}

function normalizeSku(sku) {
  return String(sku || '').trim().toUpperCase();
}

function findItem(items, { name, sku }) {
  if (sku) {
    const key = normalizeSku(sku);
    const bySku = items.find((i) => i.sku && normalizeSku(i.sku) === key);
    if (bySku) return bySku;
  }
  if (name) {
    const key = normalizeName(name);
    return items.find((i) => normalizeName(i.name) === key);
  }
  return null;
}

function csvEscape(value) {
  const s = value == null ? '' : String(value);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function toCsv(headers, rows) {
  const lines = [headers.join(',')];
  for (const row of rows) {
    lines.push(headers.map((h) => csvEscape(row[h])).join(','));
  }
  return lines.join('\n') + '\n';
}

function parseCsv(text) {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) return [];

  const delimiter = lines[0].includes('\t') ? '\t' : ',';
  const headers = lines[0].split(delimiter).map((h) => h.trim().toLowerCase());

  const col = (row, ...names) => {
    for (const name of names) {
      const idx = headers.indexOf(name);
      if (idx >= 0 && row[idx] !== undefined && row[idx] !== '') return row[idx].trim();
    }
    return '';
  };

  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].split(delimiter).map((p) => p.trim());
    const name = col(parts, 'name', 'item', 'product');
    if (!name) continue;

    const qtyRaw = col(parts, 'quantity', 'qty', 'stock', 'count');
    const wholesaleRaw = col(parts, 'wholesale', 'wholesale_price', 'cost', 'buy_price');
    const srpRaw = col(parts, 'srp', 'sell_price', 'price', 'retail');
    const category = col(parts, 'category', 'type');
    const sku = col(parts, 'sku', 'code', 'barcode');
    const thresholdRaw = col(parts, 'low_stock', 'low_stock_threshold', 'reorder_at');

    rows.push({
      name,
      sku: sku || null,
      quantity: qtyRaw === '' ? 0 : Number(qtyRaw),
      wholesalePrice: wholesaleRaw === '' ? null : Number(wholesaleRaw),
      srp: srpRaw === '' ? null : Number(srpRaw),
      category: category || null,
      lowStockThreshold: thresholdRaw === '' ? null : Number(thresholdRaw),
    });
  }
  return rows;
}

// --- Shop config (public) ---

app.get('/api/config', (_req, res) => {
  res.json(getPublicConfig());
});

// --- Items ---

app.get('/api/items', (_req, res) => {
  res.json(readJson('items.json'));
});

app.post('/api/items', (req, res) => {
  const { name, sku, quantity = 0, wholesalePrice, srp, category, lowStockThreshold = LOW_STOCK_DEFAULT } = req.body;
  if (!name || !String(name).trim()) {
    return res.status(400).json({ error: 'Name is required' });
  }

  const items = readJson('items.json');
  if (findItem(items, { name })) {
    return res.status(409).json({ error: 'Item with this name already exists' });
  }
  if (sku && items.some((i) => i.sku && normalizeSku(i.sku) === normalizeSku(sku))) {
    return res.status(409).json({ error: 'Item with this SKU already exists' });
  }

  const item = {
    id: crypto.randomUUID(),
    name: String(name).trim(),
    sku: sku ? String(sku).trim() : null,
    quantity: Number(quantity) || 0,
    wholesalePrice: wholesalePrice != null ? Number(wholesalePrice) : null,
    srp: srp != null ? Number(srp) : null,
    category: category || null,
    lowStockThreshold: Number(lowStockThreshold) || LOW_STOCK_DEFAULT,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  items.push(item);
  writeJson('items.json', items);
  res.status(201).json(item);
});

app.put('/api/items/:id', (req, res) => {
  const items = readJson('items.json');
  const idx = items.findIndex((i) => i.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Item not found' });

  const { name, sku, quantity, wholesalePrice, srp, category, lowStockThreshold } = req.body;
  if (name != null) items[idx].name = String(name).trim();
  if (sku !== undefined) items[idx].sku = sku ? String(sku).trim() : null;
  if (quantity != null) items[idx].quantity = Number(quantity);
  if (wholesalePrice !== undefined) {
    items[idx].wholesalePrice = wholesalePrice == null ? null : Number(wholesalePrice);
  }
  if (srp !== undefined) items[idx].srp = srp == null ? null : Number(srp);
  if (category !== undefined) items[idx].category = category || null;
  if (lowStockThreshold != null) {
    items[idx].lowStockThreshold = Number(lowStockThreshold) || LOW_STOCK_DEFAULT;
  }
  items[idx].updatedAt = new Date().toISOString();

  writeJson('items.json', items);
  res.json(items[idx]);
});

app.delete('/api/items/:id', (req, res) => {
  const items = readJson('items.json');
  const filtered = items.filter((i) => i.id !== req.params.id);
  if (filtered.length === items.length) {
    return res.status(404).json({ error: 'Item not found' });
  }
  writeJson('items.json', filtered);
  res.json({ ok: true });
});

// --- CSV import (restock / upsert) ---

app.post('/api/import/csv', (req, res) => {
  const { csv } = req.body;
  if (!csv || !String(csv).trim()) {
    return res.status(400).json({ error: 'CSV text is required' });
  }

  const rows = parseCsv(String(csv));
  if (rows.length === 0) {
    return res.status(400).json({ error: 'No valid rows found. Need at least a name column.' });
  }

  const items = readJson('items.json');
  const results = { created: 0, updated: 0, rows: [] };

  for (const row of rows) {
    const existing = findItem(items, row);

    if (existing) {
      existing.quantity += Number(row.quantity) || 0;
      if (row.wholesalePrice != null && !Number.isNaN(row.wholesalePrice)) {
        existing.wholesalePrice = row.wholesalePrice;
      }
      if (row.srp != null && !Number.isNaN(row.srp)) {
        existing.srp = row.srp;
      }
      if (row.category) existing.category = row.category;
      if (row.sku && !existing.sku) existing.sku = row.sku;
      if (row.lowStockThreshold != null && !Number.isNaN(row.lowStockThreshold)) {
        existing.lowStockThreshold = row.lowStockThreshold;
      }
      existing.updatedAt = new Date().toISOString();
      results.updated++;
      results.rows.push({ action: 'updated', name: existing.name, quantityAdded: row.quantity });
    } else {
      const item = {
        id: crypto.randomUUID(),
        name: row.name.trim(),
        sku: row.sku,
        quantity: Number(row.quantity) || 0,
        wholesalePrice: row.wholesalePrice,
        srp: row.srp,
        category: row.category,
        lowStockThreshold: row.lowStockThreshold ?? LOW_STOCK_DEFAULT,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      items.push(item);
      results.created++;
      results.rows.push({ action: 'created', name: item.name, quantityAdded: row.quantity });
    }
  }

  writeJson('items.json', items);

  const restocks = readJson('restocks.json');
  restocks.push({
    id: crypto.randomUUID(),
    importedAt: new Date().toISOString(),
    rowCount: rows.length,
    created: results.created,
    updated: results.updated,
  });
  writeJson('restocks.json', restocks);

  res.json(results);
});

// --- Sales ---

app.get('/api/sales', (_req, res) => {
  const sales = readJson('sales.json');
  sales.sort((a, b) => new Date(b.soldAt) - new Date(a.soldAt));
  res.json(sales);
});

app.post('/api/sales', (req, res) => {
  const {
    buyerName,
    referenceNumber,
    paymentMethod,
    notes,
    lineItems,
  } = req.body;

  if (!buyerName || !String(buyerName).trim()) {
    return res.status(400).json({ error: 'Buyer name is required' });
  }
  if (!referenceNumber || !String(referenceNumber).trim()) {
    return res.status(400).json({ error: 'Reference number is required' });
  }
  if (!Array.isArray(lineItems) || lineItems.length === 0) {
    return res.status(400).json({ error: 'At least one line item is required' });
  }

  const items = readJson('items.json');
  const itemMap = new Map(items.map((i) => [i.id, i]));

  const resolvedLines = [];
  for (const line of lineItems) {
    const item = itemMap.get(line.itemId);
    if (!item) {
      return res.status(400).json({ error: `Unknown item: ${line.itemId}` });
    }
    const qty = Number(line.quantity);
    if (!qty || qty <= 0) {
      return res.status(400).json({ error: `Invalid quantity for ${item.name}` });
    }
    if (item.quantity < qty) {
      return res.status(400).json({
        error: `Not enough stock for ${item.name} (have ${item.quantity}, need ${qty})`,
      });
    }

    const unitPrice = line.unitPrice != null ? Number(line.unitPrice) : (item.srp ?? 0);
    const unitCost = item.wholesalePrice ?? 0;

    resolvedLines.push({
      itemId: item.id,
      itemName: item.name,
      quantity: qty,
      unitPrice,
      unitCost,
      lineTotal: unitPrice * qty,
      lineProfit: (unitPrice - unitCost) * qty,
    });
  }

  for (const line of resolvedLines) {
    const item = itemMap.get(line.itemId);
    item.quantity -= line.quantity;
    item.updatedAt = new Date().toISOString();
  }
  writeJson('items.json', items);

  const subtotal = resolvedLines.reduce((s, l) => s + l.lineTotal, 0);
  const totalProfit = resolvedLines.reduce((s, l) => s + l.lineProfit, 0);
  const totalCost = resolvedLines.reduce((s, l) => s + l.unitCost * l.quantity, 0);

  const sale = {
    id: crypto.randomUUID(),
    buyerName: String(buyerName).trim(),
    referenceNumber: String(referenceNumber).trim(),
    paymentMethod: paymentMethod || DEFAULT_PAYMENT_METHOD,
    notes: notes || '',
    lineItems: resolvedLines,
    subtotal,
    totalCost,
    totalProfit,
    soldAt: new Date().toISOString(),
  };

  const sales = readJson('sales.json');
  sales.push(sale);
  writeJson('sales.json', sales);

  res.status(201).json(sale);
});

// --- Stats ---

app.get('/api/health', (_req, res) => {
  let files = [];
  try {
    files = fs.readdirSync(DATA_DIR);
  } catch {
    files = [];
  }
  res.json({
    ok: true,
    dataDir: DATA_DIR,
    railway: IS_RAILWAY,
    volumeMount: process.env.RAILWAY_VOLUME_MOUNT_PATH || null,
    dataFiles: files,
    itemCount: readJson('items.json').length,
    saleCount: readJson('sales.json').length,
  });
});

app.get('/api/stats', (_req, res) => {
  const items = readJson('items.json');
  const sales = readJson('sales.json');

  const inventoryValue = items.reduce(
    (s, i) => s + (i.wholesalePrice ?? 0) * i.quantity,
    0
  );
  const retailValue = items.reduce((s, i) => s + (i.srp ?? 0) * i.quantity, 0);
  const totalUnits = items.reduce((s, i) => s + i.quantity, 0);
  const threshold = (i) => i.lowStockThreshold ?? LOW_STOCK_DEFAULT;
  const lowStock = items.filter((i) => i.quantity > 0 && i.quantity <= threshold(i));
  const outOfStock = items.filter((i) => i.quantity <= 0);

  const totalRevenue = sales.reduce((s, sale) => s + sale.subtotal, 0);
  const totalProfit = sales.reduce((s, sale) => s + sale.totalProfit, 0);
  const totalSales = sales.length;

  res.json({
    inventoryValue,
    retailValue,
    totalUnits,
    itemCount: items.length,
    lowStock,
    outOfStock,
    totalRevenue,
    totalProfit,
    totalSales,
  });
});

// --- Export ---

app.get('/api/export/inventory.csv', (_req, res) => {
  const items = readJson('items.json');
  const headers = ['name', 'sku', 'category', 'quantity', 'wholesale', 'srp', 'low_stock'];
  const rows = items.map((i) => ({
    name: i.name,
    sku: i.sku || '',
    category: i.category || '',
    quantity: i.quantity,
    wholesale: i.wholesalePrice ?? '',
    srp: i.srp ?? '',
    low_stock: i.lowStockThreshold ?? LOW_STOCK_DEFAULT,
  }));
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="inventory.csv"');
  res.send(toCsv(headers, rows));
});

app.get('/api/export/sales.csv', (_req, res) => {
  const sales = readJson('sales.json');
  sales.sort((a, b) => new Date(b.soldAt) - new Date(a.soldAt));
  const headers = [
    'sold_at', 'buyer_name', 'reference_number', 'payment_method',
    'item_name', 'quantity', 'unit_price', 'line_total', 'line_profit',
    'sale_subtotal', 'sale_profit', 'notes',
  ];
  const rows = [];
  for (const sale of sales) {
    for (const line of sale.lineItems) {
      rows.push({
        sold_at: sale.soldAt,
        buyer_name: sale.buyerName,
        reference_number: sale.referenceNumber,
        payment_method: sale.paymentMethod,
        item_name: line.itemName,
        quantity: line.quantity,
        unit_price: line.unitPrice,
        line_total: line.lineTotal,
        line_profit: line.lineProfit,
        sale_subtotal: sale.subtotal,
        sale_profit: sale.totalProfit,
        notes: sale.notes || '',
      });
    }
  }
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="sales.csv"');
  res.send(toCsv(headers, rows));
});

const BACKUP_FILES = [
  'items.json',
  'sales.json',
  'estimates.json',
  'restocks.json',
  'pickup.json',
];

app.get('/api/export/backup.json', (_req, res) => {
  const date = new Date().toISOString().slice(0, 10);
  const files = {
    'items.json': readJson('items.json'),
    'sales.json': readJson('sales.json'),
    'estimates.json': readJson('estimates.json'),
    'restocks.json': readJson('restocks.json'),
    'pickup.json': readPickup(),
  };
  const backup = {
    exportedAt: new Date().toISOString(),
    version: 1,
    files,
  };
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${shopConfig.backupFilePrefix}-${date}.json"`
  );
  res.send(JSON.stringify(backup, null, 2) + '\n');
});

app.post('/api/import/backup', (req, res) => {
  const { files } = req.body;
  if (!files || typeof files !== 'object') {
    return res.status(400).json({ error: 'Backup must include a files object' });
  }

  const restored = [];
  for (const name of BACKUP_FILES) {
    if (files[name] === undefined) continue;
    if (!Array.isArray(files[name]) && name !== 'pickup.json') {
      return res.status(400).json({ error: `${name} must be a JSON array` });
    }
    if (name === 'pickup.json' && (typeof files[name] !== 'object' || Array.isArray(files[name]))) {
      return res.status(400).json({ error: 'pickup.json must be a JSON object' });
    }
    writeJson(name, files[name]);
    restored.push(name);
  }

  if (restored.length === 0) {
    return res.status(400).json({ error: 'No recognized data files in backup' });
  }

  res.json({ ok: true, restored });
});

// --- Pickup schedule ---

app.get('/api/pickup', (_req, res) => {
  res.json(readPickup());
});

app.put('/api/pickup/schedule/:date', (req, res) => {
  const date = req.params.date;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: 'Date must be YYYY-MM-DD' });
  }

  const { pickups, notes, noPickup } = req.body;
  if (!pickups || typeof pickups !== 'object') {
    return res.status(400).json({ error: 'pickups object is required' });
  }

  const isNoPickup = Boolean(noPickup);

  const data = readPickup();
  const locationIds = new Set(data.locations.map((l) => l.id));
  const cleaned = {};

  for (const [id, entry] of Object.entries(pickups)) {
    if (!locationIds.has(id)) continue;
    cleaned[id] = {
      enabled: Boolean(entry.enabled),
      hours: String(entry.hours || '').trim(),
    };
  }

  for (const loc of data.locations) {
    if (!cleaned[loc.id]) {
      cleaned[loc.id] = { enabled: false, hours: '' };
    }
  }

  data.schedules[date] = {
    noPickup: isNoPickup,
    pickups: cleaned,
    notes: notes ? String(notes).trim() : '',
    updatedAt: new Date().toISOString(),
  };
  writePickup(data);

  res.json(data.schedules[date]);
});

// --- Saved estimates (last 5) ---

app.get('/api/estimates', (_req, res) => {
  const estimates = readJson('estimates.json');
  estimates.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json(estimates.slice(0, 5));
});

app.post('/api/estimates', (req, res) => {
  const { customerName, lineItems } = req.body;

  if (!Array.isArray(lineItems) || lineItems.length === 0) {
    return res.status(400).json({ error: 'At least one line item is required' });
  }

  const items = readJson('items.json');
  const itemMap = new Map(items.map((i) => [i.id, i]));
  const resolved = [];

  for (const line of lineItems) {
    const qty = Number(line.quantity);
    if (!qty || qty <= 0) continue;

    if (line.itemId === 'custom') {
      const name = String(line.customName || '').trim();
      if (!name) continue;
      const unitPrice = Number(line.unitPrice) || 0;
      resolved.push({
        itemId: 'custom',
        itemName: name,
        customName: name,
        quantity: qty,
        unitPrice,
        lineTotal: unitPrice * qty,
      });
      continue;
    }

    const item = itemMap.get(line.itemId);
    if (!item) continue;

    const unitPrice = line.unitPrice != null ? Number(line.unitPrice) : (item.srp ?? 0);
    resolved.push({
      itemId: item.id,
      itemName: item.name,
      quantity: qty,
      unitPrice,
      lineTotal: unitPrice * qty,
    });
  }

  if (resolved.length === 0) {
    return res.status(400).json({ error: 'No valid line items to save' });
  }

  const subtotal = resolved.reduce((s, l) => s + l.lineTotal, 0);
  const estimate = {
    id: crypto.randomUUID(),
    customerName: customerName ? String(customerName).trim() : '',
    lineItems: resolved,
    subtotal,
    createdAt: new Date().toISOString(),
  };

  const estimates = readJson('estimates.json');
  estimates.unshift(estimate);
  writeJson('estimates.json', estimates.slice(0, 5));

  res.status(201).json(estimate);
});

const server = app.listen(PORT, () => {
  console.log(`${shopConfig.shopName} running on port ${PORT}`);
  console.log(`Data folder: ${DATA_DIR}`);
  if (IS_RAILWAY) {
    console.log(`Railway volume: ${process.env.RAILWAY_VOLUME_MOUNT_PATH}`);
    try {
      console.log(`Data files: ${fs.readdirSync(DATA_DIR).join(', ') || '(empty)'}`);
    } catch {
      console.log('Data files: (unreadable)');
    }
  }
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use. Either stop the other process or run:`);
    console.error(`  PORT=3848 npm start`);
    console.error(`To find and stop what's using ${PORT}:`);
    console.error(`  lsof -i :${PORT}`);
    process.exit(1);
  }
  throw err;
});
