const API = '/api';

let items = [];
let sales = [];
let saleLines = [];
let estimateLines = [];
let savedEstimates = [];
let shopConfig = null;

function cfg() {
  return shopConfig || {
    currency: { symbol: '$', locale: 'en-US' },
    locale: 'en-US',
    defaultLowStockThreshold: 5,
    contactNumber: '',
    labels: { defaultCategory: 'Other', itemsPurchased: 'Items purchased:' },
    pickup: {},
    shareTemplates: {},
  };
}

function fmt(n) {
  const { symbol, locale } = cfg().currency;
  return n == null || Number.isNaN(n)
    ? '—'
    : symbol + Number(n).toLocaleString(locale, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function fmtDate(iso) {
  return new Date(iso).toLocaleString(cfg().locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

function fillTemplate(str, vars = {}) {
  return String(str).replace(/\{(\w+)\}/g, (_, key) => vars[key] ?? '');
}

function templateVars(extra = {}) {
  return { contact: cfg().contactNumber || '', ...extra };
}

function pickRandom(arr) {
  if (!arr?.length) return '';
  return arr[Math.floor(Math.random() * arr.length)];
}

async function loadShopConfig() {
  shopConfig = await api('/config');
  document.title = `${shopConfig.shopName} — ${shopConfig.shopTagline}`;
  document.getElementById('shop-title').textContent = shopConfig.shopName;

  const wholesaleLabel = document.getElementById('label-wholesale');
  const retailLabel = document.getElementById('label-retail');
  if (wholesaleLabel) {
    wholesaleLabel.textContent = `${shopConfig.labels.wholesalePrice} (${shopConfig.currency.symbol})`;
  }
  if (retailLabel) {
    retailLabel.textContent = `${shopConfig.labels.retailPrice} (${shopConfig.currency.symbol})`;
  }

  const categoryInput = document.getElementById('item-category-input');
  if (categoryInput) categoryInput.placeholder = shopConfig.labels.categoryPlaceholder;

  const lowStockInput = document.getElementById('item-low-stock-input');
  if (lowStockInput) lowStockInput.value = shopConfig.defaultLowStockThreshold;

  const csvSample = document.getElementById('csv-sample');
  if (csvSample) csvSample.textContent = shopConfig.sampleCsv;

  const refInput = document.getElementById('payment-ref-input');
  if (refInput) refInput.placeholder = shopConfig.paymentReferencePlaceholder;

  const notesInput = document.getElementById('pickup-notes');
  if (notesInput) notesInput.placeholder = shopConfig.pickup.notesPlaceholder;

  renderPaymentMethodSelect();
}

async function api(path, options = {}) {
  const res = await fetch(API + path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

function toast(msg, isError = false) {
  const el = document.getElementById('toast');
  clearTimeout(el._t);
  if (!msg) {
    el.textContent = '';
    el.classList.add('hidden');
    el.classList.remove('error');
    return;
  }
  el.textContent = msg;
  el.classList.toggle('error', isError);
  el.classList.remove('hidden');
  el._t = setTimeout(() => {
    el.textContent = '';
    el.classList.add('hidden');
    el.classList.remove('error');
  }, 3500);
}

async function copyToClipboard(text) {
  const copiedMsg = cfg().shareTemplates.copiedToast || 'Copied — paste on your page';
  try {
    await navigator.clipboard.writeText(text);
    toast(copiedMsg);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    toast(copiedMsg);
  }
}

function renderPaymentMethodSelect() {
  const select = document.getElementById('payment-method-select');
  if (!select || !shopConfig) return;
  const methods = shopConfig.paymentMethods || [];
  select.innerHTML = methods
    .map(
      (m) =>
        `<option value="${escapeHtml(m.value)}"${m.value === shopConfig.defaultPaymentMethod ? ' selected' : ''}>${escapeHtml(m.label)}</option>`
    )
    .join('');
}

function showView(name) {
  document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach((b) => b.classList.remove('active'));
  document.getElementById('view-' + name).classList.add('active');
  document.querySelector(`[data-view="${name}"]`).classList.add('active');
}

document.querySelectorAll('.nav-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    showView(btn.dataset.view);
    refreshCurrentView(btn.dataset.view);
  });
});

async function refreshCurrentView(view) {
  if (view === 'dashboard') await loadDashboard();
  if (view === 'inventory') await loadInventory();
  if (view === 'sale') await loadSaleForm();
  if (view === 'sales') await loadSales();
  if (view === 'pickup') await loadPickup();
}

async function loadItems() {
  items = await api('/items');
  return items;
}

document.getElementById('btn-restore-backup').addEventListener('click', () => {
  document.getElementById('backup-file-input').click();
});

document.getElementById('backup-file-input').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;

  try {
    const text = await file.text();
    const backup = JSON.parse(text);
    if (!backup.files || typeof backup.files !== 'object') {
      throw new Error('Invalid backup file — missing files object');
    }
    const names = Object.keys(backup.files).join(', ');
    if (!confirm(`Restore backup from ${backup.exportedAt || 'unknown date'}?\n\nFiles: ${names}\n\nThis replaces current data.`)) {
      return;
    }
    const result = await api('/import/backup', {
      method: 'POST',
      body: JSON.stringify({ files: backup.files }),
    });
    toast(`Restored: ${result.restored.join(', ')}`);
    await loadDashboard();
  } catch (err) {
    toast(err.message, true);
  }
});

async function loadDashboard() {
  const stats = await api('/stats');
  const grid = document.getElementById('stats-grid');
  grid.innerHTML = `
    <div class="stat-card"><div class="label">Items</div><div class="value">${stats.itemCount}</div></div>
    <div class="stat-card"><div class="label">Units in stock</div><div class="value">${stats.totalUnits}</div></div>
    <div class="stat-card"><div class="label">Stock value (cost)</div><div class="value">${fmt(stats.inventoryValue)}</div></div>
    <div class="stat-card"><div class="label">Stock value (SRP)</div><div class="value">${fmt(stats.retailValue)}</div></div>
    <div class="stat-card"><div class="label">Total sales</div><div class="value">${stats.totalSales}</div></div>
    <div class="stat-card"><div class="label">Revenue</div><div class="value">${fmt(stats.totalRevenue)}</div></div>
    <div class="stat-card"><div class="label">Profit</div><div class="value">${fmt(stats.totalProfit)}</div></div>
  `;

  const lowList = document.getElementById('low-stock-list');
  const low = [...stats.lowStock, ...stats.outOfStock];
  if (low.length === 0) {
    lowList.innerHTML = '<p class="hint">All items adequately stocked.</p>';
  } else {
    lowList.innerHTML = low
      .map(
        (i) =>
          `<div class="item-row"><span>${escapeHtml(i.name)}${i.sku ? ` <span class="meta">(${escapeHtml(i.sku)})</span>` : ''}</span><span class="${i.quantity <= 0 ? 'qty-zero' : 'qty-low'}">${i.quantity} left</span></div>`
      )
      .join('');
  }
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function isLowStock(item) {
  const threshold = item.lowStockThreshold ?? cfg().defaultLowStockThreshold;
  return item.quantity > 0 && item.quantity <= threshold;
}

function qtyClass(item) {
  if (item.quantity <= 0) return 'qty-zero';
  if (isLowStock(item)) return 'qty-low';
  return '';
}
function marginPct(wholesale, srp) {
  if (wholesale == null || srp == null || wholesale === 0) return '—';
  return (((srp - wholesale) / wholesale) * 100).toFixed(0) + '%';
}

async function loadInventory() {
  await loadItems();
  renderInventoryTable(document.getElementById('inventory-search').value);
}

function renderInventoryTable(filter = '') {
  const q = filter.toLowerCase();
  const filtered = items.filter(
    (i) =>
      i.name.toLowerCase().includes(q) ||
      (i.sku || '').toLowerCase().includes(q) ||
      (i.category || '').toLowerCase().includes(q)
  );

  const tbody = document.querySelector('#inventory-table tbody');
  tbody.innerHTML = filtered
    .map(
      (i) => `
    <tr>
      <td data-label="SKU">${escapeHtml(i.sku || '—')}</td>
      <td data-label="Name">${escapeHtml(i.name)}</td>
      <td data-label="Category">${escapeHtml(i.category || '—')}</td>
      <td class="${qtyClass(i)}" data-label="Qty">${i.quantity}</td>
      <td data-label="Wholesale">${fmt(i.wholesalePrice)}</td>
      <td data-label="SRP">${fmt(i.srp)}</td>
      <td data-label="Margin">${marginPct(i.wholesalePrice, i.srp)}</td>
      <td class="inventory-actions" data-label="Actions">
        <button class="icon-btn" data-edit="${i.id}">Edit</button>
        <button class="icon-btn" data-delete="${i.id}">Delete</button>
      </td>
    </tr>`
    )
    .join('');

  tbody.querySelectorAll('[data-edit]').forEach((btn) => {
    btn.addEventListener('click', () => openItemDialog(btn.dataset.edit));
  });
  tbody.querySelectorAll('[data-delete]').forEach((btn) => {
    btn.addEventListener('click', () => deleteItem(btn.dataset.delete));
  });
}

document.getElementById('inventory-search').addEventListener('input', (e) => {
  renderInventoryTable(e.target.value);
});

function buildInventoryShareMessage() {
  const templates = cfg().shareTemplates;
  const inStock = items.filter((i) => i.quantity > 0);
  if (inStock.length === 0) {
    return null;
  }

  const defaultCategory = cfg().labels.defaultCategory;
  const byCategory = new Map();
  for (const item of inStock) {
    const cat = (item.category || '').trim() || defaultCategory;
    if (!byCategory.has(cat)) byCategory.set(cat, []);
    byCategory.get(cat).push(item);
  }

  const sortedCategories = [...byCategory.keys()].sort((a, b) => {
    if (a === defaultCategory) return 1;
    if (b === defaultCategory) return -1;
    return a.localeCompare(b);
  });

  const lines = [pickRandom(templates.inventoryIntros), ''];

  for (const cat of sortedCategories) {
    const catItems = byCategory.get(cat).sort((a, b) => a.name.localeCompare(b.name));
    lines.push(cat.toUpperCase());
    for (const item of catItems) {
      lines.push(`• ${item.name}`);
    }
    lines.push('');
  }

  const closing = pickRandom(templates.inventoryClosings);
  if (closing) lines.push('', fillTemplate(closing, templateVars()));

  return lines.join('\n').trim();
}

document.getElementById('btn-copy-inventory').addEventListener('click', async () => {
  await loadItems();
  const message = buildInventoryShareMessage();
  if (!message) {
    toast('No items in stock to share', true);
    return;
  }
  await copyToClipboard(message);
});

// Item dialog
const itemDialog = document.getElementById('item-dialog');
const itemForm = document.getElementById('item-form');

document.getElementById('btn-add-item').addEventListener('click', () => openItemDialog(null));
document.getElementById('item-cancel').addEventListener('click', () => itemDialog.close());

function openItemDialog(id) {
  itemForm.reset();
  itemForm.id.value = id || '';
  document.getElementById('item-dialog-title').textContent = id ? 'Edit item' : 'Add item';

  if (id) {
    const item = items.find((i) => i.id === id);
    if (item) {
      itemForm.name.value = item.name;
      itemForm.sku.value = item.sku || '';
      itemForm.category.value = item.category || '';
      itemForm.quantity.value = item.quantity;
      itemForm.lowStockThreshold.value = item.lowStockThreshold ?? cfg().defaultLowStockThreshold;
      itemForm.wholesalePrice.value = item.wholesalePrice ?? '';
      itemForm.srp.value = item.srp ?? '';
    }
  }
  itemDialog.showModal();
}

itemForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(itemForm);
  const body = {
    name: fd.get('name'),
    sku: fd.get('sku') || null,
    category: fd.get('category') || null,
    quantity: Number(fd.get('quantity')) || 0,
    lowStockThreshold: Number(fd.get('lowStockThreshold')) || cfg().defaultLowStockThreshold,
    wholesalePrice: fd.get('wholesalePrice') === '' ? null : Number(fd.get('wholesalePrice')),
    srp: fd.get('srp') === '' ? null : Number(fd.get('srp')),
  };

  try {
    if (fd.get('id')) {
      await api('/items/' + fd.get('id'), { method: 'PUT', body: JSON.stringify(body) });
      toast('Item updated');
    } else {
      await api('/items', { method: 'POST', body: JSON.stringify(body) });
      toast('Item created');
    }
    itemDialog.close();
    await loadInventory();
  } catch (err) {
    toast(err.message, true);
  }
});

