(() => {
  'use strict';

  const CONFIG = window.PO_TRACKER_CONFIG || {};
  const BASE_URL = String(CONFIG.SUPABASE_URL || '').replace(/\/$/, '');
  const PUBLIC_KEY = CONFIG.SUPABASE_ANON_KEY || '';
  const SESSION_KEY = 'ksdl-po-tracker-session';
  const ADVICE_BUCKET = 'customer-payment-advices';
  const INR = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 });
  let session = null, refreshPromise = null, invoices = [], advices = [], activeAdviceId = '';

  const $ = id => document.getElementById(id);
  const safe = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  const money = value => INR.format(Number(value || 0));
  const todayIso = () => new Date().toISOString().slice(0, 10);
  const dateLabel = value => value ? new Date(`${String(value).slice(0, 10)}T00:00:00`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
  const statusClass = value => String(value || '').toLowerCase().replaceAll(' ', '-');
  const show = id => $(id).classList.remove('hidden');
  const hide = id => $(id).classList.add('hidden');
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
  async function signedUrl(path) {
    if (!path) return '';
    const data = await api(`/storage/v1/object/sign/${ADVICE_BUCKET}/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expiresIn: 1800 }) });
    return data?.signedURL ? `${BASE_URL}/storage/v1${data.signedURL}` : '';
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
  function filteredInvoices() {
    const query = $('invoiceSearch').value.trim().toLowerCase(), status = $('invoiceStatus').value, age = $('ageFilter').value;
    return invoices.filter(invoice => {
      const po = invoice.purchase_orders || {}, text = [invoice.invoice_number, po.po_number, invoice.delivery_location].join(' ').toLowerCase();
      return (!query || text.includes(query)) && (!status || invoice.payment_status === status) && (!age || ageBucket(invoice) === age);
    });
  }
  function renderSummary() {
    const open = invoices.filter(item => item.payment_status !== 'Paid'), overdue = open.filter(item => (dayDifference(item.due_date) ?? -1) >= 0);
    const dueSoon = open.filter(item => { const days = dayDifference(item.due_date); return days != null && days >= -3 && days < 0; });
    const month = todayIso().slice(0, 7), confirmed = advices.filter(item => item.status === 'Bank Confirmed' && String(item.payment_date || '').startsWith(month));
    const reviews = advices.reduce((sum, advice) => sum + (advice.customer_payment_items || []).filter(item => item.state === 'Gujarat' && ['Unmatched', 'Amount Difference'].includes(item.match_status)).length, 0);
    const missing = invoices.filter(item => item.payment_status === 'Needs Data');
    $('outstandingAmount').textContent = money(open.reduce((sum, item) => sum + outstanding(item), 0)); $('outstandingCount').textContent = `${open.length} invoices`;
    $('overdueAmount').textContent = money(overdue.reduce((sum, item) => sum + outstanding(item), 0)); $('overdueCount').textContent = `${overdue.length} invoices`;
    $('dueSoonAmount').textContent = money(dueSoon.reduce((sum, item) => sum + outstanding(item), 0)); $('dueSoonCount').textContent = `${dueSoon.length} invoices`;
    $('receivedAmount').textContent = money(confirmed.reduce((sum, item) => sum + Number(item.total_net_amount || 0), 0));
    $('reviewCount').textContent = reviews; $('missingCount').textContent = missing.length;
  }
  function renderAging() {
    const definitions = [['not-due', 'Not due'], ['0-7', '0–7 days'], ['8-15', '8–15 days'], ['16-30', '16–30 days'], ['31-45', '31–45 days'], ['46+', '46+ days']];
    $('agingGrid').innerHTML = definitions.map(([key, label]) => {
      const rows = invoices.filter(item => item.payment_status !== 'Paid' && ageBucket(item) === key);
      return `<article class="aging-bucket ${key === 'not-due' ? '' : 'overdue'}"><span>${label}</span><strong>${money(rows.reduce((sum, item) => sum + outstanding(item), 0))}</strong><small>${rows.length} invoice(s)</small></article>`;
    }).join('');
  }
  function renderInvoices() {
    const rows = filteredInvoices();
    $('invoiceBody').innerHTML = rows.map(invoice => {
      const po = invoice.purchase_orders || {}, days = dayDifference(invoice.due_date), paid = invoice.payment_status === 'Paid';
      const age = days == null ? 'Needs data' : days < 0 ? `${Math.abs(days)} day(s) left` : `${days} day(s) overdue`;
      return `<tr>
        <td><strong>${safe(invoice.invoice_number)}</strong><span class="subline">PO ${safe(po.po_number || 'Not linked')}</span>${invoice.invoice_attachment_url ? '<span class="subline">Invoice copy in tracker</span>' : ''}</td>
        <td>${dateLabel(invoice.invoice_date)}</td><td>${dateLabel(invoice.due_date)}<span class="subline">${invoice.credit_days} credit days</span></td>
        <td>${safe(invoice.delivery_location || po.delivery_location || '—')}</td><td>${invoice.invoice_amount == null ? '—' : money(invoice.invoice_amount)}</td>
        <td>${money(invoice.net_received_amount)}<span class="subline">TDS ${money(invoice.tds_amount)}</span></td>
        <td class="${paid ? 'money-positive' : 'money-negative'}">${money(outstanding(invoice))}</td>
        <td><span class="age-chip ${days != null && days >= 0 && !paid ? 'overdue' : ''}">${safe(age)}</span></td>
        <td><span class="receivable-status ${statusClass(invoice.payment_status)}">${safe(invoice.payment_status)}</span></td>
        <td><button class="text-btn edit-invoice" data-id="${invoice.id}" type="button">Edit</button></td>
      </tr>`;
    }).join('');
    $('invoiceEmpty').classList.toggle('hidden', rows.length > 0);
  }
  function renderAdvices() {
    $('adviceBody').innerHTML = advices.map(advice => {
      const items = (advice.customer_payment_items || []).filter(item => item.state === 'Gujarat');
      const unmatched = items.filter(item => ['Unmatched', 'Amount Difference'].includes(item.match_status)).length;
      return `<tr><td><strong>${safe(advice.utr_number || 'UTR pending')}</strong><span class="subline">${safe(advice.vendor_code || '')}</span></td>
        <td>${dateLabel(advice.payment_date)}</td><td>${money(advice.total_net_amount)}</td><td>${money(advice.total_tds_amount)}</td>
        <td>${items.length}<span class="subline">${unmatched ? `${unmatched} needs review` : 'All matched'}</span></td>
        <td><span class="receivable-status ${statusClass(advice.status)}">${safe(advice.status)}</span></td>
        <td><span class="subline">${safe(advice.sender)}</span></td>
        <td><button class="text-btn review-advice" data-id="${advice.id}" type="button">Review</button></td></tr>`;
    }).join('');
    $('adviceEmpty').classList.toggle('hidden', advices.length > 0);
  }
  function render() { renderSummary(); renderAging(); renderInvoices(); renderAdvices(); }

  async function loadData() {
    $('connectionStatus').textContent = 'Loading receivables…';
    const [invoiceRows, adviceRows] = await Promise.all([
      api('/rest/v1/customer_invoices?select=*,purchase_orders(id,po_number,delivery_location,status)&order=invoice_date.desc.nullslast,created_at.desc'),
      api('/rest/v1/customer_payment_advices?select=*,customer_payment_items(*)&order=payment_date.desc.nullslast,imported_at.desc')
    ]);
    invoices = Array.isArray(invoiceRows) ? invoiceRows : []; advices = Array.isArray(adviceRows) ? adviceRows : [];
    $('connectionStatus').textContent = 'Cloud synced'; render();
  }

  function previewDueDate() {
    const date = $('editInvoiceDate').value, days = Number($('editCreditDays').value || 3);
    if (!date) { $('editDueDate').textContent = '—'; return; }
    const due = new Date(`${date}T00:00:00`); due.setDate(due.getDate() + Math.max(days, 0)); $('editDueDate').textContent = dateLabel(due.toISOString().slice(0, 10));
  }
  function openInvoice(id) {
    const invoice = invoices.find(item => item.id === id); if (!invoice) return;
    $('invoiceForm').reset(); $('invoiceId').value = id; $('invoiceDialogTitle').textContent = invoice.invoice_number; $('invoiceDialogSummary').textContent = `${invoice.purchase_orders?.po_number ? `PO ${invoice.purchase_orders.po_number} · ` : ''}${invoice.delivery_location || 'Location pending'}`;
    $('editInvoiceDate').value = invoice.invoice_date || ''; $('editInvoiceAmount').value = invoice.invoice_amount ?? ''; $('editCreditDays').value = invoice.credit_days ?? 3; $('invoiceError').textContent = ''; previewDueDate(); $('invoiceDialog').showModal();
  }
  async function saveInvoice(event) {
    event.preventDefault(); const error = $('invoiceError'); error.textContent = ''; const amountText = $('editInvoiceAmount').value;
    try {
      await api('/rest/v1/rpc/update_customer_invoice', { method: 'POST', headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' }, body: JSON.stringify({ invoice: $('invoiceId').value, new_invoice_date: $('editInvoiceDate').value || null, new_invoice_amount: amountText === '' ? null : Number(amountText), new_credit_days: Number($('editCreditDays').value || 3) }) });
      $('invoiceDialog').close(); await loadData(); toast('Invoice and due date updated in the synced register.');
    } catch (err) { error.textContent = err.message || 'Could not save invoice.'; }
  }

  async function openAdvice(id) {
    const advice = advices.find(item => item.id === id); if (!advice) return; activeAdviceId = id;
    $('adviceDialogTitle').textContent = advice.utr_number || 'Payment advice'; $('adviceDialogSummary').textContent = `${dateLabel(advice.payment_date)} · ${money(advice.total_net_amount)} net received`;
    const items = (advice.customer_payment_items || []).filter(item => item.state === 'Gujarat'), canEdit = advice.status !== 'Bank Confirmed';
    $('adviceItemBody').innerHTML = items.map(item => {
      const current = invoices.find(invoice => invoice.id === item.customer_invoice_id);
      const options = invoices.filter(invoice => invoice.payment_status !== 'Paid' || invoice.id === item.customer_invoice_id).map(invoice => `<option value="${invoice.id}" ${invoice.id === item.customer_invoice_id ? 'selected' : ''}>${safe(invoice.invoice_number)} · ${money(invoice.invoice_amount || 0)}</option>`).join('');
      return `<tr><td><strong>${safe(item.raw_invoice_number)}</strong><span class="subline">${dateLabel(item.invoice_date)}</span></td><td>${safe(item.site_name || '—')}</td><td>${money(item.gross_amount)}</td><td>${money(item.net_amount)}</td><td>${money(item.tds_amount)}</td><td><span class="receivable-status ${statusClass(item.match_status)}">${safe(item.match_status)}</span></td><td>${canEdit ? `<select class="match-select" data-item-id="${item.id}"><option value="">Choose invoice…</option>${options}</select><button class="text-btn link-item" data-item-id="${item.id}" type="button">Link</button>` : safe(current?.invoice_number || 'Confirmed')}</td></tr>`;
    }).join('');
    const hasProblems = items.some(item => !item.customer_invoice_id || ['Unmatched', 'Amount Difference'].includes(item.match_status));
    $('adviceReviewWarning').textContent = hasProblems ? 'Link every unmatched row and correct amount differences before confirming the bank credit.' : 'All Gujarat invoice rows are matched. Confirm only after the amount appears in your bank account.';
    $('adviceReviewWarning').classList.toggle('hidden', !items.length); $('adviceError').textContent = ''; $('confirmAdviceBtn').disabled = advice.status === 'Bank Confirmed' || hasProblems || !items.length; $('confirmAdviceBtn').textContent = advice.status === 'Bank Confirmed' ? 'Bank credit confirmed' : 'Confirm bank credit';
    const link = $('adviceAttachmentLink'); link.classList.add('hidden'); link.removeAttribute('href');
    if (advice.attachment_path) { const url = await signedUrl(advice.attachment_path).catch(() => ''); if (url) { link.href = url; link.classList.remove('hidden'); } }
    $('adviceDialog').showModal();
  }
  async function linkAdviceItem(itemId, button) {
    const select = button.parentElement.querySelector('.match-select'), invoice = select?.value; if (!invoice) { toast('Choose the correct Gujarat invoice first.'); return; }
    try { button.disabled = true; await api('/rest/v1/rpc/link_customer_payment_item', { method: 'POST', headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' }, body: JSON.stringify({ payment_item: itemId, invoice }) }); await loadData(); $('adviceDialog').close(); await openAdvice(activeAdviceId); toast('Advice row linked to the invoice.'); } catch (err) { $('adviceError').textContent = err.message || 'Could not link invoice.'; } finally { button.disabled = false; }
  }
  async function confirmAdvice() {
    if (!confirm('Confirm that this net amount has actually reached the bank account?')) return;
    try { $('confirmAdviceBtn').disabled = true; await api('/rest/v1/rpc/confirm_customer_payment_advice', { method: 'POST', headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' }, body: JSON.stringify({ advice: activeAdviceId }) }); $('adviceDialog').close(); await loadData(); toast('Bank credit confirmed and linked invoices settled.'); } catch (err) { $('adviceError').textContent = err.message || 'Could not confirm bank credit.'; } finally { $('confirmAdviceBtn').disabled = false; }
  }

  function bindEvents() {
    $('loginForm').addEventListener('submit', async event => { event.preventDefault(); $('loginError').textContent = ''; try { await signIn($('emailInput').value.trim(), $('passwordInput').value); await start(); } catch (err) { $('loginError').textContent = err.message || 'Sign in failed.'; } });
    $('signOutBtn').addEventListener('click', signOut); $('refreshBtn').addEventListener('click', loadData);
    ['invoiceSearch', 'invoiceStatus', 'ageFilter'].forEach(id => { $(id).addEventListener('input', renderInvoices); $(id).addEventListener('change', renderInvoices); });
    $('clearInvoiceFilters').addEventListener('click', () => { $('invoiceSearch').value = ''; $('invoiceStatus').value = ''; $('ageFilter').value = ''; renderInvoices(); });
    $('invoiceBody').addEventListener('click', event => { const button = event.target.closest('.edit-invoice'); if (button) openInvoice(button.dataset.id); });
    $('invoiceForm').addEventListener('submit', saveInvoice); $('closeInvoiceDialog').addEventListener('click', () => $('invoiceDialog').close()); $('cancelInvoiceBtn').addEventListener('click', () => $('invoiceDialog').close());
    ['editInvoiceDate', 'editCreditDays'].forEach(id => $(id).addEventListener('input', previewDueDate));
    $('adviceBody').addEventListener('click', event => { const button = event.target.closest('.review-advice'); if (button) openAdvice(button.dataset.id); });
    $('adviceItemBody').addEventListener('click', event => { const button = event.target.closest('.link-item'); if (button) linkAdviceItem(button.dataset.itemId, button); });
    $('closeAdviceDialog').addEventListener('click', () => $('adviceDialog').close()); $('confirmAdviceBtn').addEventListener('click', confirmAdvice);
  }
  async function start() { await ensureAccess(); $('signedInAs').textContent = session.user?.email || ''; hide('loginScreen'); show('app'); await loadData(); }

  bindEvents(); try { session = JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null'); } catch (_) { session = null; }
  if (session?.access_token && session?.refresh_token) start().catch(err => { hide('app'); show('loginScreen'); $('loginError').textContent = err.message; }); else { sessionStorage.removeItem(SESSION_KEY); show('loginScreen'); }
})();
