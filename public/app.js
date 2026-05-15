'use strict';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let playerId = '';
let currentPage = 0;
let currentPageSize = 20;
const expandedInventoryItems = new Set();

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------
const $ = id => document.getElementById(id);

function log(label, data) {
  const el = $('responseLog');
  const ts = new Date().toLocaleTimeString();
  const entry = `[${ts}] ${label}\n${JSON.stringify(data, null, 2)}\n${'─'.repeat(60)}\n`;
  el.textContent = entry + el.textContent;
}

function showMsg(el, text, isError = false) {
  el.textContent = text;
  el.className = 'status-msg ' + (isError ? 'error' : 'success');
  setTimeout(() => { el.textContent = ''; el.className = 'status-msg'; }, 4000);
}

async function api(method, path, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const res = await fetch(path, opts);
  const json = await res.json();
  if (!res.ok) throw Object.assign(new Error(json.error || 'Request failed'), { data: json });
  return json;
}

// ---------------------------------------------------------------------------
// Health / status dot
// ---------------------------------------------------------------------------
async function checkHealth() {
  const dot = $('statusDot');
  try {
    const h = await api('GET', '/api/health');
    log('Health', h);
    dot.classList.remove('dot-ok', 'dot-err');
    dot.classList.add('dot-ok');
  } catch (e) {
    dot.classList.remove('dot-ok', 'dot-err');
    dot.classList.add('dot-err');
  }
}

// ---------------------------------------------------------------------------
// Inventory helpers
// ---------------------------------------------------------------------------
// Returns the id of the item whose item_template_id matches `templateId`, or null.
function findContainerId(items, templateId) {
  const container = items.find(i => i.item_template_id === templateId);
  return container ? container.id : null;
}

function renderItemCard(item, options = {}) {
  const { clickable = false, hasChildren = false, expanded = false, childCount = 0 } = options;
  const div = document.createElement('div');
  div.className =
    'item-card' +
    ((clickable || hasChildren) ? ' item-clickable' : '') +
    (hasChildren ? ' item-expandable' : '') +
    (expanded ? ' item-expanded' : '');
  div.title = item.id;
  if (clickable || hasChildren) div.dataset.itemId = item.id;

  const name = item.item_template_id || item.id;
  const shortId = item.id ? item.id.split('-')[0] : '?';
  div.innerHTML = `
    <div class="item-name">
      ${hasChildren ? `<span class="item-expand-icon">${expanded ? '▼' : '▶'}</span>` : ''}
      ${escHtml(name)}
    </div>
    <div class="item-meta">
      <span class="tag">id:${escHtml(shortId)}…</span>
      <span class="tag">×${item.count ?? 1}</span>
      ${item.level ? `<span class="tag">lv${item.level}</span>` : ''}
      ${hasChildren ? `<span class="tag">contains:${childCount}</span>` : ''}
    </div>`;
  return div;
}