async function deleteItem(id) {
  const item = items.find((i) => i.id === id);
  if (!confirm(`Delete "${item?.name}"?`)) return;
  try {
    await api('/items/' + id, { method: 'DELETE' });
    toast('Item deleted');
    await loadInventory();
  } catch (err) {
    toast(err.message, true);
  }
}

// CSV import
document.getElementById('btn-import').addEventListener('click', async () => {
  const csv = document.getElementById('csv-input').value;
  const resultEl = document.getElementById('import-result');
  resultEl.className = 'result';

  try {
    const result = await api('/import/csv', { method: 'POST', body: JSON.stringify({ csv }) });
    resultEl.classList.add('success');
    resultEl.innerHTML = `
      <strong>Import complete</strong><br>
      Created ${result.created} new item(s), updated ${result.updated} existing.<br>
      <ul>${result.rows.map((r) => `<li>${r.action}: ${escapeHtml(r.name)} (+${r.quantityAdded})</li>`).join('')}</ul>
    `;
    document.getElementById('csv-input').value = '';
    toast('CSV imported');
  } catch (err) {
    resultEl.classList.add('error');
    resultEl.textContent = err.message;
    toast(err.message, true);
  }
});

// Sale form
async function loadSaleForm() {
  await loadItems();
  saleLines = [];
  estimateLines = [];
  document.getElementById('sale-form').reset();
  document.getElementById('estimate-customer-name').value = '';
  renderSaleLines();
  renderEstimateLines();
  await loadEstimateHistory();
}

