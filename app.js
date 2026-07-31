/* global XLSX */
const CONFIG = window.PO_TRACKER_CONFIG || {};
const STATUSES = ['Received', 'Scheduled', 'In Transit', 'Delivered', 'Partially Delivered', 'Cancelled'];
const STORAGE_KEY = 'ksdl-po-tracker-v1';
const NOTE_BUCKET = 'delivery-notes';
let records = [];
let authSession = null;
let refreshTimer = null;

const $ = (id) => document.getElementById(id);
const fields = ['customerName', 'poNumber', 'deliveryLocation', 'poDate', 'poReceivedDate', 'deliveryDate', 'status', 'poValue', 'invoiceNumber', 'invoiceDate', 'transporter', 'transportAmount', 'trackingNumber', 'assignedTo', 'reviewStatus', 'correctionNote', 'remarks'];

function money(value) { return new Intl.NumberFormat('en-IN', {style: 'currency', currency: 'INR', maximumFractionDigits: 0}).format(Number(value || 0)); }
function date(value) { return value ? new Date(`${value}T00:00:00`).toLocaleDateString('en-IN', {day: '2-digit', month: 'short', year: 'numeric'}) : '—'; }
function today() { return new Date().toISOString().slice(0, 10); }
function safe(value) { return String(value ?? '').replace(/[&<>"']/g, char => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[char])); }
function normalizeDeliveryLocation(value) {
  const location = String(value || '').replace(/\s+/g, ' ').trim();
  return /^modasa(?:\b|[,\-])/i.test(location) ? 'Modasa' : location;
}
function slug(value) { return String(value).toLowerCase().replace(/\s+/g, '-'); }
function ageDays(record) { return record.poReceivedDate ? Math.max(0, Math.floor((new Date() - new Date(`${record.poReceivedDate}T00:00:00`)) / 86400000)) : null; }
function delayDays(record) { return record.deliveryDate && record.poDate ? Math.round((new Date(`${record.deliveryDate}T00:00:00`) - new Date(`${record.poDate}T00:00:00`)) / 86400000) : null; }
function isOpen(record) { return !['Delivered', 'Cancelled'].includes(record.status); }
function cloudEnabled() { return Boolean(CONFIG.SUPABASE_URL && CONFIG.SUPABASE_ANON_KEY); }
function secureLoginRequired() { return CONFIG.REQUIRE_SECURE_LOGIN === true; }
function supabaseHeaders() { const token = secureLoginRequired() ? authSession?.access_token : CONFIG.SUPABASE_ANON_KEY; if (!token) throw new Error('Please sign in again'); return {apikey: CONFIG.SUPABASE_ANON_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Prefer: 'return=representation'}; }
async function signIn(email, password) { const response = await fetch(`${CONFIG.SUPABASE_URL}/auth/v1/token?grant_type=password`, {method: 'POST', headers: {apikey: CONFIG.SUPABASE_ANON_KEY, 'Content-Type': 'application/json'}, body: JSON.stringify({email, password})}); const data = await response.json(); if (!response.ok) throw new Error(data.error_description || data.msg || 'Could not sign in'); authSession = data; sessionStorage.setItem('ksdl-po-tracker-session', JSON.stringify(data)); }
function signOut() { authSession = null; sessionStorage.removeItem('ksdl-po-tracker-session'); clearInterval(refreshTimer); location.reload(); }
function toCloud(record) { return {id: record.id, customer_name: record.customerName, po_number: record.poNumber, delivery_location: normalizeDeliveryLocation(record.deliveryLocation) || null, po_date: record.poDate || null, po_received_date: record.poReceivedDate || null, delivery_date: record.deliveryDate || null, delivery_completed_date: record.deliveryCompletedDate || null, status: record.status, po_value: Number(record.poValue || 0), invoice_number: record.invoiceNumber || null, invoice_date: record.invoiceDate || null, invoice_attachment_url: record.invoiceAttachmentUrl || null, transporter: record.transporter || null, transport_amount: Number(record.transportAmount || 0), tracking_number: record.trackingNumber || null, assigned_to: record.assignedTo || null, entry_source: record.entrySource || undefined, review_status: record.reviewStatus || undefined, correction_note: record.correctionNote || null, remarks: record.remarks || null, po_attachment_url: record.poAttachmentUrl || null, delivery_note_url: record.deliveryNoteUrl || null, updated_at: new Date().toISOString()}; }
function fromCloud(record) { return {id: record.id, customerName: record.customer_name, poNumber: record.po_number, deliveryLocation: normalizeDeliveryLocation(record.delivery_location), poDate: record.po_date, poReceivedDate: record.po_received_date, deliveryDate: record.delivery_date, deliveryCompletedDate: record.delivery_completed_date, status: record.status, poValue: record.po_value, invoiceNumber: record.invoice_number, invoiceDate: record.invoice_date, invoiceAttachmentUrl: record.invoice_attachment_url, transporter: record.transporter, transportAmount: record.transport_amount, trackingNumber: record.tracking_number, assignedTo: record.assigned_to, entrySource: record.entry_source, reviewStatus: record.review_status || 'Approved', correctionNote: record.correction_note, remarks: record.remarks, poAttachmentUrl: record.po_attachment_url, deliveryNoteUrl: record.delivery_note_url}; }
async function loadRecords() { if (!cloudEnabled()) { records = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); render(); return; } try { const response = await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/purchase_orders?is_archived=eq.false&select=*&order=po_received_date.desc`, {headers: supabaseHeaders()}); if (!response.ok) throw new Error('Could not load cloud data'); records = (await response.json()).map(fromCloud); await resolveDeliveryNoteLinks_(); $('connectionStatus').textContent = 'Cloud synced'; } catch (error) { records = []; $('connectionStatus').textContent = 'Cloud unavailable'; toast(error.message || 'Could not load cloud data'); } render(); }
async function persist(record, deleting = false, isNew = false) { if (!cloudEnabled()) { localStorage.setItem(STORAGE_KEY, JSON.stringify(records)); return; } const endpoint = isNew ? `${CONFIG.SUPABASE_URL}/rest/v1/purchase_orders` : `${CONFIG.SUPABASE_URL}/rest/v1/purchase_orders?id=eq.${encodeURIComponent(record.id)}`; const response = await fetch(endpoint, {method: deleting ? 'DELETE' : isNew ? 'POST' : 'PATCH', headers: supabaseHeaders(), body: deleting ? undefined : JSON.stringify(toCloud(record))}); if (!response.ok) throw new Error('Cloud save failed'); }
async function permanentlyRemovePo(record, replacementPoNumber = '') {
  if (!cloudEnabled()) {
    records = records.filter(item => item.id !== record.id);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
    return;
  }
  const response = await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/rpc/permanently_remove_po`, {
    method: 'POST',
    headers: supabaseHeaders(),
    body: JSON.stringify({
      po_id: record.id,
      reason: 'Cancelled by DMart and replaced with a corrected PO',
      replacement_po: replacementPoNumber || null
    })
  });
  const text = await response.text();
  if (!response.ok) {
    let message = text;
    try { message = JSON.parse(text).message || text; } catch (_) {}
    throw new Error(message || 'Permanent PO removal failed');
  }
}
function deliveryNotePath_(value) { const marker = `/storage/v1/object/public/${NOTE_BUCKET}/`; const text = String(value || ''); return text.includes(marker) ? text.split(marker)[1].split('?')[0] : text; }
async function signedDeliveryNoteUrl_(value) { const path = deliveryNotePath_(value); if (!path) return ''; const response = await fetch(`${CONFIG.SUPABASE_URL}/storage/v1/object/sign/${NOTE_BUCKET}/${path}`, {method: 'POST', headers: supabaseHeaders(), body: JSON.stringify({expiresIn: 3600})}); if (!response.ok) return ''; const data = await response.json(); return data.signedURL ? `${CONFIG.SUPABASE_URL}/storage/v1${data.signedURL}` : ''; }
async function resolveDeliveryNoteLinks_() { await Promise.all(records.map(async record => { if (record.deliveryNoteUrl) record.deliveryNoteLink = await signedDeliveryNoteUrl_(record.deliveryNoteUrl); if (record.poAttachmentUrl) record.poAttachmentLink = await signedDeliveryNoteUrl_(record.poAttachmentUrl); if (record.invoiceAttachmentUrl) record.invoiceAttachmentLink = await signedDeliveryNoteUrl_(record.invoiceAttachmentUrl); })); }
async function uploadPoAttachment(recordId, file) { if (!cloudEnabled()) throw new Error('PO-copy upload needs cloud sync'); if (file.size > 10 * 1024 * 1024) throw new Error('PO copy must be 10 MB or smaller'); const name = file.name.replace(/[^a-zA-Z0-9._-]/g, '_'); const path = `po-copies/${recordId}/${Date.now()}-${name}`; const response = await fetch(`${CONFIG.SUPABASE_URL}/storage/v1/object/${NOTE_BUCKET}/${path}`, {method: 'POST', headers: {...supabaseHeaders(), 'Content-Type': file.type || 'application/octet-stream', 'x-upsert': 'true'}, body: file}); if (!response.ok) throw new Error('PO-copy upload failed'); return path; }
async function uploadDeliveryNote(recordId, file) { if (!cloudEnabled()) throw new Error('Delivery-note upload needs cloud sync'); if (file.size > 10 * 1024 * 1024) throw new Error('Delivery note must be 10 MB or smaller'); const name = file.name.replace(/[^a-zA-Z0-9._-]/g, '_'); const path = `${recordId}/${Date.now()}-${name}`; const response = await fetch(`${CONFIG.SUPABASE_URL}/storage/v1/object/${NOTE_BUCKET}/${path}`, {method: 'POST', headers: {...supabaseHeaders(), 'Content-Type': file.type || 'application/octet-stream', 'x-upsert': 'true'}, body: file}); if (!response.ok) throw new Error('Delivery-note upload failed'); return path; }
function updateFilters() { const customers = [...new Set(records.map(record => record.customerName).filter(Boolean))].sort(); const select = $('customerFilter'); const chosen = select.value; select.innerHTML = '<option value="">All customers</option>' + customers.map(customer => `<option value="${safe(customer)}">${safe(customer)}</option>`).join(''); select.value = chosen; }
function localIsoDate_(value) { const year = value.getFullYear(), month = String(value.getMonth() + 1).padStart(2, '0'), day = String(value.getDate()).padStart(2, '0'); return `${year}-${month}-${day}`; }
function calendarMonthBounds_(offset) { const now = new Date(), start = new Date(now.getFullYear(), now.getMonth() + offset, 1), end = offset === 0 ? now : new Date(now.getFullYear(), now.getMonth() + offset + 1, 0); return {from: localIsoDate_(start), to: localIsoDate_(end)}; }
function selectedDateBounds_() { const range = $('dateRangeFilter').value; if (range === 'current') return calendarMonthBounds_(0); if (range === 'last') return calendarMonthBounds_(-1); return {from: $('dateFrom').value, to: $('dateTo').value}; }
function toggleCustomDates_() { $('customDateFilters').classList.toggle('hidden', $('dateRangeFilter').value !== 'custom'); }
function filtered() { const search = $('searchInput').value.trim().toLowerCase(), status = $('statusFilter').value, customer = $('customerFilter').value, dateField = $('dateFieldFilter').value, {from, to} = selectedDateBounds_(); return records.filter(record => { const filterDate = record[dateField] || ''; return (!status || record.status === status) && (!customer || record.customerName === customer) && (!from || (filterDate && filterDate >= from)) && (!to || (filterDate && filterDate <= to)) && (!search || Object.values(record).join(' ').toLowerCase().includes(search)); }).sort((a, b) => (b.poReceivedDate || '').localeCompare(a.poReceivedDate || '')); }
function poRow(record) {
  const deliveryDelay = delayDays(record);
  return `<tr>
    <td data-column="po" data-label="PO / Customer"><span class="primary-cell">${safe(record.poNumber)}</span><span class="secondary">${safe(record.customerName)}</span></td>
    <td data-column="po-date" data-label="PO date">${date(record.poDate)}<span class="secondary">Received ${date(record.poReceivedDate)}</span></td>
    <td data-column="status" data-label="Status"><span class="pill ${slug(record.status)}">${safe(record.status)}</span></td>
    <td data-column="delivery-date" data-label="Appointment date">${date(record.deliveryDate)}${deliveryDelay !== null ? `<span class="secondary">${deliveryDelay} day${Math.abs(deliveryDelay) === 1 ? '' : 's'} from PO</span>` : ''}</td>
    <td data-column="completed-date" data-label="Delivery completed">${date(record.deliveryCompletedDate)}<span class="secondary">${record.deliveryCompletedDate ? 'Payment clock starts' : 'Waiting for completion'}</span>${record.deliveryNoteLink ? `<a class="note-link" href="${safe(record.deliveryNoteLink)}" target="_blank" rel="noopener">View delivery note</a>` : ''}</td>
    <td data-column="value" data-label="PO value">${money(record.poValue)}</td>
    <td data-column="location" data-label="Delivery location">${safe(record.deliveryLocation || '—')}</td>
    <td data-column="invoice" data-label="Invoice">${safe(record.invoiceNumber || '—')}<span class="secondary">${date(record.invoiceDate)}</span>${record.invoiceAttachmentLink ? `<a class="note-link" href="${safe(record.invoiceAttachmentLink)}" target="_blank" rel="noopener">View invoice</a>` : ''}</td>
    <td data-column="transport" data-label="Transport">${safe(record.transporter || '—')}<span class="secondary">${safe(record.trackingNumber || '')}${record.transportAmount ? ` · ${money(record.transportAmount)}` : ''}</span></td>
    <td data-column="age" data-label="PO age">${ageDays(record) === null ? '—' : `${ageDays(record)} days`}</td>
    <td data-column="action" data-label="Action"><button class="action-btn" data-edit="${record.id}">Edit</button></td>
  </tr>`;
}
function render() { updateFilters(); const showing = filtered(), total = showing.reduce((sum, record) => sum + Number(record.poValue || 0), 0), delivered = showing.filter(record => record.status === 'Delivered'), pending = showing.filter(record => ['Received', 'Scheduled'].includes(record.status)), attention = showing.filter(record => isOpen(record) && ageDays(record) >= 3); $('totalCount').textContent = showing.length; $('totalValue').textContent = money(total); $('pendingCount').textContent = pending.length; $('transitCount').textContent = showing.filter(record => record.status === 'In Transit').length; $('deliveredCount').textContent = delivered.length; $('deliveredValue').textContent = `${money(delivered.reduce((sum, record) => sum + Number(record.poValue || 0), 0))} value`; $('attentionCount').textContent = attention.length; $('resultCount').textContent = `${showing.length} record${showing.length === 1 ? '' : 's'}`; $('poTableBody').innerHTML = showing.map(poRow).join(''); $('emptyState').classList.toggle('hidden', showing.length > 0); }
function openDialog(record) { $('poForm').reset(); $('recordId').value = record?.id || ''; $('formTitle').textContent = record ? 'Edit PO' : 'Add PO'; $('deleteBtn').classList.toggle('hidden', !record); fields.forEach(field => { if (record && record[field] !== undefined) $('poForm').elements[field].value = record[field] ?? ''; }); if (!record) { $('poForm').elements.poReceivedDate.value = today(); $('poForm').elements.poDate.value = today(); $('poForm').elements.status.value = 'Received'; $('poForm').elements.reviewStatus.value = 'Approved'; } $('poDialog').showModal(); }
function toast(message) { const element = $('toast'); element.textContent = message; element.classList.add('show'); clearTimeout(toast.timer); toast.timer = setTimeout(() => element.classList.remove('show'), 2600); }
function formatImportDate(value) { if (!value) return ''; if (value instanceof Date) return value.toISOString().slice(0, 10); const converted = new Date(value); return Number.isNaN(converted) ? '' : converted.toISOString().slice(0, 10); }
function mapped(row, keys) { for (const key of keys) if (row[key] !== undefined && row[key] !== null) return row[key]; return ''; }
function importRows(rows) { const additions = rows.map(row => ({id: crypto.randomUUID(), customerName: mapped(row, ['Customer Name', 'Customer', 'customerName']), poNumber: mapped(row, ['PO Number', 'PO No', 'poNumber']), deliveryLocation: normalizeDeliveryLocation(mapped(row, ['Delivery Location', 'deliveryLocation'])), poDate: formatImportDate(mapped(row, ['PO Date', 'poDate'])), poReceivedDate: formatImportDate(mapped(row, ['PO Received Date', 'Received Date', 'poReceivedDate'])) || today(), deliveryDate: formatImportDate(mapped(row, ['Appointment Date', 'Delivery Date', 'deliveryDate'])), deliveryCompletedDate: formatImportDate(mapped(row, ['Delivery Completed Date', 'deliveryCompletedDate'])), status: mapped(row, ['Delivery Status', 'Status', 'status']) || 'Received', poValue: mapped(row, ['PO Value (₹)', 'PO Value', 'poValue']) || 0, invoiceNumber: mapped(row, ['Invoice Number', 'invoiceNumber']), invoiceDate: formatImportDate(mapped(row, ['Invoice Date', 'invoiceDate'])), transporter: mapped(row, ['Transporter', 'transporter']), transportAmount: mapped(row, ['Transport Amount (₹)', 'Transport Amount', 'transportAmount']) || 0, trackingNumber: mapped(row, ['LR / Tracking No', 'LR/Tracking No', 'Tracking Number', 'trackingNumber']), assignedTo: mapped(row, ['Assigned To', 'assignedTo']), remarks: mapped(row, ['Remarks', 'remarks']), deliveryNoteUrl: mapped(row, ['Delivery Note URL', 'deliveryNoteUrl'])})).filter(record => record.customerName && record.poNumber); records.push(...additions); return additions.length; }
function exportExcel() { const exportRows = filtered().map(record => ({'Customer Name': record.customerName, 'PO Number': record.poNumber, 'PO Date': record.poDate, 'PO Received Date': record.poReceivedDate, 'Appointment Date': record.deliveryDate, 'Delivery Completed Date': record.deliveryCompletedDate, 'Delivery Status': record.status, 'Delivery Note URL': record.deliveryNoteUrl || '', 'PO Value (₹)': Number(record.poValue || 0), 'Delivery Location': record.deliveryLocation, 'Invoice Number': record.invoiceNumber, 'Invoice Date': record.invoiceDate, 'Invoice Copy URL': record.invoiceAttachmentUrl || '', Transporter: record.transporter, 'Transport Amount (₹)': Number(record.transportAmount || 0), 'LR / Tracking No': record.trackingNumber, 'Assigned To': record.assignedTo, 'PO Age (Days)': ageDays(record), 'Appointment Lead Time (Days)': delayDays(record), Remarks: record.remarks})); const sheet = XLSX.utils.json_to_sheet(exportRows); sheet['!cols'] = [20, 16, 14, 18, 18, 22, 20, 32, 14, 18, 18, 14, 32, 18, 20, 20, 18, 14, 24, 35].map(width => ({wch: width})); const book = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(book, sheet, 'PO Tracker'); XLSX.writeFile(book, `KSDL_PO_Tracker_${today()}.xlsx`); }
function initialise() {
  $('statusFilter').innerHTML = '<option value="">All statuses</option>' + STATUSES.map(status => `<option>${status}</option>`).join('');
  $('poForm').elements.status.innerHTML = STATUSES.map(status => `<option>${status}</option>`).join('');
  ['searchInput', 'statusFilter', 'customerFilter', 'dateFieldFilter', 'dateFrom', 'dateTo'].forEach(id => {
    $(id).addEventListener('input', render);
    $(id).addEventListener('change', render);
  });
  $('clearFilters').onclick = () => {
    $('searchInput').value = '';
    $('statusFilter').value = '';
    $('customerFilter').value = '';
    $('dateFieldFilter').value = 'poDate';
    $('dateFrom').value = '';
    $('dateTo').value = '';
    render();
  };
  $('newPoBtn').onclick = () => openDialog();
  $('emptyNewBtn').onclick = () => openDialog();
  $('closeDialog').onclick = () => $('poDialog').close();
  $('cancelBtn').onclick = () => $('poDialog').close();
  $('poTableBody').onclick = event => {
    const id = event.target.dataset.edit;
    if (id) openDialog(records.find(record => record.id === id));
  };
  $('poForm').addEventListener('submit', async event => {
    event.preventDefault();
    const form = new FormData(event.target);
    const id = $('recordId').value;
    const previous = records.find(record => record.id === id);
    const record = {...previous, ...Object.fromEntries(fields.map(field => [field, form.get(field)]))};
    record.deliveryLocation = normalizeDeliveryLocation(record.deliveryLocation);
    record.id = id || crypto.randomUUID();
    record.poValue = Number(record.poValue || 0);
    record.transportAmount = Number(record.transportAmount || 0);
    const note = form.get('deliveryNote');
    try {
      if (note && note.size) {
        record.deliveryNoteUrl = await uploadDeliveryNote(record.id, note);
        record.deliveryNoteLink = await signedDeliveryNoteUrl_(record.deliveryNoteUrl);
        record.status = 'Delivered';
        if (!record.deliveryCompletedDate) record.deliveryCompletedDate = today();
      }
      const index = records.findIndex(item => item.id === id);
      const isNew = index < 0;
      if (isNew) records.push(record); else records[index] = record;
      await persist(record, false, isNew);
      $('poDialog').close();
      render();
      toast(note && note.size ? 'Delivery note uploaded — PO marked Delivered' : 'PO saved');
    } catch (error) {
      toast(error.message || 'Could not save PO');
    }
  });
  $('deleteBtn').onclick = async () => {
    const id = $('recordId').value;
    const record = records.find(item => item.id === id);
    if (!record) return;
    const replacement = prompt(`PO ${record.poNumber} will be permanently removed and blocked from Gmail re-import. Enter the corrected replacement PO number, if any:`, '');
    if (replacement === null) return;
    if (!confirm(`Permanently remove PO ${record.poNumber}${replacement.trim() ? ` and mark ${replacement.trim()} as its replacement` : ''}?`)) return;
    try {
      await permanentlyRemovePo(record, replacement.trim());
      records = records.filter(item => item.id !== id);
      $('poDialog').close();
      render();
      toast('PO permanently removed and blocked from Gmail re-import');
    } catch (error) {
      toast(error.message || 'Could not permanently remove PO');
      await loadRecords();
    }
  };
  $('exportBtn').onclick = exportExcel;
  $('importBtn').onclick = () => $('importFile').click();
  $('importFile').onchange = event => {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async loaded => {
      const book = XLSX.read(loaded.target.result, {type: 'array', cellDates: true});
      const rows = XLSX.utils.sheet_to_json(book.Sheets[book.SheetNames[0]], {defval: ''});
      const start = records.length;
      const count = importRows(rows);
      const added = records.slice(start);
      try {
        await Promise.all(added.map(record => persist(record, false, true)));
        render();
        toast(`${count} PO${count === 1 ? '' : 's'} imported`);
      } catch (error) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
        render();
        toast('Imported locally; cloud import could not finish');
      }
    };
    reader.readAsArrayBuffer(file);
    event.target.value = '';
  };
  $('signOutBtn').onclick = signOut;
  if (secureLoginRequired()) {
    $('app').classList.add('hidden');
    $('loginScreen').classList.remove('hidden');
    $('loginForm').onsubmit = async event => {
      event.preventDefault();
      $('loginError').textContent = '';
      try {
        await signIn($('emailInput').value.trim(), $('passwordInput').value);
        $('signedInAs').textContent = $('emailInput').value.trim();
        $('loginScreen').classList.add('hidden');
        $('app').classList.remove('hidden');
        await loadRecords();
        refreshTimer = setInterval(loadRecords, 60000);
      } catch (error) {
        $('loginError').textContent = error.message || 'Could not sign in';
      }
    };
    return;
  }
  if (CONFIG.SIMPLE_PIN) {
    $('loginScreen').classList.remove('hidden');
    $('loginForm').onsubmit = event => {
      event.preventDefault();
      if ($('pinInput').value === CONFIG.SIMPLE_PIN) $('loginScreen').classList.add('hidden');
      else $('loginError').textContent = 'Incorrect PIN. Try again.';
    };
  }
  $('app').classList.remove('hidden');
  loadRecords();
  if (cloudEnabled()) refreshTimer = setInterval(loadRecords, 60000);
}
initialise();

function initialiseDateRangeControls_() {
  toggleCustomDates_();

  $('dateRangeFilter').addEventListener('change', () => {
    if ($('dateRangeFilter').value !== 'custom') {
      $('dateFieldFilter').value = 'poDate';
    }
    toggleCustomDates_();
    render();
  });

  $('clearFilters').addEventListener('click', () => {
    $('dateRangeFilter').value = '';
    toggleCustomDates_();
    render();
  });
}

initialiseDateRangeControls_();

/* Manual PO copy support. The file is separate from a delivery note, so it
   never changes the PO delivery status. */
const persistBeforePoCopy_ = persist;
persist = async function(record, deleting = false, isNew = false) {
  const poCopy = $('poForm').elements.poAttachment?.files?.[0];

  if (!deleting && poCopy && poCopy.size) {
    record.poAttachmentUrl = await uploadPoAttachment(record.id, poCopy);
    record.poAttachmentLink = await signedDeliveryNoteUrl_(record.poAttachmentUrl);
  }

  return persistBeforePoCopy_(record, deleting, isNew);
};

const renderBeforePoCopy_ = render;
render = function() {
  renderBeforePoCopy_();

  const showing = filtered();

  [...$('poTableBody').rows].forEach((row, index) => {
    const record = showing[index];

    if (!record?.poAttachmentLink) {
      return;
    }

    const link = document.createElement('a');
    link.className = 'note-link';
    link.href = record.poAttachmentLink;
    link.target = '_blank';
    link.rel = 'noopener';
    link.textContent = 'View PO copy';
    row.cells[0].append(link);
  });
};

/* Owner review cue for manual executive entries. Choose "Send back for
   correction" in Edit PO, write the reason, and save. */
const renderBeforeReviewCue_ = render;
render = function() {
  renderBeforeReviewCue_();
  const showing = filtered();
  [...$('poTableBody').rows].forEach((row, index) => {
    const record = showing[index];
    if (!record || record.reviewStatus === 'Approved') return;
    const cue = document.createElement('span');
    cue.className = 'secondary';
    cue.textContent = `Review: ${record.reviewStatus || 'Draft'}${record.correctionNote ? ` — ${record.correctionNote}` : ''}`;
    row.cells[0].append(cue);
  });
};

/* Keep an active secure session when the page is refreshed in the same tab. */
async function restoreSecureSession_() {
  if (!secureLoginRequired()) return;

  try {
    const saved = JSON.parse(
      sessionStorage.getItem('ksdl-po-tracker-session') || 'null'
    );

    if (!saved?.access_token || (saved.expires_at && saved.expires_at * 1000 <= Date.now() + 30000)) {
      sessionStorage.removeItem('ksdl-po-tracker-session');
      return;
    }

    authSession = saved;
    $('signedInAs').textContent = saved.user?.email || '';
    $('loginScreen').classList.add('hidden');
    $('app').classList.remove('hidden');
    await loadRecords();
    clearInterval(refreshTimer);
    refreshTimer = setInterval(loadRecords, 60000);
  } catch (error) {
    sessionStorage.removeItem('ksdl-po-tracker-session');
  }
}

restoreSecureSession_();
