(() => {
  'use strict';

  const CONFIG = window.PO_TRACKER_CONFIG || {};
  const BASE_URL = String(CONFIG.SUPABASE_URL || '').replace(/\/$/, '');
  const PUBLIC_KEY = CONFIG.SUPABASE_ANON_KEY || '';
  const SESSION_KEY = 'ksdl-po-tracker-session';
  const PAYMENT_BUCKET = 'transport-payments';
  const INR = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
  let session = null, refreshPromise = null, transporters = [], payables = [], settlements = [], settledLinkIds = new Set(), selectedPayableIds = new Set();

  const $ = id => document.getElementById(id);
  const money = value => INR.format(Number(value || 0));
  const safe = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  const iso = value => value ? new Date(`${value}T00:00:00`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
  const today = () => new Date().toISOString().slice(0, 10);
  const normalizeDeliveryLocation = value => {
    const location = String(value || '').replace(/\s+/g, ' ').trim();
    return /^modasa(?:\b|[,\-])/i.test(location) ? 'Modasa' : location;
  };
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
  async function signOut() { try { await api('/auth/v1/logout', { method: 'POST' }); } catch (_) { /* local sign-out still succeeds */ } session = null; sessionStorage.removeItem(SESSION_KEY); hide('app'); show('loginScreen'); }
  async function ensureOwner() { const role = await api('/rest/v1/rpc/po_tracker_role', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); if (role !== 'owner') throw new Error('Only the owner can access transport payments.'); }

  async function uploadPrivateFile(folder, ownerId, file) {
    if (!file) throw new Error('Choose a file first.'); if (file.size > 10 * 1024 * 1024) throw new Error('File must be 10 MB or smaller.');
    const name = file.name.replace(/[^a-zA-Z0-9._-]/g, '_'), path = `${folder}/${ownerId}/${Date.now()}-${name}`;
    await api(`/storage/v1/object/${PAYMENT_BUCKET}/${path}`, { method: 'POST', headers: { 'Content-Type': file.type || 'application/octet-stream', 'x-upsert': 'true' }, body: file }); return path;
  }
  async function signedUrl(path) { if (!path) return ''; const data = await api(`/storage/v1/object/sign/${PAYMENT_BUCKET}/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expiresIn: 3600 }) }); return data?.signedURL ? `${BASE_URL}/storage/v1${data.signedURL}` : ''; }

  async function loadData() {
    $('connectionStatus').textContent = 'Loading payment register…';
    const [master, delivered, items, register] = await Promise.all([
      api('/rest/v1/transporters?select=*,transporter_payment_profiles(*)&order=name.asc'),
      api('/rest/v1/delivery_trip_pos?select=id,trip_id,purchase_order_id,allocated_cost,delivered_at,delivery_status,purchase_orders(id,po_number,customer_name,delivery_location,delivery_date),delivery_trips!inner(id,trip_date,transporter_id,transporter,vehicle_number,status)&delivery_status=eq.Delivered&delivery_trips.status=eq.Delivered&order=delivered_at.desc'),
      api('/rest/v1/transport_payment_items?select=delivery_trip_po_id'),
      api('/rest/v1/transport_payment_settlements?select=*,transporters(id,name),transport_payment_items(id,amount,purchase_orders(po_number,delivery_location),delivery_trips(trip_date,vehicle_number))&order=created_at.desc')
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
    await Promise.all(transporters.map(async transporter => { const profile = profileOf(transporter); if (profile?.qr_code_url) profile.qrLink = await signedUrl(profile.qr_code_url).catch(() => ''); }));
    await Promise.all(settlements.map(async settlement => { if (settlement.payment_proof_url) settlement.proofLink = await signedUrl(settlement.payment_proof_url).catch(() => ''); }));
    $('connectionStatus').textContent = 'Cloud synced'; render();
  }

  function transporterById(id) { return transporters.find(item => item.id === id); }
  function outstandingPayables() { return payables.filter(item => !settledLinkIds.has(item.id)); }
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
  function render() { renderTransporters(); renderPayables(); renderSettlements(); renderSummary(); }

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
    $('payableBody').addEventListener('change', event => { if (!event.target.matches('.payable-choice')) return; if (event.target.checked) selectedPayableIds.add(event.target.value); else selectedPayableIds.delete(event.target.value); renderPayables(); }); $('payableBody').addEventListener('click', event => { const saveButton = event.target.closest('.save-payable-cost'), returnButton = event.target.closest('.return-delivery'); if (saveButton) savePayableCost(saveButton.dataset.id, saveButton); else if (returnButton) openRejectDelivery(returnButton.dataset.id); }); $('selectAllPayables').addEventListener('change', event => { filteredPayables().forEach(item => event.target.checked ? selectedPayableIds.add(item.id) : selectedPayableIds.delete(item.id)); renderPayables(); }); $('createSettlementBtn').addEventListener('click', createSettlement);
    $('settlementBody').addEventListener('click', event => { const approve = event.target.closest('.approve-settlement'), pay = event.target.closest('.pay-settlement'), reconcile = event.target.closest('.reconcile-settlement'); if (approve) approveSettlement(approve.dataset.id); else if (pay) openPaymentDialog(pay.dataset.id); else if (reconcile) reconcileSettlement(reconcile.dataset.id); }); $('paymentForm').addEventListener('submit', savePayment); $('closePaymentDialog').addEventListener('click', () => $('paymentDialog').close()); $('cancelPaymentBtn').addEventListener('click', () => $('paymentDialog').close());
    $('rejectDeliveryForm').addEventListener('submit', rejectDelivery); $('closeRejectDeliveryDialog').addEventListener('click', () => $('rejectDeliveryDialog').close()); $('cancelRejectDeliveryBtn').addEventListener('click', () => $('rejectDeliveryDialog').close());
  }
  async function start() { await ensureOwner(); $('signedInAs').textContent = session.user?.email || ''; hide('loginScreen'); show('app'); await loadData(); }

  bindEvents(); try { session = JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null'); } catch (_) { session = null; }
  if (session?.access_token && session?.refresh_token) start().catch(err => { hide('app'); show('loginScreen'); $('loginError').textContent = err.message; }); else { sessionStorage.removeItem(SESSION_KEY); show('loginScreen'); }
})();