function filterPickerItems(query, { inStockOnly = false } = {}) {
  const q = query.toLowerCase().trim();
  let list = inStockOnly ? items.filter((i) => i.quantity > 0) : items;
  if (!q) return list;
  return list.filter(
    (i) =>
      i.name.toLowerCase().includes(q) ||
      (i.sku || '').toLowerCase().includes(q) ||
      (i.category || '').toLowerCase().includes(q)
  );
}

function pickerDisplayName(itemId, { inStockOnly = false } = {}) {
  if (itemId === 'custom') return 'Custom item…';
  const item = items.find((i) => i.id === itemId);
  if (!item) return '';
  let label = item.name;
  if (item.sku) label += ` [${item.sku}]`;
  if (inStockOnly) label += ` (${item.quantity} @ ${fmt(item.srp)})`;
  return label;
}

function renderItemPicker(selectedId, { inStockOnly = false, includeCustom = false } = {}) {
  const display =
    selectedId === 'custom'
      ? 'Custom item…'
      : selectedId
        ? pickerDisplayName(selectedId, { inStockOnly })
        : '';
  return `
    <div class="item-picker"
      data-selected-id="${escapeHtml(selectedId || '')}"
      data-picker-mode="${inStockOnly ? 'stock' : 'all'}"
      data-include-custom="${includeCustom}">
      <input type="text" class="item-picker-input" value="${escapeHtml(display)}" placeholder="Search items…" autocomplete="off" spellcheck="false">
      <div class="item-picker-menu hidden" role="listbox"></div>
    </div>`;
}

function populatePickerMenu(picker, query = '') {
  const menu = picker.querySelector('.item-picker-menu');
  const inStockOnly = picker.dataset.pickerMode === 'stock';
  const includeCustom = picker.dataset.includeCustom === 'true';
  const filtered = filterPickerItems(query, { inStockOnly });
  const q = query.toLowerCase().trim();
  const showCustom =
    includeCustom &&
    (!q ||
      'custom'.includes(q) ||
      'custom item'.includes(q) ||
      q.includes('custom'));

  let html = filtered
    .map(
      (i) => `
      <button type="button" class="item-picker-option" data-id="${i.id}">
        <span class="item-picker-name">${escapeHtml(i.name)}</span>
        <span class="item-picker-meta">${[
          i.sku ? escapeHtml(i.sku) : '',
          i.category ? escapeHtml(i.category) : '',
          inStockOnly ? `${i.quantity} @ ${fmt(i.srp)}` : fmt(i.srp),
        ]
          .filter(Boolean)
          .join(' · ')}</span>
      </button>`
    )
    .join('');

  if (showCustom) {
    html += `<button type="button" class="item-picker-option item-picker-custom" data-id="custom">Custom item…</button>`;
  }
  if (!html) {
    html = '<div class="item-picker-empty">No items found</div>';
  }

  menu.innerHTML = html;
  menu.classList.remove('hidden');
}

function closeAllItemPickers() {
  document.querySelectorAll('.item-picker-menu').forEach((m) => m.classList.add('hidden'));
}

function resetPickerInput(picker) {
  const input = picker.querySelector('.item-picker-input');
  const id = picker.dataset.selectedId;
  const inStockOnly = picker.dataset.pickerMode === 'stock';
  input.value = id ? pickerDisplayName(id, { inStockOnly }) : '';
}

function selectPickerItem(picker, itemId) {
  picker.dataset.selectedId = itemId;
  resetPickerInput(picker);
  closeAllItemPickers();
  picker.dispatchEvent(new CustomEvent('itempick', { bubbles: true, detail: { itemId } }));
}

