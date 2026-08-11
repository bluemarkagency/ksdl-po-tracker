const CONFIG = window.PO_TRACKER_CONFIG || {};
const BASE_URL = String(CONFIG.SUPABASE_URL || '').replace(/\/$/, '');
const PUBLIC_KEY = CONFIG.SUPABASE_ANON_KEY || '';
const SESSION_KEY = 'ksdl-po-tracker-session';
const NOTE_BUCKET = 'delivery-notes';
const ACTIVE_TRIP_STATUSES = new Set(['Dispatched', 'Awaiting GRN']);
const BLOCKED_PO_STATUSES = new Set(['In Transit', 'Delivered', 'Cancelled']);
let session = null;
let orders = [];
let trips = [];
let transporters = [];
let refreshTimer = null;
const state = { customer: 'All', schedule: 'Today', selected: new Set(), editTripId: null, completeTripId: null };

const $ = id => document.getElementById(id);
const safe = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const money = value => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(Number(value || 0));
const localIso = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const todayIso = () => localIso(new Date());
const dateText = value => value ? new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(`${value}T00:00:00`)) : '—';
const shortDate = value => value ? new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short' }).format(new Date(`${value}T00:00:00`)) : '—';
const statusClass = value => String(value || '').toLowerCase().replace(/\s+/g, '-');
const addDays = (value, days) => { const date = new Date(`${value}T00:00:00`); date.setDate(date.getDate() + days); return localIso(date); };
const canonicalCustomer = value => {
  const name = String(value || '').trim();
  if (/blinkit|hands\s*on/i.test(name)) return 'Blinkit';
  if (/zepto|kiranakart/i.test(name)) return 'Zepto';
  if (/big\s*basket|innovative\s+retail/i.test(name)) return 'BigBasket';
  if (/^dmart$/i.test(name)) return 'DMart';
  return name || 'Unknown';
};
const usesEmailGrn = customer => ['Blinkit', 'Zepto', 'BigBasket'].includes(canonicalCustomer(customer));

function validateConfig() {
  if (!BASE_URL || !PUBLIC_KEY) throw new Error('Supabase configuration is missing.');
  if (/^(sb_secret_|eyJ.*service_role)/i.test(PUBLIC_KEY)) throw new Error('A private Supabase key cannot be used in this page.');
}
function storeSession(value) { session = value; sessionStorage.setItem(SESSION_KEY, JSON.stringify(value)); }
function nearExpiry(value) { return !value?.access_token || (value.expires_at && value.expires_at * 1000 <= Date.now() + 60000); }
async function authRequest(path, body) {
  const response = await fetch(`${BASE_URL}${path}`, { method: 'POST', headers: { apikey: PUBLIC_KEY, Authorization: `Bearer ${PUBLIC_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error_description || data.msg || data.message || 'Authentication failed.');
  return data;
}
async function refreshSession(value = session) {
  if (!value?.refresh_token) throw new Error('Please sign in again.');
  const refreshed = await authRequest('/auth/v1/token?grant_type=refresh_token', { refresh_token: value.refresh_token });
  storeSession(refreshed); return refreshed;
}
async function restoreSession() {
  const saved = JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null');
  if (!saved?.access_token) return null;
  session = saved;
  if (nearExpiry(saved)) return refreshSession(saved).catch(() => null);
  return saved;
}
async function api(path, options = {}, retry = true) {
  if (nearExpiry(session)) await refreshSession();
  const headers = { apikey: PUBLIC_KEY, Authorization: `Bearer ${session.access_token}`, Accept: 'application/json', ...(options.headers || {}) };
  const response = await fetch(`${BASE_URL}${path}`, { ...options, headers });
  if (response.status === 401 && retry) { await refreshSession(); return api(path, options, false); }
  const text = await response.text();
  if (!response.ok) {
    let detail = text;
    try { const parsed = JSON.parse(text); detail = parsed.message || parsed.details || text; } catch (_) {}
    throw new Error(detail || 'Request failed.');
  }
  return text ? JSON.parse(text) : null;
}

function storagePath(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  const marker = `/storage/v1/object/public/${NOTE_BUCKET}/`;
  return text.includes(marker) ? decodeURIComponent(text.split(marker)[1].split('?')[0]) : text;
}
async function signedFileUrl(value) {
  const original = String(value || '').trim();
  if (!original) return '';
  if (/^https:\/\//i.test(original) && !original.includes('/storage/v1/object/')) return original;
  const data = await api(`/storage/v1/object/sign/${NOTE_BUCKET}/${storagePath(original)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expiresIn: 3600 }) });
  return data?.signedURL ? `${BASE_URL}/storage/v1${data.signedURL}` : '';
}
async function openDocument(path) {
  try { const url = await signedFileUrl(path); if (!url) throw new Error('Document is not available.'); window.open(url, '_blank', 'noopener'); }
  catch (error) { toast(error.message); }
}
async function uploadFile(folder, tripId, poId, file) {
  if (!file) return '';
  if (file.size > 10 * 1024 * 1024) throw new Error('Each attachment must be 10 MB or smaller.');
  const fileName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const path = `${folder}/${tripId}/${poId}/${Date.now()}-${fileName}`;
  await api(`/storage/v1/object/${NOTE_BUCKET}/${path}`, { method: 'POST', headers: { 'Content-Type': file.type || 'application/octet-stream', 'x-upsert': 'true' }, body: file });
  return path;
}