function escHtml(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function setMoneyLabel(value) {
  const el = $('moneyValue');
  if (!el) return;
  el.textContent = String(value);
}

function getUserCurrencyInBackpack(items, backpackId) {
  if (!backpackId) return 0;

  const resourceContainerTemplateIds = new Set(['resources_container', 'container_resources']);
  const currencyTemplateIds = new Set(['currency_coupons', 'currency_cupons']);

  // Resource container should live in backpack and contain currency stacks.
  const resourcesContainer = items.find(i =>
    resourceContainerTemplateIds.has(i.item_template_id) &&
    i.storage &&
    i.storage.storage_id === backpackId
  );

  if (!resourcesContainer) return 0;

  const moneyItems = items.filter(i =>
    i.storage &&
    i.storage.storage_id === resourcesContainer.id &&
    currencyTemplateIds.has(i.item_template_id)
  );

  return moneyItems.reduce((sum, i) => sum + (parseInt(i.count, 10) || 0), 0);
}

// ---------------------------------------------------------------------------
// Inventory panel
// ---------------------------------------------------------------------------
async function loadInventoryPanels() {
  if (!playerId) return;

  const invEl       = $('inventoryList');
  const wareEl      = $('warehouseList');
  const auctionEl   = $('auctionStoreList');

  invEl.innerHTML     = '<div class="loading">Loading…</div>';
  wareEl.innerHTML    = '<div class="loading">Loading…</div>';
  auctionEl.innerHTML = '<div class="loading">Loading…</div>';

  try {
    const data = await api('GET', `/api/inventory/${encodeURIComponent(playerId)}/items?pageSize=200`);
    log('ListItems', data);

    const items = data.items || [];

    // The backpack, storage and auction store are themselves items in the inventory.
    // Items that live inside them reference the container's id via storage.storage_id.
    const backpackId     = findContainerId(items, 'user_backpack');
    const storageId      = findContainerId(items, 'user_storage');
    // Keep backward compatibility in case old data used 'user_auction_store'.
    const auctionStoreId =
      findContainerId(items, 'user_auction_storage') ||
      findContainerId(items, 'user_auction_store');

    const backpackItems     = backpackId
      ? items.filter(i => i.storage && i.storage.storage_id === backpackId)
      : [];

    const storageItems = storageId
      ? items.filter(i => i.storage && i.storage.storage_id === storageId)
      : [];

    const auctionStoreItems = auctionStoreId
      ? items.filter(i => i.storage && i.storage.storage_id === auctionStoreId)
      : [];

    const money = getUserCurrencyInBackpack(items, backpackId);
    setMoneyLabel(money);

    renderItemList(invEl,     backpackItems,     true,  items);
    renderItemList(wareEl,    storageItems,      true,  items);
    renderItemList(auctionEl, auctionStoreItems, false, items);

    if (!backpackId)     invEl.innerHTML     = '<div class="placeholder">Backpack container (user_backpack) not found.</div>';
    if (!storageId)      wareEl.innerHTML    = '<div class="placeholder">Storage container (user_storage) not found.</div>';
    if (!auctionStoreId) {
      auctionEl.innerHTML = '<div class="placeholder">Auction store (user_auction_storage) not found.</div>';
    }
  } catch (e) {
    log('ListItems ERROR', e.data || e.message);
    invEl.innerHTML     = `<div class="error-msg">${escHtml(e.message)}</div>`;
    wareEl.innerHTML    = `<div class="error-msg">${escHtml(e.message)}</div>`;
    auctionEl.innerHTML = `<div class="error-msg">${escHtml(e.message)}</div>`;
    setMoneyLabel('ERR');
  }
}

function renderItemList(container, items, clickable, allItems = items) {
  container.innerHTML = '';
  if (!items.length) {
    container.innerHTML = '<div class="placeholder">No items.</div>';
    return;
  }

  const childrenByParent = new Map();
  allItems.forEach(item => {
    const parentId = item.storage && item.storage.storage_id;
    if (!parentId) return;
    if (!childrenByParent.has(parentId)) childrenByParent.set(parentId, []);
    childrenByParent.get(parentId).push(item);
  });

  const fragment = document.createDocumentFragment();
  items.forEach(item => renderItemNode(fragment, item, 0, new Set()));
  container.appendChild(fragment);

  function renderItemNode(target, item, depth, ancestors) {
    const childItems = childrenByParent.get(item.id) || [];
    const hasChildren = childItems.length > 0;
    const expanded = hasChildren && expandedInventoryItems.has(item.id);

    const card = renderItemCard(item, {
      clickable,
      hasChildren,
      expanded,
      childCount: childItems.length,
    });

    if (depth > 0) card.classList.add('item-nested');
    card.style.marginLeft = `${depth * 14}px`;

    card.addEventListener('click', () => {
      if (clickable) {
        $('clItemId').value = item.id;
        $('clItemId').focus();
      }

      if (!hasChildren) return;

      if (expandedInventoryItems.has(item.id)) {
        expandedInventoryItems.delete(item.id);
      } else {
        expandedInventoryItems.add(item.id);
      }

      renderItemList(container, items, clickable, allItems);
    });

    target.appendChild(card);
    if (!expanded) return;

    const nextAncestors = new Set(ancestors);
    nextAncestors.add(item.id);

    childItems.forEach(child => {
      // Guard against malformed cyclic graphs.
      if (nextAncestors.has(child.id)) return;
      renderItemNode(target, child, depth + 1, nextAncestors);
    });
  }
}

// ---------------------------------------------------------------------------
// My Lots panel
// ---------------------------------------------------------------------------
async function loadMyLots() {
  if (!playerId) return;

  const el = $('myLotsList');
  el.innerHTML = '<div class="loading">Loading…</div>';

  try {
    const data = await api('GET', `/api/auction/lots/owner/${encodeURIComponent(playerId)}`);
    log('GetLotsByOwner', data);

    const lots = data.lots || [];
    el.innerHTML = '';

    if (!lots.length) {
      el.innerHTML = '<div class="placeholder">No active lots.</div>';
      return;
    }

    lots.forEach(lot => {
      const div = document.createElement('div');
      div.className = 'lot-card';

      const endTime = lot.end_time && lot.end_time.seconds
        ? new Date(Number(lot.end_time.seconds) * 1000).toLocaleString()
        : '—';

      div.innerHTML = `
        <div class="lot-card-title">${escHtml(lot.item_full_name || lot.item_type || lot.item_id)}</div>
        <div class="lot-card-meta">
          <span class="tag">${escHtml(lot.status)}</span>
          <span class="tag">start: ${lot.start_price}</span>
          ${lot.buy_mode_enabled ? `<span class="tag">buy: ${lot.buy_price}</span>` : ''}
          ${lot.bid_mode_enabled ? `<span class="tag">bid: ${lot.highest_bid_amount}</span>` : ''}
          <span class="tag tag-dim">ends ${escHtml(endTime)}</span>
        </div>
        <div class="lot-card-id">${escHtml(lot.lot_id)}</div>
        <button class="btn btn-danger btn-xs cancel-lot-btn" data-lot-id="${escHtml(lot.lot_id)}">Cancel</button>`;
      el.appendChild(div);
    });

    // bind cancel buttons
    el.querySelectorAll('.cancel-lot-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const lotId = btn.dataset.lotId;
        if (!confirm(`Cancel lot ${lotId}?`)) return;
        try {
          const r = await api('DELETE', `/api/auction/lots/${encodeURIComponent(lotId)}?ownerId=${encodeURIComponent(playerId)}`);
          log('CancelLot', r);
          await Promise.all([loadMyLots(), loadAllLots()]);
        } catch (e) {
          log('CancelLot ERROR', e.data || e.message);
          alert('Error: ' + e.message);
        }
      });
    });

  } catch (e) {
    log('GetLotsByOwner ERROR', e.data || e.message);
    el.innerHTML = `<div class="error-msg">${escHtml(e.message)}</div>`;
  }
}