document.addEventListener('focusin', (e) => {
  if (!e.target.classList.contains('item-picker-input')) return;
  const picker = e.target.closest('.item-picker');
  closeAllItemPickers();
  const currentLabel = pickerDisplayName(picker.dataset.selectedId, {
    inStockOnly: picker.dataset.pickerMode === 'stock',
  });
  const query = e.target.value === currentLabel ? '' : e.target.value;
  populatePickerMenu(picker, query);
});

document.addEventListener('input', (e) => {
  if (!e.target.classList.contains('item-picker-input')) return;
  populatePickerMenu(e.target.closest('.item-picker'), e.target.value);
});

document.addEventListener('click', (e) => {
  const option = e.target.closest('.item-picker-option');
  if (option) {
    selectPickerItem(option.closest('.item-picker'), option.dataset.id);
    return;
  }
  if (!e.target.closest('.item-picker')) {
    closeAllItemPickers();
  }
});

document.addEventListener('focusout', (e) => {
  if (!e.target.classList.contains('item-picker-input')) return;
  const picker = e.target.closest('.item-picker');
  setTimeout(() => {
    if (!picker.contains(document.activeElement)) {
      resetPickerInput(picker);
      closeAllItemPickers();
    }
  }, 150);
});

function renderLineCell(label, controlHtml, { note = '' } = {}) {
  return `
    <div class="line-cell">
      <span class="line-label">${label}</span>
      <div class="line-control">
        ${controlHtml}
        ${note}
      </div>
    </div>`;
}

function renderSaleLines() {
  const container = document.getElementById('sale-lines');
  if (saleLines.length === 0) {
    container.innerHTML = '<p class="hint">Add items to this sale.</p>';
    updateSaleSummary();
    return;
  }

  container.innerHTML = saleLines
    .map(
      (line, idx) => `
    <div class="line-row sale-line" data-idx="${idx}">
      ${renderLineCell('Item', renderItemPicker(line.itemId, { inStockOnly: true }), { note: '<span class="line-note line-note-spacer" aria-hidden="true">&nbsp;</span>' })}
      ${renderLineCell('Qty', `<input type="number" min="1" data-field="quantity" class="line-input" value="${line.quantity}">`, { note: '<span class="line-note line-note-spacer" aria-hidden="true">&nbsp;</span>' })}
      ${renderLineCell('Unit price', `<input type="number" min="0" step="0.01" data-field="unitPrice" class="line-input" value="${line.unitPrice ?? ''}">`)}
      ${renderLineCell('Line total', `<input type="text" class="line-input" readonly value="${fmt((line.unitPrice || 0) * line.quantity)}">`)}
      <div class="line-cell line-cell-action">
        <span class="line-label line-label-empty" aria-hidden="true">&nbsp;</span>
        <div class="line-control">
          <button type="button" class="icon-btn line-remove" data-remove>Remove</button>
        </div>
      </div>
    </div>`
    )
    .join('');

  updateSaleSummary();
}

function focusLastPicker(containerId) {
  const rows = document.querySelectorAll(`#${containerId} .line-row`);
  const input = rows[rows.length - 1]?.querySelector('.item-picker-input');
  if (input) {
    input.focus();
    input.select();
  }
}

function focusLastPicker(containerId) {
  const rows = document.querySelectorAll(`#${containerId} .line-row`);
  const input = rows[rows.length - 1]?.querySelector('.item-picker-input');
  if (input) input.focus();
}

function handleSaleLineInput(e) {
  const row = e.target.closest('.sale-line');
  if (!row || !e.target.dataset.field) return;
  const idx = Number(row.dataset.idx);
  const line = saleLines[idx];
  if (!line) return;

  const field = e.target.dataset.field;
  if (field === 'quantity') {
    line.quantity = Number(e.target.value) || 1;
    renderSaleLines();
  } else if (field === 'unitPrice') {
    line.unitPrice = Number(e.target.value) || 0;
    renderSaleLines();
  }
}

function handleSaleLineClick(e) {
  if (e.target.closest('[data-remove]')) {
    const row = e.target.closest('.sale-line');
    saleLines.splice(Number(row.dataset.idx), 1);
    renderSaleLines();
  }
}

function handleSaleLinePick(e) {
  const row = e.target.closest('.sale-line');
  if (!row) return;
  const idx = Number(row.dataset.idx);
  const line = saleLines[idx];
  if (!line) return;

  line.itemId = e.detail.itemId;
  const item = items.find((i) => i.id === e.detail.itemId);
  line.unitPrice = item?.srp ?? 0;
  renderSaleLines();
}

document.getElementById('sale-lines').addEventListener('change', handleSaleLineInput);
document.getElementById('sale-lines').addEventListener('input', handleSaleLineInput);
document.getElementById('sale-lines').addEventListener('click', handleSaleLineClick);
document.getElementById('sale-lines').addEventListener('itempick', handleSaleLinePick);

function updateSaleSummary() {
  let subtotal = 0;
  let profit = 0;
  for (const line of saleLines) {
    if (!line.itemId) continue;
    const item = items.find((i) => i.id === line.itemId);
    const price = line.unitPrice ?? item?.srp ?? 0;
    const cost = item?.wholesalePrice ?? 0;
    subtotal += price * line.quantity;
    profit += (price - cost) * line.quantity;
  }
  document.getElementById('sale-summary').innerHTML =
    saleLines.length === 0
      ? ''
      : `<strong>Subtotal:</strong> ${fmt(subtotal)} &nbsp;|&nbsp; <strong>Est. profit:</strong> ${fmt(profit)}`;
}

document.getElementById('btn-add-line').addEventListener('click', () => {
  if (items.filter((i) => i.quantity > 0).length === 0) {
    toast('No items in stock', true);
    return;
  }
  saleLines.push({
    itemId: '',
    quantity: 1,
    unitPrice: null,
  });
  renderSaleLines();
  focusLastPicker('sale-lines');
});

