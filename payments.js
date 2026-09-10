(() => {
  'use strict';

  const CONFIG = window.PO_TRACKER_CONFIG || {};
  const BASE_URL = String(CONFIG.SUPABASE_URL || '').replace(/\/$/, '');
  const PUBLIC_KEY = CONFIG.SUPABASE_ANON_KEY || '';
  const SESSION_KEY = 'ksdl-po-tracker-session';
  const PAYMENT_BUCKET = 'transport-payments';
  const INR = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
  let session = null, refreshPromise = null, paymentRefreshTimer = null, transporters = [], payables = [], settlements = [], settledLinkIds = new Set(), selectedPayableIds = new Set(), cbsByPurchaseOrder = new Map(), locationDistances = new Map(), distanceMasterAvailable = true;

  const $ = id => document.getElementById(id);
  const money = value => INR.format(Number(value || 0));
  const safe = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  const iso = value => value ? new Date(`${value}T00:00:00`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
  const today = () => new Date().toISOString().slice(0, 10);
  const normalizeDeliveryLocation = value => {
    const location = String(value || '').replace(/\s+/g, ' ').trim();
    return /^modasa(?:\b|[,\-])/i.test(location) ? 'Modasa' : location;
  };
  const locationKey = value => normalizeDeliveryLocation(value).toLowerCase();
  const customerKey = value => String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const profileOf = transporter => Array.isArray(transporter?.transporter_payment_profiles) ? transporter.transporter_payment_profiles[0] : transporter?.transporter_payment_profiles;
  function show(id) { $(id).classList.remove('hidden'); } function hide(id) { $(id).classList.add('hidden'); }
  function headers(extra = {}) { return { apikey: PUBLIC_KEY, Authorization: `Bearer ${session?.access_token || PUBLIC_KEY}`, ...extra }; }
  function saveSession(nextSession) { session = nextSession; sessionStorage.setItem(SESSION_KEY, JSON.stringify(session)); }
  function tokenExpiresSoon() {
    if (!session?.access_token) return false;
    let expiresAt = Number(session.expires_at || 0);
    if (!expiresAt) {
      try { const payload = session.access_token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'); expiresAt = Number(JSON.parse(atob(payload.padEnd(Math.ceil(payload.length / 4) * 4, '='))).exp || 0); } catch (_) { return false; }
    }
    return expiresAt * 1000 <= Date.now() + 60000;
  }
  async function refreshSession() {
    if (refreshPromise) return refreshPromise;
    if (!session?.refresh_token) throw new Error('Your session has expired. Please sign in again.');
    refreshPromise = (async () => {
      const response = await fetch(`${BASE_URL}/auth/v1/token?grant_type=refresh_token`, {
        method: 'POST', headers: { apikey: PUBLIC_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ refresh_token: session.refresh_token })
      });
      const text = await response.text(); let data = null;
      if (text) { try { data = JSON.parse(text); } catch (_) { data = text; } }
      if (!response.ok || !data?.access_token) throw new Error(data?.message || data?.error_description || 'Your session has expired. Please sign in again.');
      saveSession({ ...session, ...data }); return session;
    })();
    try { return await refreshPromise; } finally { refreshPromise = null; }
  }
  async function api(path, options = {}, allowRefreshRetry = true) {
    const tokenRequest = path.startsWith('/auth/v1/token');
    if (!tokenRequest && session?.refresh_token && tokenExpiresSoon()) await refreshSession();
    const requestHeaders = tokenRequest ? { apikey: PUBLIC_KEY, Authorization: `Bearer ${PUBLIC_KEY}`, ...(options.headers || {}) } : headers(options.headers || {});
    const response = await fetch(`${BASE_URL}${path}`, { ...options, headers: requestHeaders }); const text = await response.text(); let data = null;
    if (text) { try { data = JSON.parse(text); } catch (_) { data = text; } }
    const message = data?.message || data?.error_description || text || `Request failed (${response.status})`;
    if (!response.ok && allowRefreshRetry && !tokenRequest && session?.refresh_token && (response.status === 401 || /exp(?:ired)?|jwt|timestamp check failed/i.test(String(message)))) {
      await refreshSession(); return api(path, options, false);
    }
    if (!response.ok) throw new Error(message); return data;
  }
  function toast(message) { const el = $('toast'); el.textContent = message; el.classList.add('show'); clearTimeout(toast.timer); toast.timer = setTimeout(() => el.classList.remove('show'), 3000); }
  async function signIn(email, password) { saveSession(await api('/auth/v1/token?grant_type=password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) })); }
  async function signOut() { try { await api('/auth/v1/logout', { method: 'POST' }); } catch (_) { /* local sign-out still succeeds */ } clearInterval(paymentRefreshTimer); paymentRefreshTimer = null; session = null; sessionStorage.removeItem(SESSION_KEY); hide('app'); show('loginScreen'); }
  async function ensureOwner() { const role = await api('/rest/v1/rpc/po_tracker_role', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); if (role !== 'owner') throw new Error('Only the owner can access transport payments.'); }

  async function uploadPrivateFile(folder, ownerId, file) {
    if (!file) throw new Error('Choose a file first.'); if (file.size > 10 * 1024 * 1024) throw new Error('File must be 10 MB or smaller.');
    const name = file.name.replace(/[^a-zA-Z0-9._-]/g, '_'), path = `${folder}/${ownerId}/${Date.now()}-${name}`;
    await api(`/storage/v1/object/${PAYMENT_BUCKET}/${path}`, { method: 'POST', headers: { 'Content-Type': file.type || 'application/octet-stream', 'x-upsert': 'true' }, body: file }); return path;
  }
  async function signedUrl(path) { if (!path) return ''; const data = await api(`/storage/v1/object/sign/${PAYMENT_BUCKET}/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expiresIn: 3600 }) }); return data?.signedURL ? `${BASE_URL}/storage/v1${data.signedURL}` : ''; }

  async function loadData() {
    $('connectionStatus').textContent = 'Loading payment register…';
    distanceMasterAvailable = true;
    const [master, delivered, items, register, cbsRows, distanceRows] = await Promise.all([
      api('/rest/v1/transporters?select=*,transporter_payment_profiles(*)&order=name.asc'),
      api('/rest/v1/delivery_trip_pos?select=id,trip_id,purchase_order_id,allocated_cost,delivered_at,delivery_status,purchase_orders(id,po_number,customer_name,delivery_location,delivery_date),delivery_trips!inner(id,trip_date,transporter_id,transporter,vehicle_number,status)&delivery_status=eq.Delivered&delivery_trips.status=eq.Delivered&order=delivered_at.desc'),
      api('/rest/v1/transport_payment_items?select=delivery_trip_po_id'),
      api('/rest/v1/transport_payment_settlements?select=*,transporters(id,name),transport_payment_items(id,amount,purchase_orders(po_number,delivery_location),delivery_trips(trip_date,vehicle_number))&order=created_at.desc'),
      api('/rest/v1/dmart_invoice_items?select=purchase_order_id,quantity_cbs').catch(() => []),
      api('/rest/v1/transport_location_distances?select=canonical_name,distance_km').catch(() => { distanceMasterAvailable = false; return []; })
    ]);
    transporters = Array.isArray(master) ? master : [];
    payables = (Array.isArray(delivered) ? delivered : []).map(item => ({
      ...item,
      purchase_orders: item.purchase_orders ? {
        ...item.purchase_orders,
        delivery_location: normalizeDeliveryLocation(item.purchase_orders.delivery_location)
      } : item.purchase_orders
    }));
    settlements = (Array.isArray(register) ? register : []).map(settlement => ({
      ...settlement,
      transport_payment_items: (settlement.transport_payment_items || []).map(item => ({
        ...item,
        purchase_orders: item.purchase_orders ? {
          ...item.purchase_orders,
          delivery_location: normalizeDeliveryLocation(item.purchase_orders.delivery_location)
        } : item.purchase_orders
      }))
    }));
    settledLinkIds = new Set((Array.isArray(items) ? items : []).map(item => item.delivery_trip_po_id)); selectedPayableIds = new Set([...selectedPayableIds].filter(id => !settledLinkIds.has(id)));
    cbsByPurchaseOrder = new Map();
    (Array.isArray(cbsRows) ? cbsRows : []).forEach(row => cbsByPurchaseOrder.set(row.purchase_order_id, Number(cbsByPurchaseOrder.get(row.purchase_order_id) || 0) + Number(row.quantity_cbs || 0)));
    locationDistances = new Map((Array.isArray(distanceRows) ? distanceRows : []).map(row => [locationKey(row.canonical_name), Number(row.distance_km || 0)]));
    await Promise.all(transporters.map(async transporter => { const profile = profileOf(transporter); if (profile?.qr_code_url) profile.qrLink = await signedUrl(profile.qr_code_url).catch(() => ''); }));
    await Promise.all(settlements.map(async settlement => { if (settlement.payment_proof_url) settlement.proofLink = await signedUrl(settlement.payment_proof_url).catch(() => ''); }));
    $('connectionStatus').textContent = `Cloud synced ${new Date().toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}`; render();
  }

  function transporterById(id) { return transporters.find(item => item.id === id); }
  function outstandingPayables() { return payables.filter(item => !settledLinkIds.has(item.id)); }
  function asRecord(value) { return Array.isArray(value) ? (value[0] || {}) : (value || {}); }
  function deliveredOn(item) { return String(item.delivered_at || '').slice(0, 10) || item.purchase_orders?.delivery_date || ''; }
  function deliveredAt(item) {
    const timestamp = Date.parse(String(item.delivered_at || ''));
    if (Number.isFinite(timestamp)) return timestamp;
    const date = deliveredOn(item);
    return date ? Date.parse(`${date}T12:00:00`) : 0;
  }
  function average(values) { return values.length ? values.reduce((total, value) => total + Number(value || 0), 0) / values.length : 0; }
  function cbsBand(value) { if (value <= 5) return '1–5 CBS'; if (value <= 15) return '6–15 CBS'; if (value <= 30) return '16–30 CBS'; return '31+ CBS'; }
  function distanceBand(value) { if (value <= 10) return '0–10 km'; if (value <= 25) return '11–25 km'; if (value <= 50) return '26–50 km'; return '51+ km'; }
  function costDeliveries() {
    return payables.map(item => {
      const trip = asRecord(item.delivery_trips), po = asRecord(item.purchase_orders), master = transporterById(trip.transporter_id);
      const location = normalizeDeliveryLocation(po.delivery_location) || 'Location pending';
      return {
        id: item.id, poId: po.id || item.purchase_order_id, deliveredOn: deliveredOn(item), deliveredAt: deliveredAt(item), customer: po.customer_name || 'Customer pending', location,
        transporterId: trip.transporter_id || '', transporter: master?.name || trip.transporter || 'Transporter pending', cost: Number(item.allocated_cost || 0),
        cbs: Number(cbsByPurchaseOrder.get(po.id || item.purchase_order_id) || 0), distance: Number(locationDistances.get(locationKey(location)) || 0)
      };
    }).filter(item => Number.isFinite(item.cost) && item.cost > 0 && item.deliveredOn);
  }
  function setSelectOptions(id, values, selected, allLabel) {
    const element = $(id); element.innerHTML = `<option value="">${allLabel}</option>` + values.map(value => `<option value="${safe(value)}">${safe(value)}</option>`).join(''); element.value = values.includes(selected) ? selected : '';
  }
  function renderCostAnalysis() {
    const all = costDeliveries();
    setSelectOptions('costCustomerFilter', [...new Set(all.map(item => item.customer))].sort((a, b) => a.localeCompare(b)), $('costCustomerFilter').value, 'All customers');
    setSelectOptions('costTransporterFilter', [...new Set(all.map(item => item.transporter))].sort((a, b) => a.localeCompare(b)), $('costTransporterFilter').value, 'All transporters');
    const customer = $('costCustomerFilter').value, transporter = $('costTransporterFilter').value, from = $('costFrom').value, to = $('costTo').value;
    const selected = all.filter(item => (!customer || item.customer === customer) && (!transporter || item.transporter === transporter) && (!from || item.deliveredOn >= from) && (!to || item.deliveredOn <= to));
    const comparableByCustomer = new Map(), comparableAllCustomers = new Map(), byTransporter = new Map();
    selected.forEach(item => {
      if (item.cbs > 0 && item.distance > 0) {
        const bands = `${cbsBand(item.cbs)}||${distanceBand(item.distance)}`, customerBand = `${customerKey(item.customer)}||${bands}`;
        if (!comparableByCustomer.has(customerBand)) comparableByCustomer.set(customerBand, []); comparableByCustomer.get(customerBand).push(item);
        if (!comparableAllCustomers.has(bands)) comparableAllCustomers.set(bands, []); comparableAllCustomers.get(bands).push(item);
      }
      const transporterKey = `${customerKey(item.customer)}||${locationKey(item.location)}||${item.transporter}`;
      if (!byTransporter.has(transporterKey)) byTransporter.set(transporterKey, []); byTransporter.get(transporterKey).push(item);
    });
    const rows = [...byTransporter.values()].map(items => {
      const latestItems = [...items].sort((left, right) => right.deliveredAt - left.deliveredAt || String(right.id).localeCompare(String(left.id)));
      const latest = latestItems[0], bands = latest.cbs > 0 && latest.distance > 0 ? `${cbsBand(latest.cbs)}||${distanceBand(latest.distance)}` : '';
      const customerPool = bands ? (comparableByCustomer.get(`${customerKey(latest.customer)}||${bands}`) || []).filter(item => item.id !== latest.id) : [];
      const allCustomerPool = bands ? (comparableAllCustomers.get(bands) || []).filter(item => item.id !== latest.id) : [];
      const pool = customerPool.length >= 3 ? customerPool : allCustomerPool;
      const benchmark = average(pool.map(item => item.cost)), difference = latest.cost - benchmark, differencePercent = benchmark ? difference / benchmark * 100 : 0;
      const review = latest.distance <= 0 ? 'Needs distance' : latest.cbs <= 0 ? 'Needs CBS' : pool.length < 3 ? 'Limited history' : differencePercent > 10 ? 'Over average' : differencePercent < -10 ? 'Below average' : 'Within average';
      return { ...latest, deliveries: items.length, benchmark, benchmarkCount: pool.length, benchmarkScope: customerPool.length >= 3 ? 'Same customer' : 'All customers', difference, differencePercent, review };
    }).sort((left, right) => {
      const priority = row => row.review === 'Over average' ? 0 : /Needs|Limited/.test(row.review) ? 2 : 1;
      return priority(left) - priority(right) || right.difference - left.difference || left.customer.localeCompare(right.customer) || left.location.localeCompare(right.location);
    });
    const alerts = rows.filter(row => row.review === 'Over average'), excess = alerts.reduce((total, row) => total + Math.max(0, row.difference), 0);
    const ready = selected.filter(item => item.cbs > 0 && item.distance > 0);
    $('costDeliveryCount').textContent = `${ready.length}/${selected.length}`; $('costAverageAmount').textContent = ready.length ? `${money(average(ready.map(item => item.cost / item.cbs)))}/CBS` : '—'; $('costAlertCount').textContent = alerts.length; $('costPotentialExcess').textContent = money(excess);
    $('costAnalysisBody').innerHTML = rows.map(row => {
      const differenceClass = row.review === 'Over average' ? 'above' : row.review === 'Below average' ? 'below' : 'within';
      const reviewClass = row.review === 'Over average' ? 'over' : row.review === 'Below average' ? 'below' : row.review === 'Within average' ? 'within' : 'limited';
      const differenceText = row.benchmarkCount >= 3 ? `${row.difference >= 0 ? '+' : '−'}${money(Math.abs(row.difference))} (${row.differencePercent >= 0 ? '+' : ''}${Math.round(row.differencePercent)}%)` : row.review === 'Needs distance' ? 'Add distance' : row.review === 'Needs CBS' ? 'CBS pending' : 'Need 3 matches';
      const load = row.cbs > 0 ? `${Math.round(row.cbs * 10) / 10} CBS<span class="muted-line">${cbsBand(row.cbs)}</span>` : '—';
      const distance = row.distance > 0 ? `${Math.round(row.distance * 10) / 10} km one-way<span class="muted-line">${Math.round(row.distance * 2 * 10) / 10} km round trip · ${distanceBand(row.distance)}</span>` : '—';
      const comparable = row.benchmarkCount ? `${money(row.benchmark)}<span class="muted-line">${row.benchmarkCount} ${safe(row.benchmarkScope)} match${row.benchmarkCount === 1 ? '' : 'es'}</span>` : '—';
      const efficiency = `<strong>${money(row.cost)}</strong><span class="muted-line">${row.cbs > 0 ? `${money(row.cost / row.cbs)} / CBS` : 'CBS pending'} · ${row.distance > 0 ? `${money(row.cost / (row.distance * 2))} / round-trip km` : 'distance pending'}</span>`;
      return `<tr><td><strong>${safe(row.customer)}</strong><span class="cost-location">${safe(row.location)}</span></td><td>${safe(row.transporter)}<span class="muted-line">${row.deliveries} delivery record${row.deliveries === 1 ? '' : 's'}</span></td><td>${load}</td><td>${distance}</td><td>${efficiency}</td><td>${comparable}</td><td><span class="cost-difference ${differenceClass}">${differenceText}</span></td><td><span class="cost-review ${reviewClass}">${safe(row.review)}</span></td></tr>`;
    }).join('');
    $('distanceMasterNote').textContent = distanceMasterAvailable ? 'Only confirmed Delivered trips are benchmarked. A completed email-GRN trip joins the benchmark after its customer GRN arrives. Enter the usual one-way km from Blue Mark Agency to the delivery location; cost per km uses the return journey too.' : 'Distance setup is not active yet. Run the supplied one-time SQL file, then reload this page.';
    $('costAnalysisEmpty').classList.toggle('hidden', rows.length > 0);
  }
  function distanceLocations() {
    return [...new Map(costDeliveries().map(item => [locationKey(item.location), item.location])).values()].sort((left, right) => left.localeCompare(right));
  }
  function renderDistanceMaster() {
    const locations = distanceLocations();
    $('distanceLocationBody').innerHTML = locations.map(location => `<tr><td><strong>${safe(location)}</strong></td><td><input class="distance-input" type="number" min="0.1" max="1000" step="0.1" inputmode="decimal" value="${locationDistances.get(locationKey(location)) || ''}" placeholder="e.g. 18" /></td><td><button class="text-btn save-distance" data-location="${safe(location)}" type="button">Save</button></td></tr>`).join('') || '<tr><td colspan="3">No completed delivery locations yet.</td></tr>';
  }
  function openDistanceDialog() {
    if (!distanceMasterAvailable) { toast('Run the one-time Transport Location Distances SQL first, then refresh this page.'); return; }
    $('distanceError').textContent = ''; renderDistanceMaster(); $('distanceDialog').showModal();
  }
  async function saveDistance(location, button) {
    const input = button.closest('tr')?.querySelector('.distance-input'), distance = Number(input?.value);
    if (!Number.isFinite(distance) || distance <= 0 || distance > 1000) { $('distanceError').textContent = 'Enter a valid one-way distance in kilometres.'; return; }
    try {
      button.disabled = true; button.textContent = 'Saving…'; $('distanceError').textContent = '';
      await api('/rest/v1/transport_location_distances?on_conflict=canonical_name', { method: 'POST', headers: { 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify({ canonical_name: location, distance_km: distance, updated_at: new Date().toISOString() }) });
      locationDistances.set(locationKey(location), distance); renderCostAnalysis(); button.textContent = 'Saved'; setTimeout(() => { button.textContent = 'Save'; button.disabled = false; }, 900);
    } catch (error) { button.disabled = false; button.textContent = 'Save'; $('distanceError').textContent = error.message || 'Could not save the distance.'; }
  }
  function filteredPayables() {
    const transporterId = $('payableTransporterFilter').value, from = $('payableFrom').value, to = $('payableTo').value;
    return outstandingPayables().filter(item => { const delivered = item.purchase_orders?.delivery_date || String(item.delivered_at || '').slice(0, 10); return (!transporterId || item.delivery_trips?.transporter_id === transporterId) && (!from || delivered >= from) && (!to || delivered <= to); });
  }
  function renderTransporterOptions() {
    const current = $('payableTransporterFilter').value; $('payableTransporterFilter').innerHTML = '<option value="">All transporters</option>' + transporters.map(item => `<option value="${item.id}">${safe(item.name)}</option>`).join(''); $('payableTransporterFilter').value = current;
  }
  function renderTransporters() {
    $('transporterBody').innerHTML = transporters.map(transporter => { const profile = profileOf(transporter); return `<tr><td><strong>${safe(transporter.name)}</strong><span class="muted-line">${profile?.verified_at ? 'Payment details verified' : 'Verification pending'}</span></td><td>${safe(transporter.phone || '—')}</td><td>${safe(profile?.payee_name || '—')}<span class="muted-line">${safe(profile?.upi_id || '')}</span>${profile?.qrLink ? `<a class="proof-link" href="${safe(profile.qrLink)}" target="_blank" rel="noopener">View private QR</a>` : ''}</td><td><span class="master-status ${transporter.active ? '' : 'inactive'}">${transporter.active ? 'Active' : 'Inactive'}</span></td><td><button class="text-btn edit-transporter" data-id="${transporter.id}" type="button">Edit</button></td></tr>`; }).join('');
    $('transporterEmpty').classList.toggle('hidden', transporters.length > 0); renderTransporterOptions();
  }
  function renderPayables() {
    const rows = filteredPayables(); $('payableBody').innerHTML = rows.map(item => { const trip = item.delivery_trips || {}, po = item.purchase_orders || {}, master = transporterById(trip.transporter_id); return `<tr class="${selectedPayableIds.has(item.id) ? 'selected-payable' : ''}"><td><input class="payable-choice" type="checkbox" value="${item.id}" ${selectedPayableIds.has(item.id) ? 'checked' : ''} /></td><td>${safe(master?.name || trip.transporter || 'Unassigned')}</td><td>${iso(po.delivery_date || String(item.delivered_at || '').slice(0, 10))}</td><td><strong>${safe(po.po_number || 'PO')}</strong><span class="muted-line">${safe(po.delivery_location || 'Location pending')}</span></td><td>${iso(trip.trip_date)}<span class="muted-line">${safe(trip.vehicle_number || 'Vehicle pending')}</span></td><td><div class="cost-editor"><input class="payable-cost-input" type="number" min="0" step="0.01" value="${Number(item.allocated_cost || 0)}" aria-label="Final transport cost for ${safe(po.po_number || 'PO')}" /><button class="text-btn save-payable-cost" data-id="${item.id}" type="button">Save</button></div></td><td><button class="text-btn return-delivery" data-id="${item.id}" type="button">Reject / Send back</button></td></tr>`; }).join(''); $('payableEmpty').classList.toggle('hidden', rows.length > 0);
    const visibleIds = rows.map(item => item.id), selectedVisible = visibleIds.filter(id => selectedPayableIds.has(id)); $('selectAllPayables').checked = visibleIds.length > 0 && selectedVisible.length === visibleIds.length; $('selectAllPayables').indeterminate = selectedVisible.length > 0 && selectedVisible.length < visibleIds.length; renderSelection();
  }
  function renderSelection() { const chosen = outstandingPayables().filter(item => selectedPayableIds.has(item.id)), total = chosen.reduce((sum, item) => sum + Number(item.allocated_cost || 0), 0); $('selectedDeliveryCount').textContent = chosen.length; $('selectedDeliveryTotal').textContent = money(total); $('createSettlementBtn').disabled = chosen.length === 0; }
  async function savePayableCost(linkId, button) {
    const item = outstandingPayables().find(record => record.id === linkId), row = button.closest('tr'), input = row?.querySelector('.payable-cost-input'), amount = Number(input?.value);
    if (!item || !Number.isFinite(amount) || amount < 0) { toast('Enter a valid transport cost.'); return; }
    try {
      button.disabled = true; button.textContent = 'Saving…';
      await api('/rest/v1/rpc/update_transport_delivery_cost', { method: 'POST', headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' }, body: JSON.stringify({ delivery_link: item.id, new_cost: amount }) });
      await loadData(); toast('Final PO transport cost saved.');
    } catch (err) { toast(err.message || 'Could not update the transport cost.'); }
    finally { button.disabled = false; button.textContent = 'Save'; }
  }
  function openRejectDelivery(linkId) {
    const item = outstandingPayables().find(record => record.id === linkId); if (!item) return;
    const po = item.purchase_orders || {}, trip = item.delivery_trips || {};
    $('rejectDeliveryForm').reset(); $('rejectDeliveryId').value = linkId; $('rejectDeliveryError').textContent = '';
    $('rejectDeliverySummary').textContent = `${po.po_number || 'PO'} · ${po.delivery_location || 'Location pending'} · ${trip.transporter || 'Transporter'}`;
    $('rejectDeliveryDialog').showModal(); $('rejectDeliveryReason').focus();
  }
  async function rejectDelivery(event) {
    event.preventDefault(); const error = $('rejectDeliveryError'), linkId = $('rejectDeliveryId').value, reason = $('rejectDeliveryReason').value.trim(); error.textContent = '';
    if (!reason) { error.textContent = 'Enter what the executive needs to correct.'; return; }
    const button = event.submitter;
    try {
      button.disabled = true; button.textContent = 'Sending back…';
      await api('/rest/v1/rpc/return_transport_delivery', { method: 'POST', headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' }, body: JSON.stringify({ delivery_link: linkId, reason }) });
      selectedPayableIds.delete(linkId); $('rejectDeliveryDialog').close(); await loadData(); toast('Delivery sent back to the executive for correction.');
    } catch (err) {
      const message = err.message || 'Could not send this delivery back.';
      error.textContent = /return_transport_delivery|schema cache|pgrst202/i.test(message)
        ? 'Supabase correction setup is not active yet. Run the updated transport-payments SQL, then refresh this page.'
        : message;
    }
    finally { button.disabled = false; button.textContent = 'Send back'; }
  }
  function statusClass(status) { return String(status || '').toLowerCase().replaceAll(' ', '-'); }
  function renderSettlements() {
    $('settlementBody').innerHTML = settlements.map(settlement => { const items = settlement.transport_payment_items || [], details = items.map(item => `${item.purchase_orders?.po_number || 'PO'} · ${money(item.amount)}`).join('<br>'); let actions = '';
      if (settlement.status === 'Draft') actions = `<button class="primary approve-settlement" data-id="${settlement.id}" type="button">Approve</button>`;
      else if (settlement.status === 'Approved') actions = `<button class="primary pay-settlement" data-id="${settlement.id}" type="button">Record GPay payment</button>`;
      else if (settlement.status === 'Paid') actions = `<button class="primary reconcile-settlement" data-id="${settlement.id}" type="button">Reconcile</button>`;
      return `<tr><td><span class="settlement-number">${safe(settlement.settlement_number)}</span><span class="muted-line">Created ${iso(String(settlement.created_at || '').slice(0, 10))}</span></td><td>${safe(settlement.transporters?.name || 'Transporter')}<span class="muted-line">${iso(settlement.period_start)} – ${iso(settlement.period_end)}</span></td><td>${details || '—'}</td><td><strong>${money(settlement.total_amount)}</strong></td><td><span class="payment-status ${statusClass(settlement.status)}">${safe(settlement.status)}</span>${settlement.upi_transaction_id ? `<span class="muted-line">UTR ${safe(settlement.upi_transaction_id)}</span>` : ''}</td><td>${settlement.proofLink ? `<a class="proof-link" href="${safe(settlement.proofLink)}" target="_blank" rel="noopener">View payment proof</a>` : '—'}</td><td><div class="row-actions">${actions || '—'}</div></td></tr>`;
    }).join(''); $('settlementEmpty').classList.toggle('hidden', settlements.length > 0);
  }
  function renderSummary() {
    const outstanding = outstandingPayables(), byStatus = status => settlements.filter(item => item.status === status), sum = list => list.reduce((total, item) => total + Number(item.total_amount || item.allocated_cost || 0), 0), month = today().slice(0, 7);
    $('outstandingAmount').textContent = money(sum(outstanding)); $('outstandingCount').textContent = `${outstanding.length} deliveries`;
    const drafts = byStatus('Draft'), approved = byStatus('Approved'), paid = byStatus('Paid'), monthPaid = settlements.filter(item => ['Paid', 'Reconciled'].includes(item.status) && String(item.payment_date || '').startsWith(month));
    $('draftAmount').textContent = money(sum(drafts)); $('draftCount').textContent = `${drafts.length} settlements`; $('approvedAmount').textContent = money(sum(approved)); $('approvedCount').textContent = `${approved.length} approved`; $('paidAmount').textContent = money(sum(paid)); $('paidCount').textContent = `${paid.length} payments`; $('monthPaidAmount').textContent = money(sum(monthPaid));
  }
  function render() { renderTransporters(); renderCostAnalysis(); renderPayables(); renderSettlements(); renderSummary(); }

  function openTransporterDialog(id = '') {
    $('transporterForm').reset(); $('transporterId').value = id; $('transporterError').textContent = ''; const transporter = transporterById(id), profile = profileOf(transporter); $('transporterDialogTitle').textContent = transporter ? 'Edit transporter' : 'Add transporter';
    if (transporter) { $('transporterName').value = transporter.name || ''; $('transporterPhone').value = transporter.phone || ''; $('transporterActive').checked = Boolean(transporter.active); $('transporterUpi').value = profile?.upi_id || ''; $('transporterPayee').value = profile?.payee_name || ''; $('transporterVerified').checked = Boolean(profile?.verified_at); $('existingQrNote').textContent = profile?.qr_code_url ? 'Existing QR is saved. Upload only to replace it.' : ''; }
    else { $('transporterActive').checked = true; $('existingQrNote').textContent = ''; }
    $('transporterDialog').showModal();
  }
  async function saveTransporter(event) {
    event.preventDefault(); const error = $('transporterError'); error.textContent = ''; const id = $('transporterId').value || crypto.randomUUID(), existing = transporterById(id), existingProfile = profileOf(existing), qrFile = $('transporterQr').files?.[0];
    try { let qrPath = existingProfile?.qr_code_url || ''; if (qrFile) qrPath = await uploadPrivateFile('transporter-qr', id, qrFile); if (!qrPath) throw new Error('Upload and verify the transporter QR code.');
      const masterPayload = { id, name: $('transporterName').value.trim(), phone: $('transporterPhone').value.trim() || null, active: $('transporterActive').checked };
      if (existing) await api(`/rest/v1/transporters?id=eq.${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' }, body: JSON.stringify(masterPayload) }); else await api('/rest/v1/transporters', { method: 'POST', headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' }, body: JSON.stringify(masterPayload) });
      const verified = $('transporterVerified').checked, profilePayload = { transporter_id: id, upi_id: $('transporterUpi').value.trim(), payee_name: $('transporterPayee').value.trim(), qr_code_url: qrPath, verified_at: verified ? new Date().toISOString() : null, verified_by: verified ? session.user.id : null, updated_at: new Date().toISOString() };
      await api('/rest/v1/transporter_payment_profiles?on_conflict=transporter_id', { method: 'POST', headers: { 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(profilePayload) });
      await api(`/rest/v1/delivery_trips?transporter_id=is.null&transporter=eq.${encodeURIComponent(masterPayload.name)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' }, body: JSON.stringify({ transporter_id: id }) });
      $('transporterDialog').close(); await loadData(); toast('Transporter Master updated.');
    } catch (err) { error.textContent = err.message || 'Could not save transporter.'; }
  }

  async function createSettlement() {
    const chosen = outstandingPayables().filter(item => selectedPayableIds.has(item.id)); if (!chosen.length) return; const transporterIds = [...new Set(chosen.map(item => item.delivery_trips?.transporter_id).filter(Boolean))]; if (transporterIds.length !== 1) { toast('Select deliveries for only one transporter.'); return; }
    const dates = chosen.map(item => item.purchase_orders?.delivery_date || String(item.delivered_at || '').slice(0, 10)).filter(Boolean).sort(), from = $('payableFrom').value || dates[0], to = $('payableTo').value || dates[dates.length - 1];
    try { await api('/rest/v1/rpc/create_transport_settlement', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ transporter: transporterIds[0], delivery_links: chosen.map(item => item.id), period_start: from, period_end: to }) }); selectedPayableIds.clear(); await loadData(); toast('Payment record created as Draft.'); } catch (err) { toast(err.message || 'Could not create payment record.'); }
  }
  async function approveSettlement(id) { try { await api(`/rest/v1/transport_payment_settlements?id=eq.${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' }, body: JSON.stringify({ status: 'Approved', approved_by: session.user.id, approved_at: new Date().toISOString() }) }); await loadData(); toast('Settlement approved for payment.'); } catch (err) { toast(err.message || 'Could not approve settlement.'); } }
  function openPaymentDialog(id) {
    const settlement = settlements.find(item => item.id === id), transporter = transporterById(settlement?.transporter_id), profile = profileOf(transporter); if (!settlement || !profile?.verified_at) { toast('Verify the transporter UPI ID and QR before payment.'); return; }
    $('paymentForm').reset(); $('paymentSettlementId').value = id; $('paymentDate').value = today(); $('paymentError').textContent = ''; $('paymentDialogSummary').textContent = `${settlement.settlement_number} · ${money(settlement.total_amount)}`;
    const qr = profile.qrLink ? (String(profile.qr_code_url).toLowerCase().endsWith('.pdf') ? `<div class="qr-preview"><a class="qr-open-button" href="${safe(profile.qrLink)}" target="_blank" rel="noopener">Open verified QR PDF</a></div>` : `<div class="qr-preview"><a href="${safe(profile.qrLink)}" target="_blank" rel="noopener" title="Open QR full size"><img src="${safe(profile.qrLink)}" alt="Verified transporter payment QR" /></a><span>Click the QR to open it full-size</span></div>`) : '';
    $('paymentPayeeCard').innerHTML = `${qr}<div><p>Payee name</p><strong>${safe(profile.payee_name)}</strong><p>Verified UPI ID</p><strong>${safe(profile.upi_id)}</strong><p>Amount to pay</p><strong>${money(settlement.total_amount)}</strong><p>Confirm this name again in GPay before paying.</p></div>`; $('paymentDialog').showModal();
  }
  async function savePayment(event) {
    event.preventDefault(); const id = $('paymentSettlementId').value, proof = $('paymentProof').files?.[0], error = $('paymentError'); error.textContent = '';
    try { const proofPath = proof ? await uploadPrivateFile('payment-proofs', id, proof) : null; await api(`/rest/v1/transport_payment_settlements?id=eq.${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' }, body: JSON.stringify({ status: 'Paid', payment_date: $('paymentDate').value, upi_transaction_id: $('paymentUtr').value.trim() || null, payment_proof_url: proofPath, payment_remarks: $('paymentRemarks').value.trim() || null, paid_by: session.user.id, paid_at: new Date().toISOString() }) }); $('paymentDialog').close(); await loadData(); toast('Payment recorded — awaiting bank reconciliation.'); } catch (err) { error.textContent = err.message || 'Could not record payment.'; }
  }
  async function reconcileSettlement(id) { if (!confirm('Confirm that the payment amount and date match the bank statement?')) return; try { await api(`/rest/v1/transport_payment_settlements?id=eq.${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' }, body: JSON.stringify({ status: 'Reconciled', reconciled_by: session.user.id, reconciled_at: new Date().toISOString() }) }); await loadData(); toast('Payment reconciled with bank statement.'); } catch (err) { toast(err.message || 'Could not reconcile payment.'); } }

  function bindEvents() {
    $('loginForm').addEventListener('submit', async event => { event.preventDefault(); $('loginError').textContent = ''; try { await signIn($('emailInput').value.trim(), $('passwordInput').value); await start(); } catch (err) { $('loginError').textContent = err.message || 'Sign in failed.'; } }); $('signOutBtn').addEventListener('click', signOut); $('refreshBtn').addEventListener('click', loadData);
    $('addTransporterBtn').addEventListener('click', () => openTransporterDialog()); $('transporterBody').addEventListener('click', event => { const button = event.target.closest('.edit-transporter'); if (button) openTransporterDialog(button.dataset.id); }); $('transporterForm').addEventListener('submit', saveTransporter); $('closeTransporterDialog').addEventListener('click', () => $('transporterDialog').close()); $('cancelTransporterBtn').addEventListener('click', () => $('transporterDialog').close());
    ['payableTransporterFilter', 'payableFrom', 'payableTo'].forEach(id => { $(id).addEventListener('change', renderPayables); $(id).addEventListener('input', renderPayables); }); $('clearPayableFilters').addEventListener('click', () => { $('payableTransporterFilter').value = ''; $('payableFrom').value = ''; $('payableTo').value = ''; renderPayables(); });
    ['costCustomerFilter', 'costTransporterFilter', 'costFrom', 'costTo'].forEach(id => { $(id).addEventListener('change', renderCostAnalysis); $(id).addEventListener('input', renderCostAnalysis); }); $('clearCostFilters').addEventListener('click', () => { $('costCustomerFilter').value = ''; $('costTransporterFilter').value = ''; $('costFrom').value = ''; $('costTo').value = ''; renderCostAnalysis(); });
    $('manageDistanceBtn').addEventListener('click', openDistanceDialog); $('distanceLocationBody').addEventListener('click', event => { const button = event.target.closest('.save-distance'); if (button) saveDistance(button.dataset.location, button); }); $('closeDistanceDialog').addEventListener('click', () => $('distanceDialog').close()); $('closeDistanceBtn').addEventListener('click', () => $('distanceDialog').close());
    $('payableBody').addEventListener('change', event => { if (!event.target.matches('.payable-choice')) return; if (event.target.checked) selectedPayableIds.add(event.target.value); else selectedPayableIds.delete(event.target.value); renderPayables(); }); $('payableBody').addEventListener('click', event => { const saveButton = event.target.closest('.save-payable-cost'), returnButton = event.target.closest('.return-delivery'); if (saveButton) savePayableCost(saveButton.dataset.id, saveButton); else if (returnButton) openRejectDelivery(returnButton.dataset.id); }); $('selectAllPayables').addEventListener('change', event => { filteredPayables().forEach(item => event.target.checked ? selectedPayableIds.add(item.id) : selectedPayableIds.delete(item.id)); renderPayables(); }); $('createSettlementBtn').addEventListener('click', createSettlement);
    $('settlementBody').addEventListener('click', event => { const approve = event.target.closest('.approve-settlement'), pay = event.target.closest('.pay-settlement'), reconcile = event.target.closest('.reconcile-settlement'); if (approve) approveSettlement(approve.dataset.id); else if (pay) openPaymentDialog(pay.dataset.id); else if (reconcile) reconcileSettlement(reconcile.dataset.id); }); $('paymentForm').addEventListener('submit', savePayment); $('closePaymentDialog').addEventListener('click', () => $('paymentDialog').close()); $('cancelPaymentBtn').addEventListener('click', () => $('paymentDialog').close());
    $('rejectDeliveryForm').addEventListener('submit', rejectDelivery); $('closeRejectDeliveryDialog').addEventListener('click', () => $('rejectDeliveryDialog').close()); $('cancelRejectDeliveryBtn').addEventListener('click', () => $('rejectDeliveryDialog').close());
  }
  function startAutoRefresh() {
    clearInterval(paymentRefreshTimer);
    paymentRefreshTimer = setInterval(() => {
      if (!document.hidden && session?.access_token) loadData().catch(() => {});
    }, 60000);
  }
  async function start() { await ensureOwner(); $('signedInAs').textContent = session.user?.email || ''; hide('loginScreen'); show('app'); await loadData(); startAutoRefresh(); }

  bindEvents(); document.addEventListener('visibilitychange', () => { if (!document.hidden && session?.access_token) loadData().catch(() => {}); }); try { session = JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null'); } catch (_) { session = null; }
  if (session?.access_token && session?.refresh_token) start().catch(err => { hide('app'); show('loginScreen'); $('loginError').textContent = err.message; }); else { sessionStorage.removeItem(SESSION_KEY); show('loginScreen'); }
})();