function mapOrder(row) {
  return {
    id: row.id, customer: canonicalCustomer(row.customer_name), customerRaw: row.customer_name || '', po: row.po_number,
    poDate: row.po_date, receivedDate: row.po_received_date, appointmentDate: row.delivery_date, status: row.status,
    value: Number(row.po_value || 0), location: row.delivery_location || 'Location pending', invoice: row.invoice_number || '',
    invoiceDate: row.invoice_date || '', invoiceAmount: Number(row.invoice_amount || 0), invoicePath: row.invoice_attachment_url || '',
    poPath: row.po_attachment_url || '', assignedTo: row.assigned_to || '', remarks: row.remarks || ''
  };
}
function mapTrip(row) {
  return {
    id: row.id, tripDate: row.trip_date, status: row.status, transporter: row.transporter || 'Transporter pending', transporterId: row.transporter_id || '',
    vehicle: row.vehicle_number || 'Vehicle pending', driver: row.driver_name || '', driverPhone: row.driver_phone || '',
    quotedCost: Number(row.quoted_cost || 0), actualFreight: Number(row.actual_freight || 0), remarks: row.remarks || '', createdAt: row.created_at,
    pos: (row.delivery_trip_pos || []).map(link => {
      const nested = Array.isArray(link.purchase_orders) ? link.purchase_orders[0] : link.purchase_orders;
      const po = nested || orders.find(order => order.id === link.purchase_order_id) || {};
      return {
        id: link.id, purchaseOrderId: link.purchase_order_id, po: po.po_number || po.po || 'PO', customer: canonicalCustomer(po.customer_name || po.customer),
        location: po.delivery_location || po.location || 'Location pending', appointmentDate: po.delivery_date || po.appointmentDate || null,
        value: Number(po.po_value || po.value || 0), poPath: po.po_attachment_url || po.poPath || '',
        invoice: link.invoice_number || po.invoice_number || po.invoice || '', invoiceDate: link.invoice_date || po.invoice_date || po.invoiceDate || '',
        invoiceAmount: Number(link.invoice_amount || po.invoice_amount || po.invoiceAmount || 0), invoicePath: link.invoice_attachment_url || po.invoice_attachment_url || po.invoicePath || '',
        deliveryNotePath: link.delivery_note_url || '', allocatedCost: Number(link.allocated_cost || 0), deliveryStatus: link.delivery_status || 'Pending',
        correctionReason: link.correction_reason || '', deliveredAt: link.delivered_at || null
      };
    })
  };
}
async function loadData() {
  setConnection('Refreshing…');
  try {
    const poSelect = 'id,customer_name,po_number,po_date,po_received_date,delivery_date,status,po_value,delivery_location,invoice_number,invoice_date,invoice_amount,invoice_attachment_url,po_attachment_url,assigned_to,remarks';
    const tripSelect = 'id,trip_date,status,transporter_id,transporter,vehicle_number,driver_name,driver_phone,quoted_cost,actual_freight,remarks,created_at,delivery_trip_pos(id,trip_id,purchase_order_id,allocated_cost,invoice_number,invoice_date,invoice_amount,invoice_attachment_url,delivery_note_url,delivery_status,correction_reason,delivered_at,purchase_orders(id,po_number,customer_name,delivery_location,delivery_date,status,po_value,po_attachment_url,invoice_number,invoice_date,invoice_amount,invoice_attachment_url))';
    const [poRows, tripRows, transporterRows] = await Promise.all([
      api(`/rest/v1/purchase_orders?is_archived=eq.false&select=${poSelect}&order=po_received_date.desc`),
      api(`/rest/v1/delivery_trips?select=${tripSelect}&order=trip_date.desc,created_at.desc`),
      api('/rest/v1/transporters?active=eq.true&select=id,name,phone&order=name.asc')
    ]);
    orders = (poRows || []).map(mapOrder);
    trips = (tripRows || []).map(mapTrip);
    transporters = transporterRows || [];
    $('lastRefreshTime').textContent = new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
    setConnection(`${orders.length} POs · ${trips.filter(trip => ACTIVE_TRIP_STATUSES.has(trip.status)).length} active trips`);
    renderAll();
  } catch (error) { setConnection('Data unavailable', true); toast(error.message); }
}
function setConnection(message, error = false) { $('connectionStatus').textContent = message; $('connectionStatus').classList.toggle('error', error); }
function linkedPoIds() { return new Set(trips.flatMap(trip => trip.pos.map(link => link.purchaseOrderId))); }
function customerMatches(value) { return state.customer === 'All' || value === state.customer; }
function availableOrders() { const linked = linkedPoIds(); return orders.filter(order => customerMatches(order.customer) && !BLOCKED_PO_STATUSES.has(order.status) && !linked.has(order.id)); }
function customerLogo(customer) { return `<span class="customer-logo ${customer === 'Blinkit' ? 'blinkit-logo' : customer === 'Zepto' ? 'zepto-logo' : customer === 'BigBasket' ? 'bigbasket-logo' : customer === 'DMart' ? 'dmart-logo' : 'all-logo'}">${safe(customer[0] || '?')}</span>`; }
function renderCustomerSwitcher() {
  const extra = [...new Set(orders.map(order => order.customer).filter(name => !['DMart', 'Blinkit', 'Zepto', 'BigBasket'].includes(name)))];
  const names = ['All', 'DMart', 'Blinkit', 'Zepto', 'BigBasket', ...extra];
  $('customerSwitcher').innerHTML = names.map(name => { const count = name === 'All' ? orders.length : orders.filter(order => order.customer === name).length; return `<button class="customer-chip ${state.customer === name ? 'active' : ''} ${count === 0 ? 'live-customer-empty' : ''}" type="button" data-customer="${safe(name)}">${name === 'All' ? '<span class="customer-logo all-logo">A</span>' : customerLogo(name)}<span>${name === 'All' ? 'All customers' : safe(name)}</span><strong>${count}</strong></button>`; }).join('');
  document.querySelectorAll('[data-customer]').forEach(button => button.addEventListener('click', () => { state.customer = button.dataset.customer; state.selected.clear(); renderAll(); }));
}
function appointmentMarkup(order) {
  if (!order.appointmentDate) return '<div class="appointment-block awaiting"><strong>Awaiting appointment</strong><span>Follow up required</span></div>';
  const source = order.customer === 'Blinkit' ? 'Partners Biz confirmation' : order.customer === 'Zepto' ? 'Zepto schedule confirmation' : order.customer === 'BigBasket' ? 'BigBasket confirmation' : 'Confirmed appointment';
  return `<div class="appointment-block"><strong>${dateText(order.appointmentDate)}</strong><span>${source}</span></div>`;
}
function scheduleMatches(order, period) {
  if (period === 'All') return true;
  if (period === 'Awaiting') return !order.appointmentDate;
  if (!order.appointmentDate) return false;
  const today = todayIso();
  if (period === 'Today') return order.appointmentDate === today;
  if (period === 'Tomorrow') return order.appointmentDate === addDays(today, 1);
  if (period === 'Next7') return order.appointmentDate > addDays(today, 1) && order.appointmentDate <= addDays(today, 7);
  return false;
}
function renderSchedule() {
  const available = availableOrders();
  ({ Today: 'todayCount', Tomorrow: 'tomorrowCount', Next7: 'next7Count', Awaiting: 'awaitingCount' });
  Object.entries({ Today: 'todayCount', Tomorrow: 'tomorrowCount', Next7: 'next7Count', Awaiting: 'awaitingCount' }).forEach(([period, id]) => { $(id).textContent = available.filter(order => scheduleMatches(order, period)).length; });
  $('todayDate').textContent = shortDate(todayIso()); $('tomorrowDate').textContent = shortDate(addDays(todayIso(), 1));
  document.querySelectorAll('[data-schedule]').forEach(button => button.classList.toggle('active', button.dataset.schedule === state.schedule));
  const agenda = available.filter(order => scheduleMatches(order, state.schedule)).sort((a, b) => (a.appointmentDate || '9999').localeCompare(b.appointmentDate || '9999'));
  $('agendaTitle').textContent = ({ Today: 'Today’s delivery plan', Tomorrow: 'Tomorrow’s delivery plan', Next7: 'Next 7 days', Awaiting: 'POs awaiting appointment', All: 'All available purchase orders' })[state.schedule];
  $('agendaCount').textContent = `${agenda.length} PO${agenda.length === 1 ? '' : 's'}`;
  $('agendaList').innerHTML = agenda.map(order => `<article class="agenda-item"><div class="agenda-date"><div><strong>${order.appointmentDate ? shortDate(order.appointmentDate) : 'Pending'}</strong><span>${order.appointmentDate ? 'Confirmed' : 'No appointment'}</span></div></div><div class="agenda-po"><strong>PO ${safe(order.po)}</strong><span>${safe(order.customer)} · ${money(order.value)}</span></div><div class="agenda-location"><strong>${safe(order.location)}</strong><span>${order.invoice ? `Invoice ${safe(order.invoice)}` : 'Invoice pending'}</span></div><span class="status-pill ${statusClass(order.status)}">${safe(order.status)}</span><button class="view-button" type="button" data-view-po="${order.id}">View PO</button></article>`).join('');
  $('agendaEmpty').classList.toggle('hidden', agenda.length !== 0);
}
function filteredAvailableOrders() {
  const query = $('poSearch').value.trim().toLowerCase(); const confirmedOnly = $('confirmedOnly').checked;
  return availableOrders().filter(order => { const text = [order.po, order.customer, order.location, order.invoice].join(' ').toLowerCase(); return (!query || text.includes(query)) && (!confirmedOnly || order.appointmentDate); });
}
function renderOpenOrders() {
  const visible = filteredAvailableOrders(); const ids = new Set(visible.map(order => order.id)); [...state.selected].forEach(id => { if (!ids.has(id)) state.selected.delete(id); });
  $('poTableBody').innerHTML = visible.map(order => `<tr><td><input class="row-select" type="checkbox" data-select-po="${order.id}" ${state.selected.has(order.id) ? 'checked' : ''} aria-label="Select PO ${safe(order.po)}" /></td><td><span class="po-number">${safe(order.po)}</span><span class="row-customer">${customerLogo(order.customer)}${safe(order.customer)}</span></td><td>${dateText(order.poDate)}</td><td><span class="status-pill ${statusClass(order.status)}">${safe(order.status)}</span></td><td><div class="appointment-cell">${appointmentMarkup(order)}<button class="edit-date-button" type="button" data-edit-appointment="${order.id}">Edit date</button></div></td><td>${safe(order.location)}</td><td class="value-cell">${money(order.value)}</td><td>${order.invoice ? `<strong>${safe(order.invoice)}</strong><span class="secondary-line">${dateText(order.invoiceDate)}</span>` : '—'}</td><td><div class="po-action-stack"><button class="view-button" type="button" data-view-po="${order.id}">View</button><button class="edit-po-button" type="button" data-edit-po="${order.id}">Edit</button></div></td></tr>`).join('');
  $('poEmpty').classList.toggle('hidden', visible.length !== 0); $('selectAll').checked = visible.length > 0 && visible.every(order => state.selected.has(order.id));
  const selected = orders.filter(order => state.selected.has(order.id)); $('selectedCount').textContent = `${selected.length} PO${selected.length === 1 ? '' : 's'} selected`; $('selectedValue').textContent = `${money(selected.reduce((sum, order) => sum + order.value, 0))} selected value`; $('selectionBar').classList.toggle('hidden', selected.length === 0);
}
function tripNeedsCorrection(trip) { return trip.pos.some(link => link.deliveryStatus === 'Needs Correction'); }
function tripLinksForCustomer(trip) { return state.customer === 'All' ? trip.pos : trip.pos.filter(link => link.customer === state.customer); }
function filteredTrips() {
  const filter = $('tripFilter').value;
  return trips.filter(trip => tripLinksForCustomer(trip).length).filter(trip => filter === 'All' || (filter === 'Active' ? ACTIVE_TRIP_STATUSES.has(trip.status) || tripNeedsCorrection(trip) : trip.status === 'Delivered' && !tripNeedsCorrection(trip)));
}
function docButton(path, label) { return path ? `<button class="doc-link-button" type="button" data-open-doc="${safe(path)}">${safe(label)}</button>` : `<span class="doc-missing">${safe(label)} unavailable</span>`; }
function renderTrips() {
  const visible = filteredTrips(); $('tripCount').textContent = `${visible.length} trip${visible.length === 1 ? '' : 's'}`; $('tripEmpty').classList.toggle('hidden', visible.length !== 0);
  $('tripList').innerHTML = visible.map(trip => {
    const links = tripLinksForCustomer(trip); const appointments = links.map(link => link.appointmentDate).filter(Boolean).sort(); const correction = tripNeedsCorrection(trip);
    let actions = '';
    if (trip.status === 'Awaiting GRN' && !correction) actions = `<button type="button" data-edit-trip="${trip.id}">Edit</button><span class="grn-waiting">Waiting for customer GRN</span><button class="danger" type="button" data-delete-trip="${trip.id}">Delete</button>`;
    else if (ACTIVE_TRIP_STATUSES.has(trip.status) || correction) actions = `<button type="button" data-edit-trip="${trip.id}">Edit</button><button class="primary-mini" type="button" data-complete-trip="${trip.id}">${correction ? 'Correct delivery' : 'Complete'}</button><button class="danger" type="button" data-delete-trip="${trip.id}">Delete</button>`;
    const linkRows = links.map(link => `<div class="trip-po-doc-row"><div><strong>PO ${safe(link.po)}</strong><small>${safe(link.customer)} · ${safe(link.location)}${link.invoice ? ` · ${safe(link.invoice)}` : ''}</small>${link.correctionReason ? `<small class="correction-text">Correction: ${safe(link.correctionReason)}</small>` : ''}</div><div class="trip-docs">${docButton(link.poPath, 'PO copy')}${docButton(link.invoicePath, 'Invoice copy')}</div></div>`).join('');
    return `<article class="trip-row uat-trip-row ${statusClass(correction ? 'Needs Correction' : trip.status)}"><div><span>Trip date</span><strong>${dateText(trip.tripDate)}</strong><small>${safe(trip.vehicle)} · ${safe(trip.transporter)}</small></div><div class="trip-po-stack"><span>${links.length} purchase order${links.length === 1 ? '' : 's'}</span>${linkRows}</div><div><span>Appointment</span><strong>${appointments.length ? dateText(appointments[0]) : 'Awaiting'}</strong><small>${appointments.length > 1 ? `${appointments.length} confirmed dates` : appointments.length ? 'Confirmed' : 'Follow up required'}</small></div><div><span>Status</span><strong class="status-pill ${statusClass(correction ? 'Needs Correction' : trip.status)}">${safe(correction ? 'Needs Correction' : trip.status === 'Dispatched' ? 'In Transit' : trip.status)}</strong><small>${trip.actualFreight ? money(trip.actualFreight) : 'Cost pending'}</small></div><div class="uat-trip-actions">${actions}</div></article>`;
  }).join('');
}
function renderKpis() {
  const available = availableOrders(); const customerTrips = trips.filter(trip => tripLinksForCustomer(trip).length);
  $('availableKpi').textContent = available.length; $('todayKpi').textContent = available.filter(order => scheduleMatches(order, 'Today')).length; $('todayLabel').textContent = dateText(todayIso()); $('activeTripKpi').textContent = customerTrips.filter(trip => ACTIVE_TRIP_STATUSES.has(trip.status) || tripNeedsCorrection(trip)).length; $('awaitingGrnKpi').textContent = customerTrips.filter(trip => trip.status === 'Awaiting GRN').length;
}
function renderAll() { renderCustomerSwitcher(); renderKpis(); renderSchedule(); renderOpenOrders(); renderTrips(); }