document.getElementById('btn-complete-sale').addEventListener('click', async () => {
  const form = document.getElementById('sale-form');
  if (!form.reportValidity()) return;
  if (saleLines.length === 0) {
    toast('Add at least one item', true);
    return;
  }
  if (saleLines.some((l) => !l.itemId)) {
    toast('Select an item for each line', true);
    return;
  }

  const fd = new FormData(form);
  const body = {
    buyerName: fd.get('buyerName'),
    referenceNumber: fd.get('referenceNumber'),
    paymentMethod: fd.get('paymentMethod'),
    notes: fd.get('notes'),
    lineItems: saleLines.map((l) => ({
      itemId: l.itemId,
      quantity: l.quantity,
      unitPrice: l.unitPrice,
    })),
  };

  try {
    const sale = await api('/sales', { method: 'POST', body: JSON.stringify(body) });
    toast(`Sale recorded — ${fmt(sale.subtotal)}`);
    await loadSaleForm();
    showView('sales');
    document.querySelector('[data-view="sales"]').classList.add('active');
    await loadSales();
  } catch (err) {
    toast(err.message, true);
  }
});

// Buyer estimate
function getEstimateCustomerName() {
  return document.getElementById('estimate-customer-name').value.trim();
}

function estimateIntro(customerName, randomize) {
  const templates = cfg().shareTemplates;
  if (customerName) {
    const named = templates.estimateIntrosNamed || [];
    const template = randomize ? pickRandom(named) : named[0];
    return template ? fillTemplate(template, templateVars({ name: customerName })) : '';
  }
  const intros = templates.estimateIntros || [];
  return randomize ? pickRandom(intros) : intros[0] || '';
}

function estimateLineName(line) {
  if (line.itemId === 'custom') return (line.customName || '').trim();
  const item = items.find((i) => i.id === line.itemId);
  return item?.name || '';
}

function getEstimateStockIssues(lines = estimateLines) {
  const requestedByItem = new Map();

  for (const line of lines) {
    if (line.itemId === 'custom' || !line.itemId) continue;
    const qty = Number(line.quantity) || 0;
    if (qty <= 0) continue;
    requestedByItem.set(line.itemId, (requestedByItem.get(line.itemId) || 0) + qty);
  }

  const issues = [];
  for (const [itemId, requested] of requestedByItem) {
    const item = items.find((i) => i.id === itemId);
    if (!item) continue;
    if (requested > item.quantity) {
      issues.push({
        itemId,
        name: item.name,
        requested,
        available: item.quantity,
        shortfall: requested - item.quantity,
      });
    }
  }
  return issues.sort((a, b) => a.name.localeCompare(b.name));
}

function buildEstimateText({ randomize = false } = {}) {
  const valid = estimateLines.filter((l) => estimateLineName(l) && l.quantity > 0);
  if (valid.length === 0) return null;

  let subtotal = 0;
  const itemLines = [];

  for (const line of valid) {
    const name = estimateLineName(line);
    const qty = Number(line.quantity) || 1;
    const item = line.itemId !== 'custom' ? items.find((i) => i.id === line.itemId) : null;
    const unitPrice = line.unitPrice ?? item?.srp ?? 0;
    const lineTotal = unitPrice * qty;
    subtotal += lineTotal;
    itemLines.push(`${qty}× ${name} — ${fmt(unitPrice)} each`);
  }

  const templates = cfg().shareTemplates;
  const intro = estimateIntro(getEstimateCustomerName(), randomize);
  const closingTemplate = randomize
    ? pickRandom(templates.estimateClosings)
    : templates.estimateClosings?.[0];
  const closing = closingTemplate ? fillTemplate(closingTemplate, templateVars()) : '';
  const paymentInfo = cfg().estimatePaymentInfo;

  return [
    intro,
    '',
    ...itemLines,
    '',
    `Total: ${fmt(subtotal)}`,
    '',
    paymentInfo,
    '',
    closing,
  ].join('\n');
}

function buildEstimateSavePayload() {
  const valid = estimateLines.filter((l) => estimateLineName(l) && l.quantity > 0);
  if (valid.length === 0) return null;

  return {
    customerName: getEstimateCustomerName(),
    lineItems: valid.map((line) => ({
      itemId: line.itemId,
      customName: line.customName || null,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
    })),
  };
}

