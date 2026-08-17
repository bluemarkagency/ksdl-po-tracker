(() => {
  'use strict';

  const CONFIG = window.PO_TRACKER_CONFIG || {};
  const BASE_URL = String(CONFIG.SUPABASE_URL || '').replace(/\/$/, '');
  const PUBLIC_KEY = CONFIG.SUPABASE_ANON_KEY || '';
  const SESSION_KEY = 'ksdl-po-tracker-session';
  const COMPANY = 'BLUE MARK AGENCY - GUJARAT';
  const NUMBER = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 });
  const MONEY = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
  let session = null;
  let refreshPromise = null;
  let currentRows = [];
  let snapshots = [];
  let syncStatus = null;

  const $ = id => document.getElementById(id);
  const safe = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  const show = id => $(id).classList.remove('hidden');
  const hide = id => $(id).classList.add('hidden');
  const value = number => Number(number || 0);
  const number = input => NUMBER.format(value(input));
  const money = input => MONEY.format(value(input));
  const sum = (rows, key) => rows.reduce((total, row) => total + value(row[key]), 0);
  const localIso = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

  function toast(message) {
    $('toast').textContent = message;
    $('toast').classList.add('show');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => $('toast').classList.remove('show'), 3500);
  }
  function saveSession(next) { session = next; sessionStorage.setItem(SESSION_KEY, JSON.stringify(next)); }
  function tokenExpiresSoon() {
    if (!session?.access_token) return false;
    const expiresAt = Number(session.expires_at || 0);
    return expiresAt && expiresAt * 1000 <= Date.now() + 60000;
  }
  async function refreshSession() {
    if (refreshPromise) return refreshPromise;
    if (!session?.refresh_token) throw new Error('Your session has expired. Please sign in again.');
    refreshPromise = (async () => {
      const response = await fetch(`${BASE_URL}/auth/v1/token?grant_type=refresh_token`, { method: 'POST', headers: { apikey: PUBLIC_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ refresh_token: session.refresh_token }) });
      const data = await response.json();
      if (!response.ok || !data?.access_token) throw new Error(data?.message || data?.error_description || 'Please sign in again.');
      saveSession({ ...session, ...data });
      return session;
    })();
    try { return await refreshPromise; } finally { refreshPromise = null; }
  }
  async function api(path, options = {}, retry = true) {
    const tokenRequest = path.startsWith('/auth/v1/token');
    if (!tokenRequest && session?.refresh_token && tokenExpiresSoon()) await refreshSession();
    const auth = tokenRequest ? PUBLIC_KEY : (session?.access_token || PUBLIC_KEY);
    const response = await fetch(`${BASE_URL}${path}`, { ...options, headers: { apikey: PUBLIC_KEY, Authorization: `Bearer ${auth}`, ...(options.headers || {}) } });
    const text = await response.text();
    let data = null;
    if (text) try { data = JSON.parse(text); } catch (_) { data = text; }
    const message = data?.message || data?.error_description || text || `Request failed (${response.status})`;
    if (!response.ok && retry && !tokenRequest && session?.refresh_token && response.status === 401) { await refreshSession(); return api(path, options, false); }
    if (!response.ok) throw new Error(message);
    return data;
  }
  async function signIn(email, password) {
    saveSession(await api('/auth/v1/token?grant_type=password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) }));
  }
  async function signOut() {
    try { await api('/auth/v1/logout', { method: 'POST' }); } catch (_) {}
    session = null;
    sessionStorage.removeItem(SESSION_KEY);
    hide('app'); show('loginScreen');
  }
  async function ensureAccess() {
    const role = await api('/rest/v1/rpc/po_tracker_role', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    if (!['owner', 'accountant'].includes(String(role || '').toLowerCase())) throw new Error('Only the owner or accountant can access live inventory.');
  }
  function dateTime(value) {
    if (!value) return '—';
    return new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
  }
  function ageText(value) {
    if (!value) return 'No successful sync yet';
    const minutes = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 60000));
    if (minutes < 2) return 'Just now';
    if (minutes < 60) return `${minutes} minutes ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
    const days = Math.floor(hours / 24);
    return `${days} day${days === 1 ? '' : 's'} ago`;
  }
  function stockState(row, threshold) {
    if (row.closing_cbs === null && row.closing_pcs === null) return 'blank';
    if (value(row.closing_cbs) === 0 && value(row.closing_pcs) === 0) return 'zero';
    if (value(row.closing_cbs) <= threshold) return 'low';
    return 'available';
  }
  function stateLabel(state) { return ({ available: 'Available', low: 'Low stock', zero: 'Zero stock', blank: 'Blank balance' })[state] || state; }
  function displayName(name) { return String(name || '').replace(/\s+\?\s+(?=\d+\s*\/-)/, ' ₹ '); }

  function selectedRows() {
    const search = $('inventorySearch').value.trim().toLowerCase();
    const group = $('groupFilter').value;
    const filter = $('stockFilter').value;
    const threshold = Math.max(0, value($('lowStockLevel').value));
    return currentRows.filter(row => {
      const matchesSearch = !search || `${row.item_name} ${row.stock_group}`.toLowerCase().includes(search);
      const matchesGroup = !group || row.stock_group === group;
      const matchesStock = !filter || stockState(row, threshold) === filter;
      return matchesSearch && matchesGroup && matchesStock;
    });
  }
  function movementRows() {
    const groups = new Map();
    snapshots.forEach(row => {
      if (!groups.has(row.tally_guid)) groups.set(row.tally_guid, []);
      groups.get(row.tally_guid).push(row);
    });
    return [...groups.values()].map(rows => {
      rows.sort((a, b) => String(a.snapshot_date).localeCompare(String(b.snapshot_date)));
      const first = rows[0];
      const last = rows[rows.length - 1];
      return { tally_guid: last.tally_guid, item_name: last.item_name, earlier: value(first.closing_cbs), current: value(last.closing_cbs), delta: value(last.closing_cbs) - value(first.closing_cbs), first_date: first.snapshot_date, last_date: last.snapshot_date };
    }).filter(row => row.first_date !== row.last_date).sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  }
  function renderSync() {
    const banner = $('syncBanner');
    banner.className = `sync-banner ${syncStatus?.status === 'Failed' ? 'failed' : syncStatus?.status === 'Success' ? 'success' : 'waiting'}`;
    if (!syncStatus) {
      $('syncHeadline').textContent = 'Waiting for the first Tally sync';
      $('syncDetail').textContent = 'Run the secure Windows connector after completing setup.';
      $('syncMachine').textContent = 'Tally source';
      return;
    }
    const success = syncStatus.status === 'Success';
    $('syncHeadline').textContent = success ? `Tally synced successfully · ${syncStatus.item_count || 0} items` : `${syncStatus.status}: Tally stock sync`;
    $('syncDetail').textContent = syncStatus.last_error || `Last successful sync ${ageText(syncStatus.last_success_at)} · ${dateTime(syncStatus.last_success_at)}`;
    $('syncMachine').textContent = syncStatus.source_machine || 'Tally PC';
  }
  function renderSummary() {
    const groups = new Set(currentRows.map(row => row.stock_group).filter(Boolean));
    const zero = currentRows.filter(row => stockState(row, 5) === 'zero').length;
    const blank = currentRows.filter(row => stockState(row, 5) === 'blank').length;
    const movement = movementRows();
    const delta = movement.reduce((total, row) => total + row.delta, 0);
    $('stockItemCount').textContent = currentRows.length;
    $('stockGroupCount').textContent = `${groups.size} product group${groups.size === 1 ? '' : 's'}`;
    $('closingCbs').textContent = `${number(sum(currentRows, 'closing_cbs'))} CBS`;
    $('closingPcs').textContent = `${number(sum(currentRows, 'closing_pcs'))} PCS`;
    $('stockValue').textContent = money(sum(currentRows, 'closing_value'));
    $('zeroStockCount').textContent = zero + blank;
    $('blankStockCount').textContent = `${blank} blank balance${blank === 1 ? '' : 's'}`;
    $('sevenDayMovement').textContent = `${delta > 0 ? '+' : ''}${number(delta)} CBS`;
    $('movementCoverage').textContent = movement.length ? `${movement.length} items with history` : 'Waiting for history';
  }
  function renderActions() {
    const threshold = Math.max(0, value($('lowStockLevel').value));
    const zeroRows = currentRows.filter(row => stockState(row, threshold) === 'zero');
    const lowRows = currentRows.filter(row => stockState(row, threshold) === 'low');
    const blankRows = currentRows.filter(row => stockState(row, threshold) === 'blank');
    const stale = !syncStatus?.last_success_at || Date.now() - new Date(syncStatus.last_success_at).getTime() > 60 * 60 * 1000;
    const actions = [
      { tone: zeroRows.length ? 'danger' : '', icon: '0', title: `${zeroRows.length} zero-stock article${zeroRows.length === 1 ? '' : 's'}`, text: zeroRows.length ? `Review replenishment for ${zeroRows.slice(0, 3).map(row => displayName(row.item_name)).join(', ')}${zeroRows.length > 3 ? ' and others' : ''}.` : 'No article currently has an exact zero balance.' },
      { tone: lowRows.length ? 'warning' : '', icon: '!', title: `${lowRows.length} low-stock article${lowRows.length === 1 ? '' : 's'}`, text: `Using the current owner threshold of ${number(threshold)} CBS or fewer.` },
      { tone: blankRows.length ? 'warning' : '', icon: '?', title: `${blankRows.length} blank Tally balance${blankRows.length === 1 ? '' : 's'}`, text: blankRows.length ? 'These items exist in Tally but do not currently return a closing quantity.' : 'Every stock master currently has a closing balance.' },
      { tone: stale ? 'warning' : '', icon: '↻', title: stale ? 'Sync requires attention' : 'Automatic sync is healthy', text: syncStatus?.last_success_at ? `Last successful update ${ageText(syncStatus.last_success_at)}.` : 'Complete the Windows connector setup to begin syncing.' }
    ];
    $('actionList').innerHTML = actions.map(action => `<article class="stock-action ${action.tone}"><i>${safe(action.icon)}</i><div><strong>${safe(action.title)}</strong><span>${safe(action.text)}</span></div></article>`).join('');
  }
  function renderTable() {
    const rows = selectedRows();
    const threshold = Math.max(0, value($('lowStockLevel').value));
    $('inventoryResultCount').textContent = `${rows.length} article${rows.length === 1 ? '' : 's'}`;
    $('inventoryBody').innerHTML = rows.map(row => {
      const state = stockState(row, threshold);
      return `<tr><td class="inventory-item"><strong>${safe(displayName(row.item_name))}</strong><span>${safe(row.base_unit || '—')} · ${safe(row.additional_unit || '—')}</span></td><td>${safe(row.stock_group || '—')}</td><td class="stock-number">${row.closing_cbs === null ? '—' : number(row.closing_cbs)}</td><td class="stock-number">${row.closing_pcs === null ? '—' : number(row.closing_pcs)}</td><td class="tally-balance">${safe(row.closing_balance_raw || '—')}</td><td>${row.closing_value === null ? '—' : money(row.closing_value)}</td><td><span class="stock-pill ${state}">${safe(stateLabel(state))}</span></td><td>${safe(dateTime(row.synced_at))}</td></tr>`;
    }).join('');
    $('inventoryEmpty').classList.toggle('hidden', rows.length > 0);
  }
  function renderMovement() {
    const rows = movementRows();
    $('movementBody').innerHTML = rows.map(row => {
      const direction = row.delta > 0 ? 'increase' : row.delta < 0 ? 'decrease' : 'flat';
      const label = row.delta > 0 ? 'Net inward' : row.delta < 0 ? 'Net outward' : 'No change';
      return `<tr><td class="inventory-item"><strong>${safe(displayName(row.item_name))}</strong></td><td>${number(row.earlier)}</td><td>${number(row.current)}</td><td class="stock-number">${row.delta > 0 ? '+' : ''}${number(row.delta)} CBS</td><td><span class="movement-pill ${direction}">${label}</span></td></tr>`;
    }).join('');
    $('movementEmpty').classList.toggle('hidden', rows.length > 0);
    $('historyPeriod').textContent = rows.length ? `${rows.length} articles compared` : 'Waiting for history';
  }
  function render() { renderSync(); renderSummary(); renderActions(); renderTable(); renderMovement(); }
  function populateGroups() {
    const current = $('groupFilter').value;
    const groups = [...new Set(currentRows.map(row => row.stock_group).filter(Boolean))].sort((a, b) => a.localeCompare(b));
    $('groupFilter').innerHTML = '<option value="">All groups</option>' + groups.map(group => `<option value="${safe(group)}">${safe(group)}</option>`).join('');
    if (groups.includes(current)) $('groupFilter').value = current;
  }
  async function loadData() {
    $('connectionStatus').textContent = 'Loading inventory…';
    const from = new Date(); from.setDate(from.getDate() - 7);
    [currentRows, snapshots] = await Promise.all([
      api('/rest/v1/inventory_stock_current?is_active=eq.true&select=*&order=item_name.asc'),
      api(`/rest/v1/inventory_stock_snapshots?select=tally_guid,item_name,snapshot_date,closing_cbs&snapshot_date=gte.${localIso(from)}&order=snapshot_date.asc`)
    ]);
    const statuses = await api(`/rest/v1/inventory_sync_status?tally_company=eq.${encodeURIComponent(COMPANY)}&select=*`);
    syncStatus = statuses?.[0] || null;
    populateGroups(); render();
    $('connectionStatus').textContent = syncStatus?.last_success_at ? `Tally · ${ageText(syncStatus.last_success_at)}` : 'Connected · waiting for Tally';
  }
  function csvCell(value) { return `"${String(value ?? '').replace(/"/g, '""')}"`; }
  function exportCsv() {
    const rows = selectedRows();
    const headers = ['Article', 'Product group', 'Closing CBS', 'Closing PCS', 'Tally balance', 'Stock value', 'Last synced'];
    const lines = [headers, ...rows.map(row => [displayName(row.item_name), row.stock_group, row.closing_cbs, row.closing_pcs, row.closing_balance_raw, row.closing_value, row.synced_at])];
    const blob = new Blob(['\ufeff' + lines.map(line => line.map(csvCell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = `blue-mark-tally-stock-${localIso(new Date())}.csv`; link.click(); URL.revokeObjectURL(link.href);
  }
  async function start() {
    if (!BASE_URL || !PUBLIC_KEY) throw new Error('Supabase configuration is missing.');
    if (/^(sb_secret_|eyJ.*service_role)/i.test(PUBLIC_KEY)) throw new Error('A private Supabase key cannot be used in this page.');
    const saved = JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null');
    if (!saved?.access_token) { show('loginScreen'); hide('app'); return; }
    session = saved;
    if (tokenExpiresSoon()) await refreshSession();
    await ensureAccess();
    hide('loginScreen'); show('app');
    $('signedInAs').textContent = session.user?.email || '';
    await loadData();
  }

  $('loginForm').addEventListener('submit', async event => { event.preventDefault(); $('loginError').textContent = ''; try { await signIn($('emailInput').value.trim(), $('passwordInput').value); await start(); } catch (error) { $('loginError').textContent = error.message; } });
  $('signOutBtn').addEventListener('click', signOut);
  $('refreshBtn').addEventListener('click', () => loadData().catch(error => toast(error.message)));
  ['inventorySearch', 'lowStockLevel'].forEach(id => $(id).addEventListener('input', render));
  ['groupFilter', 'stockFilter'].forEach(id => $(id).addEventListener('change', render));
  $('clearFilters').addEventListener('click', () => { $('inventorySearch').value = ''; $('groupFilter').value = ''; $('stockFilter').value = ''; $('lowStockLevel').value = '5'; render(); });
  $('exportInventory').addEventListener('click', exportCsv);
  start().catch(error => { sessionStorage.removeItem(SESSION_KEY); hide('app'); show('loginScreen'); $('loginError').textContent = error.message; });
})();
