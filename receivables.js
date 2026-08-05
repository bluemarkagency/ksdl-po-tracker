(() => {
  'use strict';

  const CONFIG = window.PO_TRACKER_CONFIG || {};
  const BASE_URL = String(CONFIG.SUPABASE_URL || '').replace(/\/$/, '');
  const PUBLIC_KEY = CONFIG.SUPABASE_ANON_KEY || '';
  const SESSION_KEY = 'ksdl-po-tracker-session';
  const NOTE_BUCKET = 'delivery-notes';
  const INR = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 });
  let session = null, refreshPromise = null, invoices = [], advices = [];

  const $ = id => document.getElementById(id);
  const safe = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  const money = value => INR.format(Number(value || 0));
  const todayIso = () => new Date().toISOString().slice(0, 10);
  const dateLabel = value => value ? new Date(`${String(value).slice(0, 10)}T00:00:00`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
  const normalizeDeliveryLocation = value => {
    const location = String(value || '').replace(/\s+/g, ' ').trim();
    return /^modasa(?:\b|[,\-])/i.test(location) ? 'Modasa' : location;
  };
  const statusClass = value => String(value || '').toLowerCase().replaceAll(' ', '-');
  const show = id => $(id).classList.remove('hidden');
  const hide = id => $(id).classList.add('hidden');
  if (window.pdfjsLib) window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  function saveSession(next) { session = next; sessionStorage.setItem(SESSION_KEY, JSON.stringify(session)); }
  function tokenExpiresSoon() {
    if (!session?.access_token) return false;
    let expiresAt = Number(session.expires_at || 0);
    if (!expiresAt) try { const payload = session.access_token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'); expiresAt = Number(JSON.parse(atob(payload.padEnd(Math.ceil(payload.length / 4) * 4, '='))).exp || 0); } catch (_) { return false; }
    return expiresAt * 1000 <= Date.now() + 60000;
  }
  async function refreshSession() {
    if (refreshPromise) return refreshPromise;
    if (!session?.refresh_token) throw new Error('Your session has expired. Please sign in again.');
    refreshPromise = (async () => {
      const response = await fetch(`${BASE_URL}/auth/v1/token?grant_type=refresh_token`, { method: 'POST', headers: { apikey: PUBLIC_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ refresh_token: session.refresh_token }) });
      const data = await response.json(); if (!response.ok || !data?.access_token) throw new Error(data?.message || data?.error_description || 'Please sign in again.');
      saveSession({ ...session, ...data }); return session;
    })();
    try { return await refreshPromise; } finally { refreshPromise = null; }
  }
  async function api(path, options = {}, retry = true) {
    const tokenRequest = path.startsWith('/auth/v1/token');
    if (!tokenRequest && session?.refresh_token && tokenExpiresSoon()) await refreshSession();
    const auth = tokenRequest ? PUBLIC_KEY : (session?.access_token || PUBLIC_KEY);
    const response = await fetch(`${BASE_URL}${path}`, { ...options, headers: { apikey: PUBLIC_KEY, Authorization: `Bearer ${auth}`, ...(options.headers || {}) } });
    const text = await response.text(); let data = null; if (text) try { data = JSON.parse(text); } catch (_) { data = text; }
    const message = data?.message || data?.error_description || text || `Request failed (${response.status})`;
    if (!response.ok && retry && !tokenRequest && session?.refresh_token && (response.status === 401 || /exp(?:ired)?|jwt|timestamp/i.test(String(message)))) { await refreshSession(); return api(path, options, false); }
    if (!response.ok) throw new Error(message); return data;
  }
  function toast(message) { const el = $('toast'); el.textContent = message; el.classList.add('show'); clearTimeout(toast.timer); toast.timer = setTimeout(() => el.classList.remove('show'), 3500); }
  async function signIn(email, password) { saveSession(await api('/auth/v1/token?grant_type=password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) })); }
  async function signOut() { try { await api('/auth/v1/logout', { method: 'POST' }); } catch (_) {} session = null; sessionStorage.removeItem(SESSION_KEY); hide('app'); show('loginScreen'); }
  async function ensureAccess() {
    const role = await api('/rest/v1/rpc/po_tracker_role', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    if (!['owner', 'accountant'].includes(role)) throw new Error('Only the owner or accountant can access Customer Receivables.');
  }
  function storagePath(value) {
    const text = String(value || '');
    for (const marker of [`/storage/v1/object/public/${NOTE_BUCKET}/`, `/storage/v1/object/sign/${NOTE_BUCKET}/`, `/storage/v1/object/${NOTE_BUCKET}/`]) {
      if (text.includes(marker)) return decodeURIComponent(text.split(marker)[1].split('?')[0]);
    }
    return text.replace(/^\/+/, '');
  }
  async function signedInvoiceUrl(value) {
    const original = String(value || '').trim();
    if (/^https:\/\//i.test(original) && !original.includes('/storage/v1/object/')) return original;
    const path = storagePath(original); if (!path) throw new Error('Invoice copy path is missing.');
    const data = await api(`/storage/v1/object/sign/${NOTE_BUCKET}/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expiresIn: 600 }) });
    if (!data?.signedURL) throw new Error('Could not open the private invoice copy.');
    return `${BASE_URL}/storage/v1${data.signedURL}`;
  }
  async function readPdfLines(blob) {
    if (!window.pdfjsLib) throw new Error('PDF reader did not load. Check the internet connection and try again.');
    const pdf = await window.pdfjsLib.getDocument({ data: await blob.arrayBuffer() }).promise;
    const pages = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber), content = await page.getTextContent();
      const positioned = content.items.filter(item => String(item.str || '').trim()).map(item => ({ text: String(item.str).trim(), x: item.transform?.[4] || 0, y: item.transform?.[5] || 0 }));
      const rows = [];
      positioned.sort((a, b) => Math.abs(b.y - a.y) > 2 ? b.y - a.y : a.x - b.x).forEach(item => {
        let row = rows.find(candidate => Math.abs(candidate.y - item.y) <= 2);
        if (!row) { row = { y: item.y, items: [] }; rows.push(row); }
        row.items.push(item);
      });
      pages.push(rows.sort((a, b) => b.y - a.y).map(row => row.items.sort((a, b) => a.x - b.x).map(item => item.text).join(' ').replace(/\s+/g, ' ').trim()));
    }
    return pages.flat();
  }
  function invoiceDateToIso(value) {
    const match = String(value || '').match(/(\d{1,2})[-\s/]([A-Za-z]{3,9})[-\s/](\d{2,4})/);
    if (!match) return '';
    const months = { jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12 };
    const month = months[match[2].toLowerCase()]; if (!month) return '';
    const year = match[3].length === 2 ? 2000 + Number(match[3]) : Number(match[3]);
    return `${year}-${String(month).padStart(2, '0')}-${String(Number(match[1])).padStart(2, '0')}`;
  }
  function parseAttachedInvoice(lines) {
    const flat = lines.join(' ').replace(/\s+/g, ' ');
    const invoiceNumber = flat.match(/\b(BMAG\/\d{2}-\d{2}\/\d{3,8})\b/i)?.[1] || '';
    const invoiceIndex = lines.findIndex(line => invoiceNumber && line.includes(invoiceNumber));
    const invoiceDateText = invoiceIndex >= 0 ? lines.slice(invoiceIndex, invoiceIndex + 6).join(' ').match(/\b(\d{1,2}[-\s/][A-Za-z]{3,9}[-\s/]\d{2,4})\b/)?.[1] || '' : '';
    const totalIndex = lines.findIndex(line => /^\s*Total\b/i.test(line) && /\b(?:PCS|CBS|NOS|EA|BOX|CTN)\b/i.test(line));
    const totalBlock = totalIndex >= 0 ? lines.slice(totalIndex, totalIndex + 3).join(' ') : '';
    const totalLine = lines.find(line => /\bTotal\b/i.test(line) && /(?:₹|Rs\.?)/i.test(line) && /\d[\d,]*\.\d{2}/.test(line)) || '';
    const totalAmount = totalBlock.match(/(?:₹|Rs\.?)\s*([\d,]+\.\d{2})/i)?.[1]
      || totalLine.match(/(?:₹|Rs\.?)\s*([\d,]+\.\d{2})(?!.*\d[\d,]*\.\d{2})/i)?.[1]
      || flat.match(/\bTotal\s+\d+(?:\.\d+)?\s+[A-Z]{2,8}\s+\d+(?:\.\d+)?\s+[A-Z]{2,8}\s+(?:₹|Rs\.?)?\s*([\d,]+\.\d{2})/i)?.[1]
      || flat.match(/Total\s+Inv\s+Amt\s*:\s*([\d,]+\.\d{2})/i)?.[1]
      || '';
    return { invoiceNumber, invoiceDate: invoiceDateToIso(invoiceDateText), invoiceAmount: totalAmount ? Number(totalAmount.replace(/,/g, '')) : null };
  }
  function dayDifference(date) {
    if (!date) return null;
    const due = new Date(`${date}T00:00:00`), now = new Date(`${todayIso()}T00:00:00`);
    return Math.floor((now - due) / 86400000);
  }
  function ageBucket(invoice) {
    if (invoice.payment_status === 'Paid') return 'paid';
    const days = dayDifference(invoice.due_date); if (days == null) return 'missing';
    if (days < 0) return 'not-due'; if (days <= 7) return '0-7'; if (days <= 15) return '8-15'; if (days <= 30) return '16-30'; if (days <= 45) return '31-45'; return '46+';
  }
  function outstanding(invoice) { return Number(invoice.outstanding_amount ?? invoice.invoice_amount ?? 0); }
  function localIsoDate(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }
  function invoiceMonthBounds(offset) {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth() + offset, 1);
    const end = offset === 0 ? now : new Date(now.getFullYear(), now.getMonth() + offset + 1, 0);
    return { from: localIsoDate(start), to: localIsoDate(end) };
  }
  function selectedInvoiceDateBounds() {
    const range = $('invoiceDateRange').value;
    if (range === 'current') return invoiceMonthBounds(0);
    if (range === 'last') return invoiceMonthBounds(-1);
    if (range === 'custom') return { from: $('invoiceDateFrom').value, to: $('invoiceDateTo').value };
    return { from: '', to: '' };
  }
  function dateFilteredInvoices() {
    const { from, to } = selectedInvoiceDateBounds();
    return invoices.filter(invoice => {
      const invoiceDate = String(invoice.invoice_date || '').slice(0, 10);
      return (!from || (invoiceDate && invoiceDate >= from)) && (!to || (invoiceDate && invoiceDate <= to));
    });
  }
  function filteredInvoices() {
    const query = $('invoiceSearch').value.trim().toLowerCase(), status = $('invoiceStatus').value, age = $('ageFilter').value;
    return dateFilteredInvoices().filter(invoice => {
      const po = invoice.purchase_orders || {}, text = [invoice.invoice_number, po.po_number, invoice.delivery_location].join(' ').toLowerCase();
      return (!query || text.includes(query)) && (!status || invoice.payment_status === status) && (!age || ageBucket(invoice) === age);
    });
  }
  function renderSummary() {
    const scopedInvoices = dateFilteredInvoices();
    const open = scopedInvoices.filter(item => item.payment_status !== 'Paid'), overdue = open.filter(item => (dayDifference(item.due_date) ?? -1) >= 0);
    const dueSoon = open.filter(item => { const days = dayDifference(item.due_date); return days != null && days >= -6 && days < 0; });
    const month = todayIso().slice(0, 7), confirmed = advices.filter(item => item.status === 'Bank Confirmed' && String(item.payment_date || '').startsWith(month));
    const invoiceDateFilterActive = Boolean($('invoiceDateRange').value);
    const missing = scopedInvoices.filter(item => item.payment_status === 'Needs Data');
    $('outstandingAmount').textContent = money(open.reduce((sum, item) => sum + outstanding(item), 0)); $('outstandingCount').textContent = `${open.length} invoices`;
    $('overdueAmount').textContent = money(overdue.reduce((sum, item) => sum + outstanding(item), 0)); $('overdueCount').textContent = `${overdue.length} invoices`;
    $('dueSoonAmount').textContent = money(dueSoon.reduce((sum, item) => sum + outstanding(item), 0)); $('dueSoonCount').textContent = `${dueSoon.length} invoices`;
    $('receivedAmount').textContent = money(invoiceDateFilterActive
      ? scopedInvoices.reduce((sum, item) => sum + Number(item.net_received_amount || 0), 0)
      : confirmed.reduce((sum, item) => sum + Number(item.total_net_amount || 0), 0));
    $('receivedLabel').textContent = invoiceDateFilterActive ? 'Received for filtered invoices' : 'Received this month';
    $('receivedHelp').textContent = invoiceDateFilterActive ? 'Matched to invoices in the selected date range' : 'From matched payment advice';
    $('missingCount').textContent = missing.length;
  }
  function renderAging() {
    const scopedInvoices = dateFilteredInvoices();
    const definitions = [['not-due', 'Not due'], ['0-7', '0–7 days'], ['8-15', '8–15 days'], ['16-30', '16–30 days'], ['31-45', '31–45 days'], ['46+', '46+ days']];
    $('agingGrid').innerHTML = definitions.map(([key, label]) => {
      const rows = scopedInvoices.filter(item => item.payment_status !== 'Paid' && ageBucket(item) === key);
      return `<article class="aging-bucket ${key === 'not-due' ? '' : 'overdue'}"><span>${label}</span><strong>${money(rows.reduce((sum, item) => sum + outstanding(item), 0))}</strong><small>${rows.length} invoice(s)</small></article>`;
    }).join('');
  }
  function renderInvoices() {
    const rows = filteredInvoices();
    $('invoiceBody').innerHTML = rows.map(invoice => {
      const po = invoice.purchase_orders || {}, days = dayDifference(invoice.due_date), paid = invoice.payment_status === 'Paid';
      const difference = invoice.invoice_amount == null ? null : Number(invoice.invoice_amount) - Number(invoice.settled_gross_amount || 0);
      const acceptedRoundOff = paid && difference != null && Math.abs(difference) > 0 && Math.abs(difference) <= 5;
      const age = paid ? 'Settled' : days == null ? 'Needs data' : days < 0 ? `${Math.abs(days)} day(s) left` : `${days} day(s) overdue`;
      return `<tr>
        <td><strong>${safe(invoice.invoice_number)}</strong><span class="subline">PO ${safe(po.po_number || 'Not linked')}</span>${invoice.invoice_attachment_url ? '<span class="subline">Invoice copy in tracker</span>' : ''}</td>
        <td>${dateLabel(invoice.invoice_date)}</td>
        <td>${dateLabel(invoice.delivery_completed_date || po.delivery_completed_date)}<span class="subline">${invoice.delivery_completed_date || po.delivery_completed_date ? 'Payment clock started' : 'Waiting for delivery'}</span></td>
        <td>${dateLabel(invoice.due_date)}<span class="subline">${invoice.credit_days} credit days</span></td>
        <td>${safe(invoice.delivery_location || po.delivery_location || '—')}</td><td>${invoice.invoice_amount == null ? '—' : money(invoice.invoice_amount)}</td>
        <td>${money(invoice.net_received_amount)}<span class="subline">TDS ${money(invoice.tds_amount)}</span></td>
        <td class="${paid ? 'money-positive' : 'money-negative'}">${money(outstanding(invoice))}${acceptedRoundOff ? `<span class="subline">₹${Math.abs(difference).toFixed(2)} round-off accepted</span>` : ''}</td>
        <td><span class="age-chip ${days != null && days >= 0 && !paid ? 'overdue' : ''}">${safe(age)}</span></td>
        <td><span class="receivable-status ${statusClass(invoice.payment_status)}">${safe(invoice.payment_status)}</span></td>
        <td><button class="text-btn edit-invoice" data-id="${invoice.id}" type="button">Edit</button></td>
      </tr>`;
    }).join('');
    $('invoiceEmpty').classList.toggle('hidden', rows.length > 0);
  }
  function render() { renderSummary(); renderAging(); renderInvoices(); }
  function toggleInvoiceCustomDates() {
    $('invoiceCustomDates').classList.toggle('hidden', $('invoiceDateRange').value !== 'custom');
  }

  async function syncMissingInvoiceData() {
    const candidates = invoices.filter(invoice =>
      invoice.payment_status === 'Needs Data'
      && invoice.invoice_attachment_url
      && (!invoice.invoice_date || invoice.invoice_amount == null)
    );
    let updated = 0;
    for (const invoice of candidates) {
      try {
        const response = await fetch(await signedInvoiceUrl(invoice.invoice_attachment_url));
        if (!response.ok) continue;
        const parsed = parseAttachedInvoice(await readPdfLines(await response.blob()));
        const expected = String(invoice.invoice_number || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
        const actual = String(parsed.invoiceNumber || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
        if (!actual || actual !== expected || !parsed.invoiceAmount || parsed.invoiceAmount <= 0) continue;
        await api('/rest/v1/rpc/update_customer_invoice', {
          method: 'POST', headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
          body: JSON.stringify({ invoice: invoice.id, new_invoice_date: parsed.invoiceDate || invoice.invoice_date || null, new_invoice_amount: parsed.invoiceAmount, new_credit_days: 6 })
        });
        updated += 1;
      } catch (_) { /* Leave genuinely unreadable historical records in Needs Data. */ }
    }
    return updated;
  }
  async function loadData(runBackgroundSync = true) {
    $('connectionStatus').textContent = 'Loading receivables…';
    const [invoiceRows, adviceRows] = await Promise.all([
      api('/rest/v1/customer_invoices?select=*,purchase_orders(id,po_number,delivery_location,delivery_date,delivery_completed_date,status)&order=invoice_date.desc.nullslast,created_at.desc'),
      api('/rest/v1/customer_payment_advices?select=id,status,payment_date,total_net_amount&order=payment_date.desc.nullslast,imported_at.desc')
    ]);
    invoices = (Array.isArray(invoiceRows) ? invoiceRows : []).map(invoice => ({
      ...invoice,
      delivery_location: normalizeDeliveryLocation(invoice.delivery_location),
      purchase_orders: invoice.purchase_orders ? {
        ...invoice.purchase_orders,
        delivery_location: normalizeDeliveryLocation(invoice.purchase_orders.delivery_location)
      } : invoice.purchase_orders
    }));
    advices = Array.isArray(adviceRows) ? adviceRows : [];
    $('connectionStatus').textContent = 'Cloud synced'; render();
    if (runBackgroundSync && await syncMissingInvoiceData()) {
      await loadData(false);
      toast('Stored invoice data was updated automatically.');
    }
  }

  function previewDueDate() {
    const completedDate = $('editDeliveryCompletedDate').value || '';
    const days = Number($('editCreditDays').value || 6);
    if (!completedDate) {
      $('editDueDate').textContent = 'Waiting for delivery completion';
      return;
    }
    const [year, month, day] = completedDate.split('-').map(Number);
    const due = new Date(Date.UTC(year, month - 1, day + Math.max(days, 0)));
    $('editDueDate').textContent = dateLabel(due.toISOString().slice(0, 10));
  }
  function openInvoice(id) {
    const invoice = invoices.find(item => item.id === id); if (!invoice) return;
    $('invoiceForm').reset(); $('invoiceId').value = id; $('invoiceDialogTitle').textContent = invoice.invoice_number; $('invoiceDialogSummary').textContent = `${invoice.purchase_orders?.po_number ? `PO ${invoice.purchase_orders.po_number} · ` : ''}${invoice.delivery_location || 'Location pending'}`;
    $('editInvoiceDate').value = invoice.invoice_date || ''; $('editInvoiceAmount').value = invoice.invoice_amount ?? ''; $('editDeliveryDate').value = invoice.purchase_orders?.delivery_date || ''; $('editDeliveryCompletedDate').value = invoice.delivery_completed_date || invoice.purchase_orders?.delivery_completed_date || ''; $('editCreditDays').value = invoice.credit_days ?? 6; $('invoiceError').textContent = ''; previewDueDate(); $('invoiceDialog').showModal();
  }
  async function saveInvoice(event) {
    event.preventDefault(); const error = $('invoiceError'); error.textContent = ''; const amountText = $('editInvoiceAmount').value;
    try {
      await api('/rest/v1/rpc/update_customer_invoice_details', { method: 'POST', headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' }, body: JSON.stringify({ invoice: $('invoiceId').value, new_invoice_date: $('editInvoiceDate').value || null, new_invoice_amount: amountText === '' ? null : Number(amountText), new_credit_days: Number($('editCreditDays').value || 6), new_delivery_date: $('editDeliveryDate').value || null, new_delivery_completed_date: $('editDeliveryCompletedDate').value || null }) });
      $('invoiceDialog').close(); await loadData(); toast('Invoice, appointment date, delivery completed date and due date updated.');
    } catch (err) { error.textContent = err.message || 'Could not save invoice.'; }
  }
  function bindEvents() {
    $('loginForm').addEventListener('submit', async event => { event.preventDefault(); $('loginError').textContent = ''; try { await signIn($('emailInput').value.trim(), $('passwordInput').value); await start(); } catch (err) { $('loginError').textContent = err.message || 'Sign in failed.'; } });
    $('signOutBtn').addEventListener('click', signOut); $('refreshBtn').addEventListener('click', loadData);
    ['invoiceSearch', 'invoiceStatus', 'ageFilter'].forEach(id => { $(id).addEventListener('input', renderInvoices); $(id).addEventListener('change', renderInvoices); });
    $('invoiceDateRange').addEventListener('change', () => { toggleInvoiceCustomDates(); render(); });
    ['invoiceDateFrom', 'invoiceDateTo'].forEach(id => { $(id).addEventListener('input', render); $(id).addEventListener('change', render); });
    $('clearInvoiceFilters').addEventListener('click', () => { $('invoiceSearch').value = ''; $('invoiceStatus').value = ''; $('ageFilter').value = ''; $('invoiceDateRange').value = ''; $('invoiceDateFrom').value = ''; $('invoiceDateTo').value = ''; toggleInvoiceCustomDates(); render(); });
    $('invoiceBody').addEventListener('click', event => { const button = event.target.closest('.edit-invoice'); if (button) openInvoice(button.dataset.id); });
    $('invoiceForm').addEventListener('submit', saveInvoice); $('closeInvoiceDialog').addEventListener('click', () => $('invoiceDialog').close()); $('cancelInvoiceBtn').addEventListener('click', () => $('invoiceDialog').close());
    ['editDeliveryCompletedDate', 'editCreditDays'].forEach(id => $(id).addEventListener('input', previewDueDate));
  }
  async function start() { await ensureAccess(); $('signedInAs').textContent = session.user?.email || ''; hide('loginScreen'); show('app'); await loadData(); }

  try {
    bindEvents();
    try { session = JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null'); } catch (_) { session = null; }
    if (session?.access_token && session?.refresh_token) start().catch(err => { hide('app'); show('loginScreen'); $('loginError').textContent = err.message; });
    else { sessionStorage.removeItem(SESSION_KEY); show('loginScreen'); }
  } catch (err) {
    document.getElementById('app')?.classList.add('hidden');
    document.getElementById('loginScreen')?.classList.remove('hidden');
    const loginError = document.getElementById('loginError');
    if (loginError) loginError.textContent = err?.message || 'The page could not start. Please refresh after the latest files are published.';
  }
})();