async function saveCurrentEstimate() {
  const payload = buildEstimateSavePayload();
  if (!payload) {
    toast('Add at least one item with a name and quantity', true);
    return null;
  }

  try {
    const saved = await api('/estimates', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    await loadEstimateHistory();
    return saved;
  } catch (err) {
    toast(err.message, true);
    return null;
  }
}

async function loadEstimateHistory() {
  try {
    savedEstimates = await api('/estimates');
  } catch {
    savedEstimates = [];
  }
  renderEstimateHistory();
}

function renderEstimateHistory() {
  const container = document.getElementById('estimate-history');
  if (!savedEstimates.length) {
    container.innerHTML = '<p class="hint">No saved estimates yet.</p>';
    return;
  }

  container.innerHTML = savedEstimates
    .map(
      (est) => `
    <article class="estimate-history-card">
      <header>
        <div>
          <strong>${est.customerName ? escapeHtml(est.customerName) : 'No name'}</strong>
          <div class="meta">${fmtDate(est.createdAt)}</div>
        </div>
        <strong>${fmt(est.subtotal)}</strong>
      </header>
      <ul>
        ${est.lineItems
          .map(
            (l) =>
              `<li>${l.quantity}× ${escapeHtml(l.itemName)} — ${fmt(l.unitPrice)} each</li>`
          )
          .join('')}
      </ul>
      <div class="estimate-history-actions">
        <button type="button" class="primary" data-promote-estimate="${est.id}">Record as sale</button>
      </div>
    </article>`
    )
    .join('');
}

function promoteEstimateToSale(estimate) {
  const promotable = estimate.lineItems.filter(
    (l) => l.itemId && l.itemId !== 'custom'
  );
  const skipped = estimate.lineItems.length - promotable.length;

  if (promotable.length === 0) {
    toast('This estimate has no inventory items to sell', true);
    return;
  }

  const form = document.getElementById('sale-form');
  form.elements.buyerName.value = estimate.customerName || '';
  form.elements.referenceNumber.value = '';
  form.elements.notes.value = '';

  saleLines = promotable.map((l) => ({
    itemId: l.itemId,
    quantity: l.quantity,
    unitPrice: l.unitPrice,
  }));
  renderSaleLines();

  document.getElementById('record-sale-section').scrollIntoView({ behavior: 'smooth', block: 'start' });

  if (skipped > 0) {
    toast('Custom items skipped — add payment info and complete the sale', true);
  } else {
    toast('Estimate loaded — add reference no. and complete the sale');
  }

  setTimeout(() => form.elements.referenceNumber.focus(), 300);
}

function updateEstimateStockAlerts() {
  const issues = getEstimateStockIssues();
  const el = document.getElementById('estimate-stock-alerts');

  if (issues.length === 0) {
    el.classList.add('hidden');
    el.innerHTML = '';
    return;
  }

  el.classList.remove('hidden');
  el.innerHTML = `
    <strong>⚠️ Not enough stock</strong>
    <ul>${issues
      .map(
        (i) =>
          `<li><strong>${escapeHtml(i.name)}</strong> — customer wants ${i.requested}, only ${i.available} in stock (${i.shortfall} short)</li>`
      )
      .join('')}</ul>`;
}

function updateEstimatePreview() {
  const preview = document.getElementById('estimate-preview');
  preview.textContent = buildEstimateText({ randomize: false }) || 'Add items to see the estimate preview.';
  updateEstimateStockAlerts();
}

function renderEstimateLines() {
  const container = document.getElementById('estimate-lines');
  if (estimateLines.length === 0) {
    container.innerHTML = '<p class="hint">Add the items the buyer requested.</p>';
    updateEstimatePreview();
    return;
  }

  const stockIssues = getEstimateStockIssues();
  const issueIds = new Set(stockIssues.map((i) => i.itemId));

  container.innerHTML = estimateLines
    .map((line, idx) => {
      const isCustom = line.itemId === 'custom';
      const item = !isCustom && line.itemId ? items.find((i) => i.id === line.itemId) : null;
      const overstock = item && issueIds.has(item.id);

      const itemControl = isCustom
        ? `<input type="text" data-field="customName" class="line-input" value="${escapeHtml(line.customName || '')}" placeholder="Type item name">`
        : renderItemPicker(line.itemId, { inStockOnly: false, includeCustom: true });
      const stockNote = item
        ? `<span class="line-note estimate-stock-hint ${line.quantity > item.quantity ? 'over' : ''}">${item.quantity} in stock</span>`
        : '<span class="line-note line-note-spacer" aria-hidden="true">&nbsp;</span>';

      return `
    <div class="line-row estimate-line ${overstock ? 'overstock' : ''}" data-idx="${idx}">
      ${renderLineCell('Item', itemControl, { note: '<span class="line-note line-note-spacer" aria-hidden="true">&nbsp;</span>' })}
      ${renderLineCell('Qty', `<input type="number" min="1" data-field="quantity" class="line-input ${item && line.quantity > item.quantity ? 'qty-low' : ''}" value="${line.quantity}">`, { note: stockNote })}
      ${renderLineCell('SRP', `<input type="number" min="0" step="0.01" data-field="unitPrice" class="line-input" value="${line.unitPrice ?? ''}">`)}
      <div class="line-cell line-cell-action">
        <span class="line-label line-label-empty" aria-hidden="true">&nbsp;</span>
        <div class="line-control">
          <button type="button" class="icon-btn line-remove" data-remove>Remove</button>
        </div>
      </div>
    </div>`;
    })
    .join('');

  updateEstimatePreview();
}

function handleEstimateInput(e) {
  const row = e.target.closest('.estimate-line');
  if (!row || !e.target.dataset.field) return;

  const idx = Number(row.dataset.idx);
  const line = estimateLines[idx];
  if (!line) return;

  const field = e.target.dataset.field;

  if (field === 'customName') {
    line.customName = e.target.value;
    updateEstimatePreview();
  } else if (field === 'quantity') {
    line.quantity = Number(e.target.value) || 1;
    renderEstimateLines();
  } else if (field === 'unitPrice') {
    line.unitPrice = Number(e.target.value) || 0;
    updateEstimatePreview();
  }
}

function handleEstimatePick(e) {
  const row = e.target.closest('.estimate-line');
  if (!row) return;
  const idx = Number(row.dataset.idx);
  const line = estimateLines[idx];
  if (!line) return;

  line.itemId = e.detail.itemId;
  if (e.detail.itemId === 'custom') {
    line.customName = line.customName || '';
  } else {
    const item = items.find((i) => i.id === e.detail.itemId);
    line.unitPrice = item?.srp ?? line.unitPrice ?? 0;
  }
  renderEstimateLines();
}

function handleEstimateClick(e) {
  const removeBtn = e.target.closest('[data-remove]');
  if (!removeBtn) return;
  const row = removeBtn.closest('.estimate-line');
  if (!row) return;
  estimateLines.splice(Number(row.dataset.idx), 1);
  renderEstimateLines();
}

document.getElementById('estimate-lines').addEventListener('change', handleEstimateInput);
document.getElementById('estimate-lines').addEventListener('input', handleEstimateInput);
document.getElementById('estimate-lines').addEventListener('click', handleEstimateClick);
document.getElementById('estimate-lines').addEventListener('itempick', handleEstimatePick);

document.getElementById('estimate-customer-name').addEventListener('input', updateEstimatePreview);

document.getElementById('btn-save-estimate').addEventListener('click', async () => {
  const saved = await saveCurrentEstimate();
  if (saved) toast('Estimate saved');
});

document.getElementById('estimate-history').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-promote-estimate]');
  if (!btn) return;
  const estimate = savedEstimates.find((est) => est.id === btn.dataset.promoteEstimate);
  if (estimate) promoteEstimateToSale(estimate);
});