function showPo(id) {
  const order = orders.find(item => item.id === id); if (!order) return;
  $('poDialogCustomer').textContent = order.customer; $('poDialogNumber').textContent = `PO ${order.po}`;
  $('poDialogContent').innerHTML = `<div class="detail-item"><span>PO date</span><strong>${dateText(order.poDate)}</strong></div><div class="detail-item"><span>Status</span><strong>${safe(order.status)}</strong></div><div class="detail-item"><span>PO value</span><strong>${money(order.value)}</strong></div><div class="detail-item"><span>Confirmed appointment</span><strong>${dateText(order.appointmentDate)}</strong></div><div class="detail-item"><span>Delivery location</span><strong>${safe(order.location)}</strong></div><div class="detail-item"><span>Invoice</span><strong>${safe(order.invoice || '—')}</strong></div><div class="detail-docs">${docButton(order.poPath, 'View PO copy')}${docButton(order.invoicePath, 'View invoice copy')}</div>`;
  $('poDialog').showModal();
}
function openEditPo(id) {
  const order = orders.find(item => item.id === id); if (!order) return;
  $('editPoForm').reset(); $('editPoError').textContent = ''; $('editPoId').value = order.id; $('editPoTitle').textContent = `Edit PO ${order.po}`;
  $('editPoCustomer').value = order.customerRaw || order.customer; $('editPoNumber').value = order.po; $('editPoDate').value = order.poDate || ''; $('editPoReceivedDate').value = order.receivedDate || order.poDate || ''; $('editPoAppointment').value = order.appointmentDate || ''; $('editPoLocation').value = order.location === 'Location pending' ? '' : order.location; $('editPoValue').value = order.value || ''; $('editPoStatus').value = order.status || ''; $('editPoRemarks').value = order.remarks || '';
  $('editPoDialog').showModal();
}
async function saveEditedPo(event) {
  event.preventDefault(); const order = orders.find(item => item.id === $('editPoId').value); if (!order) return;
  $('editPoError').textContent = ''; setDialogBusy('editPoForm', true);
  try {
    await api('/rest/v1/rpc/update_open_purchase_order', { method: 'POST', headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' }, body: JSON.stringify({ target_po_id: order.id, new_customer_name: $('editPoCustomer').value.trim(), new_po_number: order.po, new_po_date: $('editPoDate').value, new_po_received_date: $('editPoReceivedDate').value, new_appointment_date: $('editPoAppointment').value || null, new_delivery_location: $('editPoLocation').value.trim(), new_po_value: Number($('editPoValue').value || 0), new_assigned_to: order.assignedTo || null, new_remarks: $('editPoRemarks').value.trim() || null, new_po_attachment_url: null }) });
    $('editPoDialog').close(); toast(`PO ${order.po} updated.`); await loadData();
  } catch (error) { $('editPoError').textContent = error.message; } finally { setDialogBusy('editPoForm', false); }
}
function openAppointmentEdit(id) {
  const order = orders.find(item => item.id === id); if (!order) return;
  $('appointmentForm').reset(); $('appointmentError').textContent = ''; $('appointmentPoId').value = order.id; $('appointmentDate').value = order.appointmentDate || ''; $('appointmentSummary').textContent = `PO ${order.po} · ${order.customer} · ${order.location}`; $('appointmentDialog').showModal();
}
async function saveAppointmentDate(event) {
  event.preventDefault(); const order = orders.find(item => item.id === $('appointmentPoId').value); if (!order) return;
  $('appointmentError').textContent = ''; $('saveAppointmentButton').disabled = true;
  try { await api('/rest/v1/rpc/update_po_appointment_date', { method: 'POST', headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' }, body: JSON.stringify({ po_id: order.id, new_appointment_date: $('appointmentDate').value || null }) }); $('appointmentDialog').close(); toast(`Appointment updated for PO ${order.po}.`); await loadData(); }
  catch (error) { $('appointmentError').textContent = error.message; } finally { $('saveAppointmentButton').disabled = false; }
}

function transporterOptions(selected = '') { return '<option value="">Choose transporter</option>' + transporters.map(item => `<option value="${safe(item.id)}" data-name="${safe(item.name)}" ${item.id === selected || item.name === selected ? 'selected' : ''}>${safe(item.name)}</option>`).join(''); }
function planCard(order, link = null) {
  return `<article class="uat-po-plan" data-plan-po="${order.id}" data-link-id="${safe(link?.id || '')}" data-existing-file="${safe(link?.invoicePath || order.invoicePath || '')}" data-invoice-state="idle" data-invoice-items="[]"><div class="uat-po-plan-head"><div><strong>PO ${safe(order.po)} · ${safe(order.customer)}</strong><span>${safe(order.location)} · ${money(order.value)}</span></div>${appointmentMarkup(order)}</div><div class="uat-po-fields"><label>Invoice number*<input data-plan-invoice value="${safe(link?.invoice || order.invoice || '')}" placeholder="Tally invoice number" /></label><label>Invoice date*<input data-plan-invoice-date type="date" value="${safe(link?.invoiceDate || order.invoiceDate || '')}" /></label><label>Invoice amount (₹)*<input data-plan-invoice-amount type="number" min="0" step="0.01" value="${Number(link?.invoiceAmount || order.invoiceAmount || 0) || ''}" /></label><label>Allocated cost (₹)<input data-plan-cost type="number" min="0" step="0.01" value="${Number(link?.allocatedCost || 0) || ''}" placeholder="Optional" /></label><label>Invoice copy*<input data-plan-file type="file" accept="application/pdf" /><small class="uat-file-note">${link?.invoicePath || order.invoicePath ? 'Invoice already attached. Upload only to replace it.' : 'Select the original Tally PDF.'}</small></label></div><div class="invoice-read-status"></div></article>`;
}
function openCreateTrip() {
  const selected = orders.filter(order => state.selected.has(order.id)); if (!selected.length) return;
  state.editTripId = null; $('tripError').textContent = ''; $('tripDialogTitle').textContent = 'Create a new trip'; $('tripSummary').textContent = `${selected.length} PO${selected.length === 1 ? '' : 's'} selected for this vehicle.`; $('tripDate').value = todayIso(); $('tripTransporter').innerHTML = transporterOptions(); $('tripVehicle').value = ''; $('tripDriver').value = ''; $('tripPhone').value = ''; $('tripCost').value = ''; $('tripPoList').innerHTML = selected.map(order => planCard(order)).join(''); $('tripDialog').showModal();
}
function openEditTrip(id) {
  const trip = trips.find(item => item.id === id); if (!trip) return;
  state.editTripId = id; $('tripError').textContent = ''; $('tripDialogTitle').textContent = 'Edit trip'; $('tripSummary').textContent = `${trip.pos.length} linked PO${trip.pos.length === 1 ? '' : 's'}.`;
  $('tripDate').value = trip.tripDate; $('tripTransporter').innerHTML = transporterOptions(trip.transporterId || trip.transporter); $('tripVehicle').value = trip.vehicle === 'Vehicle pending' ? '' : trip.vehicle; $('tripDriver').value = trip.driver; $('tripPhone').value = trip.driverPhone; $('tripCost').value = trip.quotedCost || trip.actualFreight || '';
  $('tripPoList').innerHTML = trip.pos.map(link => { const order = orders.find(item => item.id === link.purchaseOrderId) || { id: link.purchaseOrderId, po: link.po, customer: link.customer, location: link.location, value: link.value, appointmentDate: link.appointmentDate, invoice: link.invoice, invoiceDate: link.invoiceDate, invoiceAmount: link.invoiceAmount, invoicePath: link.invoicePath }; return planCard(order, link); }).join(''); $('tripDialog').showModal();
}

function normalizePoNumber(value) { return String(value || '').replace(/\D/g, ''); }
function tallyDateToIso(value) {
  const match = String(value || '').match(/(\d{1,2})[-\s\/]([A-Za-z]{3,9})[-\s\/](\d{2,4})/); if (!match) return '';
  const months = { jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12 };
  const month = months[match[2].toLowerCase()]; if (!month) return ''; const year = match[3].length === 2 ? 2000 + Number(match[3]) : Number(match[3]); return `${year}-${String(month).padStart(2, '0')}-${String(Number(match[1])).padStart(2, '0')}`;
}
async function readPdfLines(file) {
  if (!window.pdfjsLib) throw new Error('The PDF reader did not load.');
  window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  const pdf = await window.pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise; const lines = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) { const page = await pdf.getPage(pageNumber); const content = await page.getTextContent(); lines.push(...content.items.map(item => String(item.str || '').trim()).filter(Boolean)); }
  return lines;
}
function parseInvoiceItems(flat) {
  const goods = flat.split(/Amount\s+Chargeable/i)[0]; const products = [...goods.matchAll(/MYSORE\s+SANDAL\s+[A-Z][A-Z0-9 ()&/.\-]{1,90}?\s+\d+(?:\.\d+)?\s*(?:G|GM|ML)(?=\s|DISCOUNT|OUTPUT|$)/gi)].map(match => match[0].replace(/\s+/g, ' ').trim());
  const cbs = [...goods.matchAll(/([\d,.]+)\s*CBS\b/gi)].map(match => Number(match[1].replace(/,/g, ''))).filter(Boolean); const pcs = [...goods.matchAll(/([\d,]+)\s*(PCS|NOS|EA|BOX|CTN|BTL)\s*([\d,]+\.\d{2})/gi)].map(match => ({ quantity: Number(match[1].replace(/,/g, '')), unit: match[2].toUpperCase(), amount: Number(match[3].replace(/,/g, '')) })); const hsns = (goods.match(/\b\d{8}\b/g) || []); const count = Math.min(products.length, cbs.length, pcs.length);
  return products.slice(0, count).map((name, index) => ({ line_number: index + 1, article_name: name, article_description: name, hsn_sac: hsns[index] || null, quantity: pcs[index].quantity, quantity_cbs: cbs[index], unit: pcs[index].unit, rate: Number((pcs[index].amount / pcs[index].quantity).toFixed(4)), taxable_amount: pcs[index].amount }));
}
function parseTallyInvoice(lines, expectedPoNumber) {
  const flat = lines.join(' ').replace(/\s+/g, ' '); const invoiceNumber = flat.match(/\b(BMAG\/\d{2}-\d{2}\/\d{3,8})\b/i)?.[1] || flat.match(/\b([A-Z]{2,10}[A-Z0-9 -]*\/\d{2}-\d{2}\/\d{3,8})\b/i)?.[1] || '';
  const dateRaw = flat.match(/\b(\d{1,2}[-\s\/][A-Za-z]{3,9}[-\s\/]\d{2,4})\b/)?.[1] || ''; const expected = normalizePoNumber(expectedPoNumber); const poNumber = expected && new RegExp(`(?:^|\\D)${expected}(?:\\D|$)`).test(flat) ? expectedPoNumber : flat.match(/Buyer'?s\s+Order\s+No[^0-9]{0,30}(\d{8,12})/i)?.[1] || '';
  const amounts = [...flat.matchAll(/Total\s+Inv\s+Amt\s*:\s*([\d,]+\.\d{2})/gi)].map(match => Number(match[1].replace(/,/g, ''))); const rupeeTotals = [...flat.matchAll(/(?:₹|Rs\.?)\s*([\d,]+\.\d{2})/gi)].map(match => Number(match[1].replace(/,/g, ''))); const invoiceValue = amounts[0] || (rupeeTotals.length ? Math.max(...rupeeTotals) : null); const vehicle = flat.match(/\b([A-Z]{2}\s?\d{1,2}\s?[A-Z]{1,3}\s?\d{4})\b/i)?.[1]?.replace(/\s+/g, '').toUpperCase() || '';
  return { invoiceNumber, invoiceDate: tallyDateToIso(dateRaw), poNumber, invoiceValue, vehicle, items: parseInvoiceItems(flat) };
}
async function handleInvoiceFile(input) {
  const card = input.closest('[data-plan-po]'); const file = input.files?.[0]; const order = orders.find(item => item.id === card?.dataset.planPo); if (!card || !file || !order) return;
  const status = card.querySelector('.invoice-read-status'); card.dataset.invoiceState = 'reading'; status.textContent = 'Reading invoice…';
  try {
    const parsed = parseTallyInvoice(await readPdfLines(file), order.po); if (parsed.invoiceNumber) card.querySelector('[data-plan-invoice]').value = parsed.invoiceNumber; if (parsed.invoiceDate) card.querySelector('[data-plan-invoice-date]').value = parsed.invoiceDate; if (parsed.invoiceValue) card.querySelector('[data-plan-invoice-amount]').value = parsed.invoiceValue.toFixed(2); if (parsed.vehicle) $('tripVehicle').value = parsed.vehicle; card.dataset.invoiceItems = JSON.stringify(parsed.items || []);
    const actual = normalizePoNumber(parsed.poNumber); const expected = normalizePoNumber(order.po); if (actual && actual !== expected) { card.dataset.invoiceState = 'mismatch'; status.textContent = `Wrong invoice: PO ${parsed.poNumber} does not match ${order.po}.`; return; }
    card.dataset.invoiceState = parsed.invoiceNumber && parsed.invoiceDate ? 'matched' : 'warning'; status.textContent = card.dataset.invoiceState === 'matched' ? `✓ PO ${order.po} matched${parsed.items.length ? ` · ${parsed.items.length} product line(s) ready for Analytics` : ''}` : 'Please verify the invoice number, date and amount.';
  } catch (error) { card.dataset.invoiceState = 'warning'; status.textContent = error.message; }
}
function planDetails() {
  return [...document.querySelectorAll('[data-plan-po]')].map(card => ({ purchaseOrderId: card.dataset.planPo, linkId: card.dataset.linkId || null, existingPath: card.dataset.existingFile || '', invoiceState: card.dataset.invoiceState || 'idle', invoiceNumber: card.querySelector('[data-plan-invoice]').value.trim(), invoiceDate: card.querySelector('[data-plan-invoice-date]').value, invoiceAmount: Number(card.querySelector('[data-plan-invoice-amount]').value || 0), allocatedCost: Number(card.querySelector('[data-plan-cost]').value || 0), invoiceFile: card.querySelector('[data-plan-file]').files[0], items: JSON.parse(card.dataset.invoiceItems || '[]') }));
}
async function saveTrip(event) {
  event.preventDefault(); $('tripError').textContent = ''; const details = planDetails(); const editTrip = state.editTripId ? trips.find(item => item.id === state.editTripId) : null;
  try {
    setDialogBusy('tripForm', true); if (!$('tripTransporter').value) throw new Error('Select a transporter.');
    for (const detail of details) { if (detail.invoiceState === 'reading') throw new Error('Wait for invoice reading to finish.'); if (detail.invoiceState === 'mismatch') throw new Error('Replace the invoice that does not match its PO.'); if (!detail.invoiceNumber || !detail.invoiceDate || detail.invoiceAmount <= 0 || (!detail.invoiceFile && !detail.existingPath)) throw new Error(`Complete invoice number, date, amount and attachment for PO ${orders.find(order => order.id === detail.purchaseOrderId)?.po || ''}.`); }
    const tripId = editTrip?.id || crypto.randomUUID(); await Promise.all(details.map(async detail => { detail.invoicePath = detail.invoiceFile ? await uploadFile('trip-invoices', tripId, detail.purchaseOrderId, detail.invoiceFile) : detail.existingPath; }));
    const option = $('tripTransporter').selectedOptions[0]; const payload = { trip_date: $('tripDate').value, transporter_id: $('tripTransporter').value, transporter: option?.dataset.name || option?.textContent?.trim() || null, vehicle_number: $('tripVehicle').value.trim() || null, driver_name: $('tripDriver').value.trim() || null, driver_phone: $('tripPhone').value.trim() || null, quoted_cost: Number($('tripCost').value || 0), actual_freight: Number($('tripCost').value || 0) };
    if (editTrip) {
      await api(`/rest/v1/delivery_trips?id=eq.${encodeURIComponent(tripId)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' }, body: JSON.stringify(payload) });
      await Promise.all(details.map(detail => api(`/rest/v1/delivery_trip_pos?trip_id=eq.${encodeURIComponent(tripId)}&purchase_order_id=eq.${encodeURIComponent(detail.purchaseOrderId)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' }, body: JSON.stringify({ allocation_method: 'Manual', allocated_cost: detail.allocatedCost, invoice_number: detail.invoiceNumber, invoice_date: detail.invoiceDate, invoice_amount: detail.invoiceAmount, invoice_attachment_url: detail.invoicePath }) })));
    } else {
      await api('/rest/v1/delivery_trips', { method: 'POST', headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' }, body: JSON.stringify({ id: tripId, status: 'Dispatched', ...payload }) });
      await api('/rest/v1/delivery_trip_pos', { method: 'POST', headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' }, body: JSON.stringify(details.map(detail => ({ trip_id: tripId, purchase_order_id: detail.purchaseOrderId, allocation_method: 'Manual', allocated_cost: detail.allocatedCost, invoice_number: detail.invoiceNumber, invoice_date: detail.invoiceDate, invoice_amount: detail.invoiceAmount, invoice_attachment_url: detail.invoicePath, delivery_status: 'Pending' }))) }); state.selected.clear();
    }
    await Promise.all(details.filter(detail => detail.items.length && /^BMAG\//i.test(detail.invoiceNumber)).map(detail => { const order = orders.find(item => item.id === detail.purchaseOrderId); return api('/rest/v1/rpc/import_dmart_invoice_items', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ payload: { invoice_number: detail.invoiceNumber, po_number: order.po, invoice_date: detail.invoiceDate, delivery_location: order.location, items: detail.items } }) }).catch(error => console.error('Analytics sync failed:', error)); }));
    $('tripDialog').close(); toast(editTrip ? 'Trip updated.' : 'Trip created. Selected POs moved to POs in Trip.'); await loadData(); $('tripsTitle').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (error) { $('tripError').textContent = error.message; } finally { setDialogBusy('tripForm', false); }
}
function openCompleteTrip(id) {
  const trip = trips.find(item => item.id === id); if (!trip) return; if (trip.status === 'Awaiting GRN' && !tripNeedsCorrection(trip)) return toast('This trip is waiting for the customer GRN email.');
  state.completeTripId = id; $('completeError').textContent = ''; const correctionLinks = trip.pos.filter(link => link.deliveryStatus === 'Needs Correction'); const links = correctionLinks.length ? correctionLinks : trip.pos; const hasEmailGrn = links.some(link => usesEmailGrn(link.customer)); const hasSlipCustomer = links.some(link => !usesEmailGrn(link.customer)); $('completeSummary').textContent = `${links.length} PO${links.length === 1 ? '' : 's'} · ${trip.vehicle}`; $('finalTripCost').value = trip.actualFreight || trip.quotedCost || ''; const evenCost = (trip.actualFreight || trip.quotedCost || 0) / Math.max(1, links.length);
  $('completePoList').innerHTML = links.map(link => { const emailGrn = usesEmailGrn(link.customer); return `<article class="uat-complete-po" data-complete-po="${link.purchaseOrderId}" data-customer="${safe(link.customer)}"><div class="uat-po-plan-head"><div><strong>PO ${safe(link.po)} · ${safe(link.customer)}</strong><span>${safe(link.location)} · ${link.invoice ? `Invoice ${safe(link.invoice)}` : 'Invoice pending'}</span></div><span>${emailGrn ? 'Email GRN-controlled' : 'Delivery slip required'}</span></div><div class="uat-complete-fields"><label>Final PO cost (₹)<input data-complete-cost type="number" min="0" step="0.01" value="${Number(link.allocatedCost || evenCost || 0) || ''}" /></label>${emailGrn ? `<div class="uat-blinkit-rule">No delivery slip. ${safe(link.customer)} will move to Awaiting GRN.</div>` : '<label>Delivery slip*<input data-complete-note type="file" accept="application/pdf,image/jpeg,image/png" required /></label>'}</div></article>`; }).join('');
  $('completionRule').innerHTML = hasEmailGrn && hasSlipCustomer ? '<strong>Mixed trip:</strong> DMart POs will be delivered after the signed slip is saved; email-GRN POs will wait for customer confirmation.' : hasEmailGrn ? '<strong>Email GRN customers:</strong> enter the final costs. Delivery is confirmed automatically from the customer GRN email.' : '<strong>DMart:</strong> upload a signed delivery slip and final cost for each PO.'; $('completeDialog').showModal();
  updateCompletionTotal();
}
function updateCompletionTotal() { $('finalTripCost').value = [...document.querySelectorAll('[data-complete-cost]')].reduce((sum, input) => sum + Number(input.value || 0), 0).toFixed(2); }
async function completeTrip(event) {
  event.preventDefault(); const trip = trips.find(item => item.id === state.completeTripId); if (!trip) return; $('completeError').textContent = '';
  const cards = [...document.querySelectorAll('[data-complete-po]')];
  try {
    setDialogBusy('completeForm', true); const deliveries = await Promise.all(cards.map(async card => { const poId = card.dataset.completePo; const emailGrn = usesEmailGrn(card.dataset.customer); const file = card.querySelector('[data-complete-note]')?.files?.[0]; if (!emailGrn && !file) throw new Error('Upload every required DMart delivery slip.'); return { purchase_order_id: poId, note_path: emailGrn ? null : await uploadFile('trip-delivery-slips', trip.id, poId, file), final_cost: Number(card.querySelector('[data-complete-cost]').value || 0) }; }));
    await api('/rest/v1/rpc/complete_delivery_trip', { method: 'POST', headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' }, body: JSON.stringify({ trip: trip.id, deliveries }) }); $('completeDialog').close(); toast(cards.some(card => usesEmailGrn(card.dataset.customer)) ? 'Transport cost saved. Email-GRN POs are awaiting customer confirmation.' : 'Delivery completed and owner tracker updated.'); await loadData();
  } catch (error) { $('completeError').textContent = error.message; } finally { setDialogBusy('completeForm', false); }
}
async function deleteTrip(id) {
  if (!confirm('Delete this trip? Its POs will return to the open list so the trip can be recreated.')) return;
  try { await api('/rest/v1/rpc/delete_delivery_trip', { method: 'POST', headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' }, body: JSON.stringify({ trip: id }) }); state.selected.clear(); toast('Trip deleted. POs returned to the open list.'); await loadData(); }
  catch (error) { toast(error.message); }
}
function setDialogBusy(formId, busy) { document.querySelectorAll(`#${formId} button, #${formId} input, #${formId} select, #${formId} textarea`).forEach(control => { if (!control.classList.contains('icon-button')) control.disabled = busy; }); }
function toast(message) { $('toast').textContent = message; $('toast').classList.add('show'); clearTimeout(toast.timer); toast.timer = setTimeout(() => $('toast').classList.remove('show'), 3600); }
function closeDialog(id) { $(id).close(); }
function showApp(value) { $('currentUser').textContent = value.user?.email || ''; $('loginView').classList.add('hidden'); $('appView').classList.remove('hidden'); loadData(); clearInterval(refreshTimer); refreshTimer = setInterval(loadData, 60000); }
function showLogin() { $('appView').classList.add('hidden'); $('loginView').classList.remove('hidden'); }

document.querySelectorAll('[data-schedule]').forEach(button => button.addEventListener('click', () => { state.schedule = button.dataset.schedule; renderSchedule(); }));
$('showAllSchedule').addEventListener('click', () => { state.schedule = 'All'; renderSchedule(); });
$('poSearch').addEventListener('input', renderOpenOrders); $('confirmedOnly').addEventListener('change', renderOpenOrders); $('tripFilter').addEventListener('change', renderTrips);
$('selectAll').addEventListener('change', event => { filteredAvailableOrders().forEach(order => event.target.checked ? state.selected.add(order.id) : state.selected.delete(order.id)); renderOpenOrders(); });
$('poTableBody').addEventListener('change', event => { if (!event.target.matches('[data-select-po]')) return; event.target.checked ? state.selected.add(event.target.dataset.selectPo) : state.selected.delete(event.target.dataset.selectPo); renderOpenOrders(); });
$('clearSelection').addEventListener('click', () => { state.selected.clear(); renderOpenOrders(); }); $('createTripButton').addEventListener('click', openCreateTrip);
$('tripForm').addEventListener('submit', saveTrip); $('closeTripDialog').addEventListener('click', () => closeDialog('tripDialog')); $('cancelTripButton').addEventListener('click', () => closeDialog('tripDialog'));
$('completeForm').addEventListener('submit', completeTrip); $('closeCompleteDialog').addEventListener('click', () => closeDialog('completeDialog')); $('cancelCompleteButton').addEventListener('click', () => closeDialog('completeDialog'));
$('completePoList').addEventListener('input', event => { if (event.target.matches('[data-complete-cost]')) updateCompletionTotal(); });
$('editPoForm').addEventListener('submit', saveEditedPo); $('closeEditPoDialog').addEventListener('click', () => closeDialog('editPoDialog')); $('cancelEditPoButton').addEventListener('click', () => closeDialog('editPoDialog'));
$('appointmentForm').addEventListener('submit', saveAppointmentDate); $('closeAppointmentDialog').addEventListener('click', () => closeDialog('appointmentDialog')); $('cancelAppointmentButton').addEventListener('click', () => closeDialog('appointmentDialog'));
$('tripPoList').addEventListener('change', event => { if (event.target.matches('[data-plan-file]')) handleInvoiceFile(event.target); });
$('refreshButton').addEventListener('click', loadData); $('signOutButton').addEventListener('click', () => { clearInterval(refreshTimer); session = null; sessionStorage.removeItem(SESSION_KEY); location.reload(); });
document.body.addEventListener('click', event => { const po = event.target.closest('[data-view-po]'); if (po) showPo(po.dataset.viewPo); const appointment = event.target.closest('[data-edit-appointment]'); if (appointment) openAppointmentEdit(appointment.dataset.editAppointment); const editPo = event.target.closest('[data-edit-po]'); if (editPo) openEditPo(editPo.dataset.editPo); const edit = event.target.closest('[data-edit-trip]'); if (edit) openEditTrip(edit.dataset.editTrip); const complete = event.target.closest('[data-complete-trip]'); if (complete) openCompleteTrip(complete.dataset.completeTrip); const remove = event.target.closest('[data-delete-trip]'); if (remove) deleteTrip(remove.dataset.deleteTrip); const documentButton = event.target.closest('[data-open-doc]'); if (documentButton) openDocument(documentButton.dataset.openDoc); });
$('loginForm').addEventListener('submit', async event => { event.preventDefault(); $('loginError').textContent = ''; try { const value = await authRequest('/auth/v1/token?grant_type=password', { email: $('email').value.trim(), password: $('password').value }); storeSession(value); showApp(value); } catch (error) { $('loginError').textContent = error.message; } });

(async function bootstrap() { try { validateConfig(); const value = await restoreSession(); if (value) showApp(value); else showLogin(); } catch (error) { showLogin(); $('loginError').textContent = error.message; } })();