// ---------------------------------------------------------------------------
// All Lots table
// ---------------------------------------------------------------------------
async function loadAllLots() {
  const tbody = $('lotsTableBody');
  tbody.innerHTML = `<tr><td colspan="9" class="placeholder">Loading…</td></tr>`;

  try {
    const data = await api('GET', `/api/auction/lots?page=${currentPage}&pageSize=${currentPageSize}`);
    log('GetLots', data);

    const lots = data.lots || [];
    tbody.innerHTML = '';

    if (!lots.length) {
      tbody.innerHTML = `<tr><td colspan="9" class="placeholder">No lots found.</td></tr>`;
      updatePager(data.page_info);
      return;
    }

    lots.forEach(lot => {
      const tr = document.createElement('tr');
      if (playerId && lot.owner_id === playerId) tr.classList.add('own-row');

      const endTime = lot.end_time && lot.end_time.seconds
        ? new Date(Number(lot.end_time.seconds) * 1000).toLocaleString()
        : '—';

      const isOwn     = playerId && lot.owner_id === playerId;
      const canBid    = lot.bid_mode_enabled && !isOwn;
      const canBuy    = lot.buy_mode_enabled && !isOwn;
      const canCancel = isOwn;

      tr.innerHTML = `
        <td class="mono">${escHtml(lot.lot_id.slice(0,8))}…</td>
        <td>${escHtml(lot.item_full_name || lot.item_type || lot.item_id)}</td>
        <td class="mono">${escHtml(lot.owner_id.slice(0,8))}…</td>
        <td><span class="status-badge ${statusClass(lot.status)}">${escHtml(lot.status)}</span></td>
        <td class="num">${lot.start_price}</td>
        <td class="num">${lot.buy_mode_enabled ? lot.buy_price : '—'}</td>
        <td class="num">${lot.bid_mode_enabled ? lot.highest_bid_amount : '—'}</td>
        <td class="mono-sm">${escHtml(endTime)}</td>
        <td class="actions-cell">
          ${canBid    ? `<button class="btn btn-info btn-xs"    data-action="bid"    data-lot-id="${escHtml(lot.lot_id)}">Bid</button>` : ''}
          ${canBuy    ? `<button class="btn btn-success btn-xs" data-action="buy"    data-lot-id="${escHtml(lot.lot_id)}">Buy</button>` : ''}
          ${canCancel ? `<button class="btn btn-danger btn-xs"  data-action="cancel" data-lot-id="${escHtml(lot.lot_id)}">Cancel</button>` : ''}
        </td>`;
      tbody.appendChild(tr);
    });

    updatePager(data.page_info);
    bindTableActions();

  } catch (e) {
    log('GetLots ERROR', e.data || e.message);
    tbody.innerHTML = `<tr><td colspan="9" class="error-msg">${escHtml(e.message)}</td></tr>`;
  }
}