document.getElementById('btn-add-estimate-line').addEventListener('click', () => {
  if (items.length === 0) {
    toast('No inventory items — add items first', true);
    return;
  }
  estimateLines.push({
    itemId: '',
    quantity: 1,
    unitPrice: null,
  });
  renderEstimateLines();
  focusLastPicker('estimate-lines');
});

document.getElementById('btn-copy-estimate').addEventListener('click', async () => {
  const text = buildEstimateText({ randomize: true });
  if (!text) {
    toast('Add at least one item with a name and quantity', true);
    return;
  }
  await saveCurrentEstimate();
  const issues = getEstimateStockIssues();
  if (issues.length > 0) {
    toast(`Warning: ${issues.length} item(s) exceed stock`, true);
  }
  await copyToClipboard(text);
});

// Sales log
async function loadSales() {
  sales = await api('/sales');
  renderSales(document.getElementById('sales-search').value);
}

function buildShareMessage(sale) {
  const templates = cfg().shareTemplates;
  const greetingTemplate = pickRandom(templates.salesGreetings);
  const greeting = greetingTemplate
    ? fillTemplate(greetingTemplate, templateVars({ name: sale.buyerName }))
    : `Thank you, ${sale.buyerName}!`;
  const items = sale.lineItems
    .map((l) => `• ${l.quantity}× ${l.itemName}`)
    .join('\n');

  return [
    greeting,
    '',
    cfg().labels.itemsPurchased,
    items,
    '',
    pickRandom(templates.salesClosings),
  ].join('\n');
}

async function copyShareMessage(saleId) {
  const sale = sales.find((s) => s.id === saleId);
  if (!sale) return;
  await copyToClipboard(buildShareMessage(sale));
}

function renderSales(filter = '') {
  const q = filter.toLowerCase();
  const filtered = sales.filter(
    (s) =>
      s.buyerName.toLowerCase().includes(q) ||
      s.referenceNumber.toLowerCase().includes(q) ||
      (s.notes || '').toLowerCase().includes(q)
  );

  const list = document.getElementById('sales-list');
  if (filtered.length === 0) {
    list.innerHTML = '<p class="hint">No sales yet.</p>';
    return;
  }

  list.innerHTML = filtered
    .map(
      (s) => `
    <article class="sale-card">
      <header>
        <div>
          <strong>${escapeHtml(s.buyerName)}</strong>
          <div class="meta">${fmtDate(s.soldAt)} · ${escapeHtml(s.paymentMethod)} · Ref: ${escapeHtml(s.referenceNumber)}</div>
        </div>
        <div>
          <strong>${fmt(s.subtotal)}</strong>
          <div class="meta">Profit ${fmt(s.totalProfit)}</div>
        </div>
      </header>
      <ul>
        ${s.lineItems.map((l) => `<li>${l.quantity}× ${escapeHtml(l.itemName)} @ ${fmt(l.unitPrice)}</li>`).join('')}
      </ul>
      ${s.notes ? `<p class="meta">${escapeHtml(s.notes)}</p>` : ''}
      <div class="sale-actions">
        <button type="button" class="secondary" data-share="${s.id}">Copy for social media</button>
      </div>
    </article>`
    )
    .join('');

  list.querySelectorAll('[data-share]').forEach((btn) => {
    btn.addEventListener('click', () => copyShareMessage(btn.dataset.share));
  });
}

document.getElementById('sales-search').addEventListener('input', (e) => {
  renderSales(e.target.value);
});

// Pick-Up schedule
let pickupConfig = {
  contactNumber: '',
  locations: [],
  schedules: {},
};

function getPickupLocations() {
  return pickupConfig.locations?.length
    ? pickupConfig.locations
    : cfg().pickupLocations || [];
}

function renderPickupLocationCards() {
  const container = document.getElementById('pickup-locations');
  const locations = getPickupLocations();
  const hoursPlaceholder = cfg().pickup.hoursPlaceholder || 'e.g. 9:00 AM - 5:00 PM';

  container.innerHTML = locations
    .map(
      (loc) => `
    <article class="pickup-card" data-location-id="${escapeHtml(loc.id)}">
      <label class="pickup-toggle">
        <input type="checkbox" data-field="enabled">
        <span class="pickup-toggle-text">Open for pick-up on this day</span>
      </label>
      <div class="pickup-card-body">
        <div class="pickup-card-title">${escapeHtml(loc.name)}</div>
        <div class="pickup-card-address">${escapeHtml(loc.address || '')}</div>
        <label class="pickup-hours-label">Pick-Up hours
          <input type="text" data-field="hours" placeholder="${escapeHtml(hoursPlaceholder)}">
        </label>
      </div>
    </article>`
    )
    .join('');

  bindPickupCards();
}

function todayIso() {
  const d = new Date();
  const offset = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - offset).toISOString().slice(0, 10);
}

function setPickupDate(date) {
  document.getElementById('pickup-date').value = date;
}