function statusClass(s) {
  if (s === 'LOT_STATUS_DTO_ACTIVE') return 'badge-active';
  if (s === 'LOT_STATUS_DTO_CLOSED') return 'badge-closed';
  return 'badge-none';
}

function updatePager(info) {
  $('pageIndicator').textContent = `Page ${currentPage + 1}${info && info.total_pages ? ' / ' + info.total_pages : ''}`;
  $('btnPrevPage').disabled = currentPage <= 0;
  $('btnNextPage').disabled = info && info.total_pages ? currentPage >= info.total_pages - 1 : false;
}

function bindTableActions() {
  document.querySelectorAll('[data-action]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const lotId  = btn.dataset.lotId;
      const action = btn.dataset.action;

      if (action === 'bid') {
        $('bidLotId').textContent = lotId;
        $('bidModalStatus').textContent = '';
        $('bidModal').classList.remove('hidden');
        $('bidModal').dataset.lotId = lotId;
        return;
      }

      if (action === 'buy') {
        if (!confirm(`Buy lot ${lotId}?`)) return;
        try {
          const r = await api('POST', `/api/auction/lots/${encodeURIComponent(lotId)}/buy`, { buyer_id: playerId });
          log('Buy', r);
          await Promise.all([loadAllLots(), loadMyLots(), loadInventoryPanels()]);
        } catch (e) {
          log('Buy ERROR', e.data || e.message);
          alert('Error: ' + e.message);
        }
        return;
      }

      if (action === 'cancel') {
        if (!confirm(`Cancel lot ${lotId}?`)) return;
        try {
          const r = await api('DELETE', `/api/auction/lots/${encodeURIComponent(lotId)}?ownerId=${encodeURIComponent(playerId)}`);
          log('CancelLot', r);
          await Promise.all([loadAllLots(), loadMyLots()]);
        } catch (e) {
          log('CancelLot ERROR', e.data || e.message);
          alert('Error: ' + e.message);
        }
      }
    });
  });
}

// ---------------------------------------------------------------------------
// Create Lot form
// ---------------------------------------------------------------------------
$('createLotForm').addEventListener('submit', async e => {
  e.preventDefault();
  if (!playerId) { alert('Set a Player ID first.'); return; }

  const statusEl = $('createLotStatus');
  const body = {
    owner_id:         playerId,
    item_id:          $('clItemId').value.trim(),
    bid_mode_enabled: $('clBidMode').checked,
    buy_mode_enabled: $('clBuyMode').checked,
    start_price:      parseInt($('clStartPrice').value, 10),
    buy_price:        parseInt($('clBuyPrice').value,   10),
    duration:         parseInt($('clDuration').value,   10),
  };

  try {
    const r = await api('POST', '/api/auction/lots', body);
    log('CreateLot', r);
    showMsg(statusEl, `Lot created: ${r.lot && r.lot.lot_id}`);
    $('createLotForm').reset();
    $('clBidMode').checked = true;
    $('clBuyMode').checked = true;
    $('clStartPrice').value = '100';
    $('clBuyPrice').value   = '500';
    $('clDuration').value   = '3600';
    await Promise.all([loadAllLots(), loadMyLots(), loadInventoryPanels()]);
  } catch (e) {
    log('CreateLot ERROR', e.data || e.message);
    showMsg(statusEl, e.message, true);
  }
});

// ---------------------------------------------------------------------------
// Bid modal
// ---------------------------------------------------------------------------
$('btnConfirmBid').addEventListener('click', async () => {
  const lotId  = $('bidModal').dataset.lotId;
  const amount = parseInt($('bidAmount').value, 10);
  const statusEl = $('bidModalStatus');

  try {
    const r = await api('POST', `/api/auction/lots/${encodeURIComponent(lotId)}/bid`, {
      bidder_id:  playerId,
      bid_amount: amount,
    });
    log('PlaceBid', r);
    showMsg(statusEl, 'Bid placed!');
    setTimeout(() => $('bidModal').classList.add('hidden'), 800);
    await loadAllLots();
  } catch (e) {
    log('PlaceBid ERROR', e.data || e.message);
    showMsg(statusEl, e.message, true);
  }
});

document.querySelectorAll('.modal-close').forEach(btn => {
  btn.addEventListener('click', () => {
    const id = btn.dataset.modal;
    if (id) $(id).classList.add('hidden');
  });
});

// ---------------------------------------------------------------------------
// Player ID set / URL param
// ---------------------------------------------------------------------------
function applyPlayerId(id) {
  playerId = id.trim();
  if (!playerId) return;

  $('playerIdInput').value = playerId;
  $('bannerPlayerId').textContent = playerId;
  $('playerBanner').classList.remove('hidden');

  // update URL without reload
  const url = new URL(window.location);
  url.searchParams.set('playerId', playerId);
  window.history.replaceState({}, '', url);

  refreshAll();
}

$('btnSetPlayer').addEventListener('click', () => applyPlayerId($('playerIdInput').value));
$('playerIdInput').addEventListener('keydown', e => { if (e.key === 'Enter') applyPlayerId($('playerIdInput').value); });

// ---------------------------------------------------------------------------
// Dev helper: add +100 currency
// ---------------------------------------------------------------------------
$('btnAddCurrency').addEventListener('click', async () => {
  if (!playerId) {
    alert('Set a Player ID first.');
    return;
  }

  const btn = $('btnAddCurrency');
  const statusEl = $('headerStatus');

  btn.disabled = true;
  try {
    const r = await api('POST', `/api/inventory/${encodeURIComponent(playerId)}/currency/add`, { amount: 100 });
    log('AddCurrency', r);
    showMsg(statusEl, '+100 currency added');
    await loadInventoryPanels();
  } catch (e) {
    log('AddCurrency ERROR', e.data || e.message);
    showMsg(statusEl, e.message, true);
  } finally {
    btn.disabled = false;
  }
});

// ---------------------------------------------------------------------------
// Pagination
// ---------------------------------------------------------------------------
$('btnPrevPage').addEventListener('click', () => { if (currentPage > 0) { currentPage--; loadAllLots(); } });
$('btnNextPage').addEventListener('click', () => { currentPage++; loadAllLots(); });
$('lotsPageSize').addEventListener('change', () => { currentPageSize = parseInt($('lotsPageSize').value, 10); currentPage = 0; loadAllLots(); });

// ---------------------------------------------------------------------------
// Refresh
// ---------------------------------------------------------------------------
function refreshAll() {
  loadInventoryPanels();
  loadMyLots();
  loadAllLots();
}

$('btnRefreshAll').addEventListener('click', refreshAll);
$('btnRefreshLots').addEventListener('click', loadAllLots);

document.querySelectorAll('.panel-refresh').forEach(btn => {
  btn.addEventListener('click', () => {
    const p = btn.dataset.panel;
    if (p === 'inventory' || p === 'warehouse' || p === 'auctionStore') loadInventoryPanels();
    if (p === 'myLots') loadMyLots();
  });
});

$('btnClearLog').addEventListener('click', () => { $('responseLog').textContent = ''; });

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------
(function init() {
  const params   = new URLSearchParams(window.location.search);
  const urlPlayer = params.get('playerId') || '';

  setMoneyLabel('—');

  checkHealth();
  loadAllLots(); // load lots even without player

  if (urlPlayer) applyPlayerId(urlPlayer);
})();