function fmtPickupDate(isoDate) {
  if (!isoDate) return '';
  const [y, m, d] = isoDate.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(cfg().locale, {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

function isNoPickupMode() {
  return document.querySelector('input[name="pickupMode"]:checked')?.value === 'none';
}

function setPickupMode(noPickup) {
  const mode = noPickup ? 'none' : 'locations';
  const radio = document.querySelector(`input[name="pickupMode"][value="${mode}"]`);
  if (radio) radio.checked = true;
  syncPickupModeUi();
}

function syncPickupModeUi() {
  const noPickup = isNoPickupMode();
  document.getElementById('pickup-locations-wrap').classList.toggle('hidden', noPickup);
  document.getElementById('pickup-none-notice').classList.toggle('hidden', !noPickup);

  if (noPickup) {
    document.querySelectorAll('.pickup-card').forEach((card) => {
      card.querySelector('[data-field="enabled"]').checked = false;
      card.classList.remove('enabled');
    });
  }
}

function applyPickupSchedule(schedule) {
  setPickupMode(Boolean(schedule?.noPickup));

  document.querySelectorAll('.pickup-card').forEach((card) => {
    const id = card.dataset.locationId;
    const entry = schedule?.pickups?.[id] || { enabled: false, hours: '' };
    card.querySelector('[data-field="enabled"]').checked = entry.enabled;
    card.querySelector('[data-field="hours"]').value = entry.hours || '';
    card.classList.toggle('enabled', entry.enabled);
  });
  document.getElementById('pickup-notes').value = schedule?.notes || '';
  updatePickupPreview();
}

let pickupModeBound = false;

function bindPickupCards() {
  document.querySelectorAll('.pickup-card').forEach((card) => {
    card.querySelector('[data-field="enabled"]').addEventListener('change', (e) => {
      if (e.target.checked) {
        setPickupMode(false);
      }
      card.classList.toggle('enabled', e.target.checked);
      updatePickupPreview();
    });
    card.querySelector('[data-field="hours"]').addEventListener('input', updatePickupPreview);
  });

  if (!pickupModeBound) {
    pickupModeBound = true;
    document.querySelectorAll('input[name="pickupMode"]').forEach((radio) => {
      radio.addEventListener('change', () => {
        syncPickupModeUi();
        updatePickupPreview();
      });
    });
  }
}

async function loadPickup() {
  setPickupDate(todayIso());

  try {
    pickupConfig = await api('/pickup');
    if (!pickupConfig.locations?.length) {
      pickupConfig.locations = cfg().pickupLocations || [];
    }
    if (!pickupConfig.contactNumber) {
      pickupConfig.contactNumber = cfg().contactNumber || '';
    }
  } catch {
    pickupConfig = {
      contactNumber: cfg().contactNumber || '',
      locations: cfg().pickupLocations || [],
      schedules: {},
    };
  }

  renderPickupLocationCards();
  const date = document.getElementById('pickup-date').value;
  applyPickupSchedule(pickupConfig.schedules[date]);
}

function getPickupFormState() {
  const pickups = {};
  document.querySelectorAll('.pickup-card').forEach((card) => {
    const id = card.dataset.locationId;
    pickups[id] = {
      enabled: card.querySelector('[data-field="enabled"]').checked,
      hours: card.querySelector('[data-field="hours"]').value.trim(),
    };
  });
  return {
    date: document.getElementById('pickup-date').value,
    notes: document.getElementById('pickup-notes').value.trim(),
    noPickup: isNoPickupMode(),
    pickups,
  };
}

function buildPickupShareMessage(state, { randomNoPickup = true } = {}) {
  const pickup = cfg().pickup;
  const noPickupMessages = cfg().shareTemplates.noPickupMessages || [];
  const lines = [
    pickup.scheduleHeader || '📍 PICK-UP SCHEDULE',
    fmtPickupDate(state.date),
    '',
  ];

  if (state.noPickup) {
    lines.push(
      randomNoPickup ? pickRandom(noPickupMessages) : noPickupMessages[0] || ''
    );
  } else {
    const locations = getPickupLocations();
    const active = locations.filter((loc) => state.pickups[loc.id]?.enabled);

    if (active.length === 0) {
      lines.push(pickRandom(noPickupMessages));
    } else {
      lines.push(pickup.activePointsLabel || "Today's pick-up points:", '');
      for (const loc of active) {
        const hours = state.pickups[loc.id].hours || pickup.hoursTba || 'Hours TBA';
        lines.push(`• ${loc.name}`);
        lines.push(`  ${loc.address}`);
        lines.push(`  🕐 ${hours}`, '');
      }
    }
  }

  if (state.notes) {
    lines.push(state.notes, '');
  }

  const contact = pickupConfig.contactNumber || cfg().contactNumber;
  if (contact) {
    lines.push(`${pickup.contactLabel || 'Contact:'} ${contact}`);
  }
  lines.push('', pickup.closingThanks || 'Thank you!');

  return lines.join('\n').replace(/\n{3,}/g, '\n\n');
}

function updatePickupPreview() {
  const preview = document.getElementById('pickup-preview');
  preview.textContent = buildPickupShareMessage(getPickupFormState(), { randomNoPickup: false });
}

document.getElementById('pickup-date').addEventListener('change', (e) => {
  const schedule = pickupConfig?.schedules?.[e.target.value];
  applyPickupSchedule(schedule);
});

document.getElementById('pickup-notes').addEventListener('input', updatePickupPreview);

document.getElementById('btn-save-pickup').addEventListener('click', async () => {
  const state = getPickupFormState();
  if (!state.date) {
    toast('Choose a date', true);
    return;
  }

  if (!state.noPickup) {
    for (const loc of getPickupLocations()) {
      const entry = state.pickups[loc.id];
      if (entry?.enabled && !entry.hours) {
        toast(`Set hours for ${loc.name}`, true);
        return;
      }
    }
  }

  try {
    await api('/pickup/schedule/' + state.date, {
      method: 'PUT',
      body: JSON.stringify({
        noPickup: state.noPickup,
        pickups: state.pickups,
        notes: state.notes,
      }),
    });
    pickupConfig = await api('/pickup');
    toast('Pick-Up schedule saved');
    updatePickupPreview();
  } catch (err) {
    toast(err.message || 'Could not save — restart the server (npm start)', true);
  }
});

document.getElementById('btn-copy-pickup').addEventListener('click', () => {
  const state = getPickupFormState();

  if (!state.noPickup) {
    const hasEnabled = Object.values(state.pickups).some((p) => p.enabled);
    if (!hasEnabled) {
      toast('Select pick-up locations or choose “No pick-up on this date”', true);
      return;
    }
    for (const loc of getPickupLocations()) {
      const entry = state.pickups[loc.id];
      if (entry?.enabled && !entry.hours) {
        toast(`Set hours for ${loc.name}`, true);
        return;
      }
    }
  }

  copyToClipboard(buildPickupShareMessage(state, { randomNoPickup: true }));
});

// Boot
(async () => {
  try {
    await loadShopConfig();
    setPickupDate(todayIso());
    updatePickupPreview();
    await loadDashboard();
  } catch (err) {
    toast(err.message || 'Failed to load shop config', true);
  }
})();
