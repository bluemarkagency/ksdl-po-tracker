(() => {
  'use strict';

  const CONFIG = window.PO_TRACKER_CONFIG || {};
  const BASE_URL = String(CONFIG.SUPABASE_URL || '').replace(/\/$/, '');
  const PUBLIC_KEY = CONFIG.SUPABASE_ANON_KEY || '';
  const SESSION_KEY = 'ksdl-po-tracker-session';
  const INR = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
  const NUMBER = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
  const CBS_NUMBER = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 });
  let session = null;
  let refreshPromise = null;
  let rows = [];
  let locationAliases = [];
  let poLocationRows = [];
  let invoiceLocationRows = [];
  let locationMasterReady = true;
  let locationMasterError = '';
  let locationReviewRows = [];
  let trackerRole = '';
  let activeOpportunityView = 'location-actions';

  const $ = id => document.getElementById(id);
  const safe = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  const money = value => INR.format(Number(value || 0));
  const number = value => NUMBER.format(Number(value || 0));
  const show = id => $(id).classList.remove('hidden');
  const hide = id => $(id).classList.add('hidden');
  const sum = (items, selector) => items.reduce((total, item) => total + Number(selector(item) || 0), 0);
  const unique = values => [...new Set(values.filter(Boolean))];

  function toast(message) {
    const element = $('toast');
    element.textContent = message;
    element.classList.add('show');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => element.classList.remove('show'), 3500);
  }
  function saveSession(next) {
    session = next;
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
  }
  function tokenExpiresSoon() {
    if (!session?.access_token) return false;
    let expiresAt = Number(session.expires_at || 0);
    if (!expiresAt) {
      try {
        const token = session.access_token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
        expiresAt = Number(JSON.parse(atob(token.padEnd(Math.ceil(token.length / 4) * 4, '='))).exp || 0);
      } catch (_) { return false; }
    }
    return expiresAt * 1000 <= Date.now() + 60000;
  }
  async function refreshSession() {
    if (refreshPromise) return refreshPromise;
    if (!session?.refresh_token) throw new Error('Your session has expired. Please sign in again.');
    refreshPromise = (async () => {
      const response = await fetch(`${BASE_URL}/auth/v1/token?grant_type=refresh_token`, {
        method: 'POST',
        headers: { apikey: PUBLIC_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: session.refresh_token })
      });
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
    const response = await fetch(`${BASE_URL}${path}`, {
      ...options,
      headers: { apikey: PUBLIC_KEY, Authorization: `Bearer ${auth}`, ...(options.headers || {}) }
    });
    const text = await response.text();
    let data = null;
    if (text) try { data = JSON.parse(text); } catch (_) { data = text; }
    const message = data?.message || data?.error_description || text || `Request failed (${response.status})`;
    if (!response.ok && retry && !tokenRequest && session?.refresh_token && (response.status === 401 || /exp(?:ired)?|jwt|timestamp/i.test(String(message)))) {
      await refreshSession();
      return api(path, options, false);
    }
    if (!response.ok) throw new Error(message);
    return data;
  }
  async function signIn(email, password) {
    saveSession(await api('/auth/v1/token?grant_type=password', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password })
    }));
  }
  async function signOut() {
    try { await api('/auth/v1/logout', { method: 'POST' }); } catch (_) { /* local sign-out still succeeds */ }
    session = null;
    sessionStorage.removeItem(SESSION_KEY);
    hide('app');
    show('loginScreen');
  }
  async function ensureAccess() {
    trackerRole = await api('/rest/v1/rpc/po_tracker_role', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    if (!['owner', 'accountant', 'brand_manager'].includes(trackerRole)) throw new Error('Only the owner, accountant or brand manager can access product analytics.');
    document.querySelectorAll('.operational-nav').forEach(link => link.classList.toggle('hidden', trackerRole === 'brand_manager'));
  }

  function localIsoDate(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }
  function monthBounds(offset) {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth() + offset, 1);
    const end = offset === 0 ? now : new Date(now.getFullYear(), now.getMonth() + offset + 1, 0);
    return { from: localIsoDate(start), to: localIsoDate(end) };
  }
  function selectedDateBounds() {
    const range = $('analyticsDateRange').value;
    if (range === 'current') return monthBounds(0);
    if (range === 'last') return monthBounds(-1);
    if (range === 'custom') return { from: $('analyticsDateFrom').value, to: $('analyticsDateTo').value };
    return { from: '', to: '' };
  }
  function locationName(value) {
    const location = String(value || 'Location pending').replace(/\s+/g, ' ').trim();
    return /^modasa(?:\b|[,\-])/i.test(location) ? 'Modasa' : location;
  }
  function locationKey(value) {
    return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  }
  function titleCaseLocation(value) {
    return String(value || '').replace(/\s+/g, ' ').trim().split(' ').map(word => {
      if (/^(rto|ft)$/i.test(word)) return word.toUpperCase();
      return word ? word[0].toUpperCase() + word.slice(1).toLowerCase() : '';
    }).join(' ');
  }
  function suggestedOfficialLocation(value, officialNames) {
    const cleaned = String(value || '').replace(/\s+/g, ' ').trim();
    const withoutSuffix = cleaned.replace(/\s+(?:Ahmedabad|Gujarat)$/i, '').trim();
    const direct = officialNames.find(name => locationKey(name) === locationKey(withoutSuffix));
    return direct || titleCaseLocation(withoutSuffix || cleaned);
  }
  function observedLocationGroups() {
    const groups = new Map();
    const ensure = value => {
      const name = locationName(value);
      if (!name || name === 'Location pending') return null;
      const key = locationKey(name);
      if (!groups.has(key)) groups.set(key, { key, name, poCount: 0, invoiceCount: 0, analyticsInvoices: new Set() });
      return groups.get(key);
    };
    poLocationRows.forEach(row => {
      const group = ensure(row.delivery_location);
      if (group) group.poCount += 1;
    });
    invoiceLocationRows.forEach(row => {
      const group = ensure(row.delivery_location);
      if (group) group.invoiceCount += 1;
    });
    rows.forEach(row => {
      const group = ensure(row.delivery_location);
      if (group) group.analyticsInvoices.add(row.invoice_number_normalized || row.invoice_number || row.id);
    });
    return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name));
  }
  function renderLocationMaster() {
    const notice = $('locationMasterNotice');
    const observed = observedLocationGroups();
    const aliasKeys = new Set(locationAliases.map(alias => alias.alias_key || locationKey(alias.alias_name)));
    const officialNames = unique(locationAliases.map(alias => alias.canonical_name)).sort((a, b) => a.localeCompare(b));
    locationReviewRows = observed.filter(group => !aliasKeys.has(group.key));

    $('officialLocationOptions').innerHTML = officialNames.map(name => `<option value="${safe(name)}"></option>`).join('');
    $('locationMasterCount').textContent = locationMasterReady
      ? `${officialNames.length} official · ${locationReviewRows.length} to review`
      : 'Setup required';

    if (!locationMasterReady) {
      notice.className = 'location-master-notice attention';
      notice.textContent = `Location Master is not available yet. Run the supplied Location Master SQL once in Supabase. ${locationMasterError}`.trim();
    } else if (locationReviewRows.length) {
      notice.className = 'location-master-notice attention';
      notice.textContent = `${locationReviewRows.length} unrecognised location name(s) need review. Choose an existing official location or type a new official name.`;
    } else {
      notice.className = 'location-master-notice ready';
      notice.textContent = trackerRole === 'brand_manager'
        ? 'All delivery locations in product analytics are standardised.'
        : 'All location names found in POs, invoices and product analytics are standardised.';
    }

    $('locationReviewBody').innerHTML = locationReviewRows.map((group, index) => {
      const sources = [
        group.poCount ? `${group.poCount} PO${group.poCount === 1 ? '' : 's'}` : '',
        group.invoiceCount ? `${group.invoiceCount} invoice record${group.invoiceCount === 1 ? '' : 's'}` : '',
        group.analyticsInvoices.size ? `${group.analyticsInvoices.size} analytics invoice${group.analyticsInvoices.size === 1 ? '' : 's'}` : ''
      ].filter(Boolean).join(' · ') || 'Observed data';
      const suggestion = suggestedOfficialLocation(group.name, officialNames);
      const ownerAction = trackerRole === 'owner'
        ? `<button class="location-standardize-btn" type="button" data-location-index="${index}">Standardise</button>`
        : '<span class="muted">Owner only</span>';
      return `<tr><td><strong>${safe(group.name)}</strong></td><td>${safe(sources)}</td><td><input class="location-official-input" id="officialLocation-${index}" list="officialLocationOptions" value="${safe(suggestion)}" aria-label="Official location for ${safe(group.name)}"></td><td>${ownerAction}</td></tr>`;
    }).join('');
    $('locationReviewEmpty').classList.toggle('hidden', !locationMasterReady || locationReviewRows.length > 0);

    const officialGroups = new Map();
    locationAliases.forEach(alias => {
      const official = alias.canonical_name || alias.alias_name;
      if (!officialGroups.has(official)) officialGroups.set(official, []);
      officialGroups.get(official).push(alias.alias_name);
    });
    $('officialLocationGroups').innerHTML = [...officialGroups.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([official, aliases]) => {
        const alternatives = unique(aliases).filter(alias => locationKey(alias) !== locationKey(official));
        return `<article class="official-location-card"><strong>${safe(official)}</strong><span>${alternatives.length ? `Also accepts: ${safe(alternatives.join(', '))}` : 'Official spelling only'}</span></article>`;
      }).join('') || '<div class="location-review-empty"><strong>No approved locations yet.</strong><span>Run the supplied Location Master SQL to create the initial master.</span></div>';
  }
  async function standardizeObservedLocation(index, button) {
    const group = locationReviewRows[index];
    const input = $(`officialLocation-${index}`);
    const official = String(input?.value || '').replace(/\s+/g, ' ').trim();
    if (!group || !official) return toast('Choose or enter the official location name.');
    button.disabled = true;
    button.textContent = 'Saving…';
    try {
      await api('/rest/v1/rpc/add_delivery_location_alias', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ alias_input: group.name, canonical_input: official })
      });
      toast(`${group.name} is now standardised as ${official}.`);
      await loadData();
    } catch (error) {
      button.disabled = false;
      button.textContent = 'Standardise';
      toast(error.message || 'Location could not be standardised.');
    }
  }
  function filteredRows() {
    const search = $('analyticsSearch').value.trim().toLowerCase();
    const location = $('analyticsLocation').value;
    const article = $('analyticsArticle').value;
    const { from, to } = selectedDateBounds();
    return rows.filter(row => {
      const date = String(row.invoice_date || '').slice(0, 10);
      const rowLocation = locationName(row.delivery_location);
      const searchable = [row.article_name, row.article_description, rowLocation, row.invoice_number, row.po_number].join(' ').toLowerCase();
      return (!location || rowLocation === location)
        && (!article || row.article_name === article)
        && (!from || (date && date >= from))
        && (!to || (date && date <= to))
        && (!search || searchable.includes(search));
    });
  }
  function nonDateFilteredRows() {
    const search = $('analyticsSearch').value.trim().toLowerCase();
    const location = $('analyticsLocation').value;
    const article = $('analyticsArticle').value;
    return rows.filter(row => {
      const rowLocation = locationName(row.delivery_location);
      const searchable = [row.article_name, row.article_description, rowLocation, row.invoice_number, row.po_number].join(' ').toLowerCase();
      return (!location || rowLocation === location)
        && (!article || row.article_name === article)
        && (!search || searchable.includes(search));
    });
  }
  function groupArticles(items) {
    const groups = new Map();
    items.forEach(row => {
      const key = row.article_name || row.article_description || 'Unknown article';
      if (!groups.has(key)) groups.set(key, { name: key, sales: 0, units: 0, locations: new Set(), invoices: new Set() });
      const group = groups.get(key);
      group.sales += Number(row.taxable_amount || 0);
      group.units += Number(row.quantity || 0);
      group.locations.add(locationName(row.delivery_location));
      group.invoices.add(row.invoice_number_normalized || row.invoice_number);
    });
    return [...groups.values()].sort((a, b) => b.sales - a.sales);
  }
  function groupLocations(items) {
    const groups = new Map();
    items.forEach(row => {
      const key = locationName(row.delivery_location);
      if (!groups.has(key)) groups.set(key, { name: key, sales: 0, units: 0, invoices: new Set(), articles: new Map() });
      const group = groups.get(key);
      const article = row.article_name || row.article_description || 'Unknown article';
      group.sales += Number(row.taxable_amount || 0);
      group.units += Number(row.quantity || 0);
      group.invoices.add(row.invoice_number_normalized || row.invoice_number);
      group.articles.set(article, (group.articles.get(article) || 0) + Number(row.taxable_amount || 0));
    });
    return [...groups.values()].map(group => ({
      ...group,
      topArticle: [...group.articles.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || '—'
    })).sort((a, b) => b.sales - a.sales);
  }
  function monthlyGroups(items) {
    const groups = new Map();
    items.forEach(row => {
      const month = String(row.invoice_date || '').slice(0, 7);
      if (month) groups.set(month, (groups.get(month) || 0) + Number(row.taxable_amount || 0));
    });
    return [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }

  function populateFilters() {
    const currentLocation = $('analyticsLocation').value;
    const currentArticle = $('analyticsArticle').value;
    const locations = unique(rows.map(row => locationName(row.delivery_location))).sort((a, b) => a.localeCompare(b));
    const articles = unique(rows.map(row => row.article_name)).sort((a, b) => a.localeCompare(b));
    $('analyticsLocation').innerHTML = '<option value="">All locations</option>' + locations.map(value => `<option value="${safe(value)}">${safe(value)}</option>`).join('');
    $('analyticsArticle').innerHTML = '<option value="">All articles</option>' + articles.map(value => `<option value="${safe(value)}">${safe(value)}</option>`).join('');
    if (locations.includes(currentLocation)) $('analyticsLocation').value = currentLocation;
    if (articles.includes(currentArticle)) $('analyticsArticle').value = currentArticle;
  }
  function renderSummary(items, articles) {
    const totalSales = sum(items, row => row.taxable_amount);
    const invoiceCount = unique(items.map(row => row.invoice_number_normalized || row.invoice_number)).length;
    const top = articles[0];
    const topShare = totalSales > 0 && top ? top.sales / totalSales * 100 : 0;
    $('analyticsSales').textContent = money(totalSales);
    $('analyticsInvoiceCount').textContent = `${invoiceCount} invoice(s)`;
    $('analyticsUnits').textContent = number(sum(items, row => row.quantity));
    $('analyticsLocations').textContent = unique(items.map(row => locationName(row.delivery_location))).length;
    $('analyticsArticles').textContent = articles.length;
    $('analyticsTopShare').textContent = `${topShare.toFixed(1)}%`;
    $('analyticsTopArticle').textContent = top?.name || 'Waiting for data';
  }
  function renderArticleRanking(items, articles) {
    const maxSales = articles[0]?.sales || 1;
    $('articleRanking').innerHTML = articles.slice(0, 10).map((article, index) => `
      <div class="ranking-row">
        <span class="rank-number">${index + 1}</span>
        <span class="ranking-name"><strong>${safe(article.name)}</strong><small>${number(article.units)} units · ${article.locations.size} location(s)</small></span>
        <span class="ranking-bar"><span style="width:${Math.max(article.sales / maxSales * 100, 2).toFixed(1)}%"></span></span>
        <span class="ranking-value"><strong>${money(article.sales)}</strong><small>${article.invoices.size} invoice(s)</small></span>
      </div>`).join('') || '<div class="empty-state"><h3>No article data</h3><p>Change the filters or complete the product import.</p></div>';
  }
  function renderTrend(items) {
    const months = monthlyGroups(items);
    const maxValue = Math.max(...months.map(([, value]) => value), 1);
    $('monthlyTrend').innerHTML = months.map(([month, value]) => {
      const label = new Date(`${month}-01T00:00:00`).toLocaleDateString('en-IN', { month: 'short', year: '2-digit' });
      return `<div class="trend-column"><span class="trend-value">${money(value)}</span><span class="trend-bar" style="height:${Math.max(value / maxValue * 180, 3).toFixed(0)}px"></span><span class="trend-label">${safe(label)}</span></div>`;
    }).join('') || '<div class="empty-state"><h3>No monthly trend</h3><p>Invoice movement will appear after import.</p></div>';
  }
  function renderLocations(items, locations) {
    const totalSales = sum(items, row => row.taxable_amount);
    const maxSales = locations[0]?.sales || 1;
    $('locationBody').innerHTML = locations.map((location, index) => {
      const contribution = totalSales > 0 ? location.sales / totalSales * 100 : 0;
      return `<tr><td>${index + 1}</td><td><span class="location-name">${safe(location.name)}</span><span class="location-subline">${location.articles.size} active article(s)</span></td><td><strong>${money(location.sales)}</strong></td><td>${number(location.units)}</td><td>${location.invoices.size}</td><td>${location.articles.size}</td><td>${safe(location.topArticle)}</td><td class="contribution">${contribution.toFixed(1)}%<span class="contribution-bar"><span style="width:${Math.max(location.sales / maxSales * 100, 2).toFixed(1)}%"></span></span></td></tr>`;
    }).join('');
    $('analyticsEmpty').classList.toggle('hidden', locations.length > 0);
  }
  function parseLocalDate(value) {
    const parts = String(value || '').slice(0, 10).split('-').map(Number);
    return parts.length === 3 && parts.every(Number.isFinite)
      ? new Date(parts[0], parts[1] - 1, parts[2])
      : null;
  }
  function addDays(date, days) {
    const result = new Date(date);
    result.setDate(result.getDate() + days);
    return result;
  }
  function formatShortDate(value) {
    const date = value instanceof Date ? value : parseLocalDate(value);
    return date ? date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: '2-digit' }) : '—';
  }
  function actionPeriods(baseItems) {
    const selected = selectedDateBounds();
    const range = $('analyticsDateRange').value;
    const dates = baseItems.map(row => String(row.invoice_date || '').slice(0, 10)).filter(Boolean).sort();
    let from = selected.from;
    let to = selected.to;

    if (!from && !to && dates.length) {
      const latest = parseLocalDate(dates[dates.length - 1]);
      from = localIsoDate(new Date(latest.getFullYear(), latest.getMonth(), 1));
      to = localIsoDate(new Date(latest.getFullYear(), latest.getMonth() + 1, 0));
    } else {
      if (!from && dates.length) from = dates[0];
      if (!to && dates.length) to = dates[dates.length - 1];
    }

    const start = parseLocalDate(from);
    const end = parseLocalDate(to);
    if (!start || !end) return { current: [], previous: [], base: baseItems, label: 'Selected period' };

    let previousStart;
    let previousEnd;
    if (range === 'current') {
      previousStart = new Date(start.getFullYear(), start.getMonth() - 1, 1);
      const previousMonthEnd = new Date(start.getFullYear(), start.getMonth(), 0).getDate();
      previousEnd = new Date(start.getFullYear(), start.getMonth() - 1, Math.min(end.getDate(), previousMonthEnd));
    } else if (range === 'last' || (!selected.from && !selected.to)) {
      previousStart = new Date(start.getFullYear(), start.getMonth() - 1, 1);
      previousEnd = new Date(start.getFullYear(), start.getMonth(), 0);
    } else {
      const duration = Math.max(1, Math.round((end - start) / 86400000) + 1);
      previousEnd = addDays(start, -1);
      previousStart = addDays(previousEnd, -(duration - 1));
    }

    const current = baseItems.filter(row => {
      const date = String(row.invoice_date || '').slice(0, 10);
      return date >= localIsoDate(start) && date <= localIsoDate(end);
    });
    const previous = baseItems.filter(row => {
      const date = String(row.invoice_date || '').slice(0, 10);
      return date >= localIsoDate(previousStart) && date <= localIsoDate(previousEnd);
    });
    return {
      current,
      previous,
      base: baseItems,
      label: `${formatShortDate(start)}–${formatShortDate(end)} vs ${formatShortDate(previousStart)}–${formatShortDate(previousEnd)}`
    };
  }
  function movementLocations(items) {
    const groups = new Map();
    items.forEach(row => {
      const name = locationName(row.delivery_location);
      if (!groups.has(name)) groups.set(name, { name, cbs: 0, pieces: 0, articles: new Set(), lastDate: '' });
      const group = groups.get(name);
      group.cbs += Number(row.quantity_cbs || 0);
      group.pieces += Number(row.quantity || 0);
      group.articles.add(row.article_name || row.article_description || 'Unknown article');
      const date = String(row.invoice_date || '').slice(0, 10);
      if (date > group.lastDate) group.lastDate = date;
    });
    return groups;
  }
  function movementArticles(items) {
    const groups = new Map();
    items.forEach(row => {
      const name = row.article_name || row.article_description || 'Unknown article';
      if (!groups.has(name)) groups.set(name, { name, cbs: 0, pieces: 0, locations: new Set() });
      const group = groups.get(name);
      group.cbs += Number(row.quantity_cbs || 0);
      group.pieces += Number(row.quantity || 0);
      group.locations.add(locationName(row.delivery_location));
    });
    return groups;
  }
  function changeDetails(current, previous) {
    if (previous <= 0 && current > 0) return { text: 'New', className: 'new' };
    if (previous <= 0) return { text: '—', className: 'neutral' };
    const value = (current - previous) / previous * 100;
    return { text: `${value >= 0 ? '+' : ''}${value.toFixed(1)}%`, className: value >= 10 ? 'positive' : value <= -10 ? 'negative' : 'neutral' };
  }
  function signalChip(label, className) {
    return `<span class="action-signal ${safe(className)}">${safe(label)}</span>`;
  }
  function emptyActionRow(columns, title, message) {
    return `<tr><td colspan="${columns}"><div class="action-empty"><strong>${safe(title)}</strong><span>${safe(message)}</span></div></td></tr>`;
  }
  function renderLocationActions(periods) {
    const current = movementLocations(periods.current);
    const previous = movementLocations(periods.previous);
    const names = unique([...current.keys(), ...previous.keys()]);
    const averageCbs = names.length ? sum(names, name => current.get(name)?.cbs || 0) / names.length : 0;
    const results = names.map(name => {
      const now = current.get(name) || { name, cbs: 0, pieces: 0, articles: new Set(), lastDate: '' };
      const before = previous.get(name) || { cbs: 0 };
      let signal = 'Investigate';
      let signalClass = 'investigate';
      let action = 'Review PO frequency and article availability.';
      if (now.cbs <= 0 && before.cbs > 0) {
        signal = 'Recover'; signalClass = 'recover'; action = 'No CBS this period. Follow up on the next PO and appointment.';
      } else if (now.articles.size <= 1 && now.cbs > 0) {
        signal = 'Cross-sell'; signalClass = 'cross-sell'; action = 'Good movement but a narrow assortment. Propose another popular article.';
      } else if (before.cbs <= 0 && now.cbs > 0) {
        signal = 'New'; signalClass = 'new'; action = 'New movement. Watch the next order and maintain availability.';
      } else if (now.cbs >= before.cbs * 1.15 && now.cbs > 0) {
        signal = 'Grow'; signalClass = 'grow'; action = 'Movement is rising. Protect stock and explore a larger next order.';
      } else if (before.cbs > 0 && now.cbs < before.cbs * .75) {
        signal = 'Recover'; signalClass = 'recover'; action = 'CBS has declined. Check missing articles, PO frequency and appointments.';
      } else if (now.cbs >= averageCbs && now.cbs > 0) {
        signal = 'Protect'; signalClass = 'protect'; action = 'Strong location. Maintain stock and avoid dispatch delays.';
      }
      return { name, now, before, change: changeDetails(now.cbs, before.cbs), signal, signalClass, action };
    }).sort((a, b) => b.now.cbs - a.now.cbs || a.name.localeCompare(b.name));

    $('locationActionBody').innerHTML = results.map(result => `<tr><td><strong>${safe(result.name)}</strong></td><td><strong>${CBS_NUMBER.format(result.now.cbs)} CBS</strong></td><td>${CBS_NUMBER.format(result.before.cbs)} CBS</td><td><span class="change-pill ${result.change.className}">${result.change.text}</span></td><td>${number(result.now.pieces)} PCS</td><td>${result.now.articles.size}</td><td>${formatShortDate(result.now.lastDate)}</td><td><div class="signal-action">${signalChip(result.signal, result.signalClass)}<span>${safe(result.action)}</span></div></td></tr>`).join('') || emptyActionRow(8, 'No location movement', 'Change the filters or complete the CBS historical import.');
    $('locationActionCount').textContent = results.length;
  }
  function renderProductTrends(periods) {
    const current = movementArticles(periods.current);
    const previous = movementArticles(periods.previous);
    const names = unique([...current.keys(), ...previous.keys()]);
    const results = names.map(name => {
      const now = current.get(name) || { name, cbs: 0, pieces: 0, locations: new Set() };
      const before = previous.get(name) || { cbs: 0 };
      const change = changeDetails(now.cbs, before.cbs);
      let signal = 'Stable', signalClass = 'protect';
      if (before.cbs <= 0 && now.cbs > 0) { signal = 'New'; signalClass = 'new'; }
      else if (before.cbs > 0 && now.cbs >= before.cbs * 1.1) { signal = 'Growing'; signalClass = 'grow'; }
      else if (before.cbs > 0 && now.cbs <= before.cbs * .9) { signal = 'Declining'; signalClass = 'recover'; }
      return { name, now, before, change, signal, signalClass };
    }).sort((a, b) => b.now.cbs - a.now.cbs || a.name.localeCompare(b.name));

    $('productTrendBody').innerHTML = results.map(result => `<tr><td><strong>${safe(result.name)}</strong></td><td><strong>${CBS_NUMBER.format(result.now.cbs)} CBS</strong></td><td>${CBS_NUMBER.format(result.before.cbs)} CBS</td><td><span class="change-pill ${result.change.className}">${result.change.text}</span></td><td>${number(result.now.pieces)} PCS</td><td>${result.now.locations.size}</td><td>${signalChip(result.signal, result.signalClass)}</td></tr>`).join('') || emptyActionRow(7, 'No product trend', 'Select a period containing CBS movement.');
    $('productTrendCount').textContent = results.length;
  }
  function renderMissingArticles(periods) {
    const articles = [...movementArticles(periods.current).values()].sort((a, b) => b.cbs - a.cbs).slice(0, 5);
    const locations = [...movementLocations(periods.current).values()];
    const results = locations.map(location => {
      const missing = articles.filter(article => !location.articles.has(article.name)).map(article => article.name);
      return { location, missing };
    }).filter(result => result.missing.length).sort((a, b) => b.location.cbs - a.location.cbs);

    $('missingArticleBody').innerHTML = results.map(result => `<tr><td><strong>${safe(result.location.name)}</strong></td><td>${CBS_NUMBER.format(result.location.cbs)} CBS</td><td>${result.location.articles.size}</td><td><div class="article-tags">${result.missing.slice(0, 3).map(name => `<span>${safe(name)}</span>`).join('')}</div></td><td>Check listing or replenishment and discuss adding ${safe(result.missing[0])} to the next PO.</td></tr>`).join('') || emptyActionRow(5, 'No clear assortment gap', 'The leading articles are already represented at the filtered locations.');
    $('missingArticleCount').textContent = results.length;
  }
  function renderNoOrderAlerts(periods) {
    const invoices = new Map();
    periods.base.forEach(row => {
      const location = locationName(row.delivery_location);
      const date = String(row.invoice_date || '').slice(0, 10);
      const invoice = row.invoice_number_normalized || row.invoice_number || date;
      const key = `${location}|||${invoice}`;
      if (!invoices.has(key)) invoices.set(key, { location, date, cbs: 0, pieces: 0 });
      const entry = invoices.get(key);
      entry.cbs += Number(row.quantity_cbs || 0);
      entry.pieces += Number(row.quantity || 0);
    });
    const latest = new Map();
    invoices.forEach(invoice => {
      if (!latest.has(invoice.location) || invoice.date > latest.get(invoice.location).date) latest.set(invoice.location, invoice);
    });
    const today = parseLocalDate(localIsoDate(new Date()));
    const results = [...latest.values()].map(invoice => {
      const date = parseLocalDate(invoice.date);
      const days = date ? Math.max(0, Math.floor((today - date) / 86400000)) : 0;
      let status = 'Recent', statusClass = 'protect', action = 'No immediate follow-up required.';
      if (days > 30) { status = 'Urgent'; statusClass = 'recover'; action = 'Contact the location or buyer and verify listing, stock and pending PO.'; }
      else if (days > 15) { status = 'Follow up'; statusClass = 'investigate'; action = 'Check the next PO date and whether an appointment is pending.'; }
      else if (days > 7) { status = 'Watch'; statusClass = 'cross-sell'; action = 'Monitor for the next order and keep key articles ready.'; }
      return { ...invoice, days, status, statusClass, action };
    }).sort((a, b) => b.days - a.days || a.location.localeCompare(b.location));
    const alertCount = results.filter(result => result.days > 15).length;

    $('noOrderBody').innerHTML = results.map(result => `<tr><td><strong>${safe(result.location)}</strong></td><td>${formatShortDate(result.date)}</td><td><strong>${result.days} day${result.days === 1 ? '' : 's'}</strong></td><td>${CBS_NUMBER.format(result.cbs)} CBS / ${number(result.pieces)} PCS</td><td>${signalChip(result.status, result.statusClass)}</td><td>${safe(result.action)}</td></tr>`).join('') || emptyActionRow(6, 'No invoice history', 'No matching invoice movement is available for these filters.');
    $('noOrderCount').textContent = alertCount;
  }
  function setOpportunityView(view) {
    activeOpportunityView = view;
    const panels = { 'location-actions': 'locationActionsPanel', 'product-trends': 'productTrendsPanel', 'missing-articles': 'missingArticlesPanel', 'no-order': 'noOrderPanel' };
    document.querySelectorAll('.opportunity-tab').forEach(button => {
      const active = button.dataset.opportunityView === view;
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', String(active));
    });
    Object.entries(panels).forEach(([key, id]) => $(id).classList.toggle('hidden', key !== view));
  }
  function renderOpportunityBoard() {
    const base = nonDateFilteredRows();
    const periods = actionPeriods(base);
    const missingCbs = base.filter(row => Number(row.quantity || 0) > 0 && Number(row.quantity_cbs || 0) <= 0).length;
    $('opportunityPeriod').textContent = periods.label;
    $('cbsDataNotice').classList.toggle('hidden', missingCbs === 0);
    if (missingCbs) $('cbsDataNotice').textContent = `${number(missingCbs)} invoice line(s) still need CBS. Re-run the updated historical product importer to complete this section.`;
    renderLocationActions(periods);
    renderProductTrends(periods);
    renderMissingArticles(periods);
    renderNoOrderAlerts(periods);
    setOpportunityView(activeOpportunityView);
  }

  function renderMovementMatrix(items) {
    const articleGroups = [...movementArticles(items).values()]
      .sort((a, b) => b.cbs - a.cbs || a.name.localeCompare(b.name));
    const locationGroups = [...movementLocations(items).values()]
      .sort((a, b) => b.cbs - a.cbs || a.name.localeCompare(b.name));
    const lookup = new Map();

    items.forEach(row => {
      const location = locationName(row.delivery_location);
      const article = row.article_name || row.article_description || 'Unknown article';
      const key = `${location}|||${article}`;
      if (!lookup.has(key)) lookup.set(key, { cbs: 0, pieces: 0 });
      const cell = lookup.get(key);
      cell.cbs += Number(row.quantity_cbs || 0);
      cell.pieces += Number(row.quantity || 0);
    });

    const possibleCells = locationGroups.length * articleGroups.length;
    const activeCells = [...lookup.values()].filter(cell => cell.cbs > 0).length;
    const coverage = possibleCells ? activeCells / possibleCells * 100 : 0;
    $('matrixCoverage').textContent = `${coverage.toFixed(0)}% coverage`;
    $('movementMatrixEmpty').classList.toggle('hidden', possibleCells > 0);

    if (!possibleCells) {
      $('movementMatrixHead').innerHTML = '';
      $('movementMatrixBody').innerHTML = '';
      return;
    }

    const maxCbs = Math.max(...[...lookup.values()].map(cell => cell.cbs), 1);
    $('movementMatrixHead').innerHTML = `<tr><th>Location</th>${articleGroups.map(article => `<th>${safe(article.name)}</th>`).join('')}</tr>`;
    $('movementMatrixBody').innerHTML = locationGroups.map(location => {
      const cells = articleGroups.map(article => {
        const cell = lookup.get(`${location.name}|||${article.name}`) || { cbs: 0, pieces: 0 };
        if (cell.cbs <= 0 && cell.pieces <= 0) return '<td><span class="matrix-cell no-movement">No movement</span></td>';
        if (cell.cbs <= 0) return `<td><span class="matrix-cell cbs-pending"><strong>CBS pending</strong><small>${number(cell.pieces)} PCS</small></span></td>`;
        const strength = Math.min(cell.cbs / maxCbs, 1);
        const heat = (.12 + strength * .78).toFixed(2);
        const text = strength >= .48 ? '#ffffff' : '#124e45';
        return `<td><span class="matrix-cell" style="--heat:${heat};--heat-text:${text}" title="${safe(location.name)} · ${safe(article.name)}"><strong>${CBS_NUMBER.format(cell.cbs)} CBS</strong><small>${number(cell.pieces)} PCS</small></span></td>`;
      }).join('');
      return `<tr><td><span class="location-name">${safe(location.name)}</span><span class="location-subline">${CBS_NUMBER.format(location.cbs)} CBS total</span></td>${cells}</tr>`;
    }).join('');
  }

  function recommendationCard(title, text, impact) {
    return `<article class="recommendation"><header><h3>${safe(title)}</h3><span class="impact ${safe(impact)}">${safe(impact)}</span></header><p>${safe(text)}</p></article>`;
  }
  function renderRecommendations(items, articles, locations) {
    if (!items.length) {
      $('recommendationGrid').innerHTML = recommendationCard('Add product movement', 'Upload the original Tally PDF while creating or editing a Dispatch trip, or run the historical importer for older invoices.', 'medium');
      return;
    }
    const cards = [];
    const totalSales = sum(items, row => row.taxable_amount);
    const topArticle = articles[0];
    const topShare = totalSales > 0 && topArticle ? topArticle.sales / totalSales * 100 : 0;
    const totalLocations = locations.length;
    const topLocation = locations[0];
    const averageLocationSales = totalLocations ? totalSales / totalLocations : 0;
    const weakestLocation = locations.length >= 3 ? locations[locations.length - 1] : null;

    if (topArticle) {
      cards.push(recommendationCard(
        'Protect the winning article',
        `${topArticle.name} leads with ${number(topArticle.units)} units and ${topShare.toFixed(1)}% of sales value. Maintain priority stock and prevent appointment misses for this SKU.`,
        'opportunity'
      ));
    }

    const expansionCandidate = articles
      .filter(article => totalLocations >= 3 && article.locations.size / totalLocations < .7)
      .sort((a, b) => (b.units / Math.max(b.locations.size, 1)) - (a.units / Math.max(a.locations.size, 1)))[0];
    if (expansionCandidate) {
      cards.push(recommendationCard(
        'Expand location coverage',
        `${expansionCandidate.name} moves ${number(expansionCandidate.units / Math.max(expansionCandidate.locations.size, 1))} units per active location but reaches only ${expansionCandidate.locations.size} of ${totalLocations} locations. Discuss listing or replenishment at uncovered stores.`,
        'opportunity'
      ));
    }

    if (weakestLocation && weakestLocation.sales < averageLocationSales * .65) {
      cards.push(recommendationCard(
        'Review a weak location',
        `${weakestLocation.name} is at ${money(weakestLocation.sales)}, below the location average of ${money(averageLocationSales)}. Check assortment gaps, order frequency, shelf availability and buyer follow-up.`,
        'high'
      ));
    } else if (topLocation) {
      cards.push(recommendationCard(
        'Replicate the strongest mix',
        `${topLocation.name} is the leading location and its top article is ${topLocation.topArticle}. Compare its assortment with lower-volume stores and repeat the winning mix where practical.`,
        'medium'
      ));
    }

    if (topShare > 50) {
      cards.push(recommendationCard(
        'Reduce product concentration risk',
        `${topShare.toFixed(1)}% of sales depends on one article. Use the top SKU to open conversations, then cross-sell the next two articles to broaden the basket.`,
        'high'
      ));
    } else {
      cards.push(recommendationCard(
        'Keep a balanced assortment',
        `The top article contributes ${topShare.toFixed(1)}%, so movement is reasonably diversified. Continue tracking whether the top three products remain balanced across locations.`,
        'medium'
      ));
    }

    const months = monthlyGroups(items);
    if (months.length >= 2) {
      const previous = [...months[months.length - 2]], latest = [...months[months.length - 1]];
      const now = new Date();
      const currentMonth = localIsoDate(now).slice(0, 7);
      let comparisonText = 'previous month';
      if (latest[0] === currentMonth) {
        const cutoffDay = now.getDate();
        previous[1] = sum(items.filter(row => String(row.invoice_date || '').slice(0, 7) === previous[0] && Number(String(row.invoice_date || '').slice(8, 10)) <= cutoffDay), row => row.taxable_amount);
        comparisonText = `the same ${cutoffDay}-day period last month`;
      }
      const change = previous[1] > 0 ? (latest[1] - previous[1]) / previous[1] * 100 : 0;
      cards.push(recommendationCard(
        change >= 0 ? 'Build on recent momentum' : 'Investigate the monthly decline',
        change >= 0
          ? `Latest movement is ${change.toFixed(1)}% above ${comparisonText}. Secure appointments and stock for the articles and locations creating this growth.`
          : `Latest movement is ${Math.abs(change).toFixed(1)}% below ${comparisonText}. Review PO frequency, missed appointments and article-level drops before the next buyer discussion.`,
        change >= 0 ? 'opportunity' : 'high'
      ));
    }

    const invoiceArticles = new Map();
    items.forEach(row => {
      const invoice = row.invoice_number_normalized || row.invoice_number;
      if (!invoiceArticles.has(invoice)) invoiceArticles.set(invoice, new Set());
      invoiceArticles.get(invoice).add(row.article_name);
    });
    const pairs = new Map();
    invoiceArticles.forEach(set => {
      const names = [...set].sort();
      for (let i = 0; i < names.length; i += 1) for (let j = i + 1; j < names.length; j += 1) {
        const key = `${names[i]}|||${names[j]}`;
        pairs.set(key, (pairs.get(key) || 0) + 1);
      }
    });
    const bestPair = [...pairs.entries()].sort((a, b) => b[1] - a[1])[0];
    if (bestPair) {
      const [first, second] = bestPair[0].split('|||');
      cards.push(recommendationCard(
        'Use a proven cross-sell pair',
        `${first} and ${second} appear together in ${bestPair[1]} invoice(s). Use this evidence when proposing a broader order mix to locations carrying only one of them.`,
        'opportunity'
      ));
    }

    $('recommendationGrid').innerHTML = cards.slice(0, 6).join('');
  }

  function render() {
    const items = filteredRows();
    const articles = groupArticles(items);
    const locations = groupLocations(items);
    $('analyticsResultCount').textContent = `${items.length} invoice line(s)`;
    renderSummary(items, articles);
    renderRecommendations(items, articles, locations);
    renderArticleRanking(items, articles);
    renderTrend(items);
    renderLocations(items, locations);
    renderOpportunityBoard();
    renderLocationMaster();
    renderMovementMatrix(items);
  }
  function toggleCustomDates() {
    $('analyticsCustomDates').classList.toggle('hidden', $('analyticsDateRange').value !== 'custom');
  }
  function exportCsv() {
    const items = filteredRows();
    if (!items.length) return toast('No product movement is available to export.');
    const headings = ['Invoice Date', 'Invoice Number', 'PO Number', 'Location', 'Article', 'Description', 'HSN/SAC', 'CBS (Alt. Quantity)', 'Pieces', 'Unit', 'Rate', 'Taxable Amount'];
    const body = items.map(row => [row.invoice_date, row.invoice_number, row.po_number, locationName(row.delivery_location), row.article_name, row.article_description, row.hsn_sac, row.quantity_cbs, row.quantity, row.unit, row.rate, row.taxable_amount]);
    const csv = [headings, ...body].map(cells => cells.map(value => `"${String(value ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    link.download = `dmart-product-movement-${localIsoDate(new Date())}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  async function fetchAllRows(path, pageSize = 1000) {
    const all = [];
    for (let offset = 0; ; offset += pageSize) {
      const page = await api(path, {
        headers: { Range: `${offset}-${offset + pageSize - 1}` }
      });
      const batch = Array.isArray(page) ? page : [];
      all.push(...batch);
      if (batch.length < pageSize) break;
    }
    return all;
  }
  async function fetchLocationAliases() {
    try {
      const aliases = await fetchAllRows('/rest/v1/delivery_location_aliases?select=alias_key,alias_name,canonical_name&order=canonical_name.asc,alias_name.asc');
      locationMasterReady = true;
      locationMasterError = '';
      return aliases;
    } catch (error) {
      locationMasterReady = false;
      locationMasterError = error.message || '';
      return [];
    }
  }
  async function loadData() {
    $('connectionStatus').textContent = 'Loading analytics…';
    const analyticsOnly = trackerRole === 'brand_manager';
    [rows, locationAliases, poLocationRows, invoiceLocationRows] = await Promise.all([
      fetchAllRows('/rest/v1/dmart_invoice_items?select=*&order=invoice_date.desc,line_number.asc'),
      fetchLocationAliases(),
      analyticsOnly ? Promise.resolve([]) : fetchAllRows('/rest/v1/purchase_orders?is_archived=eq.false&select=delivery_location'),
      analyticsOnly ? Promise.resolve([]) : fetchAllRows('/rest/v1/customer_invoices?select=delivery_location')
    ]);
    populateFilters();
    render();
    $('connectionStatus').textContent = 'Cloud synced';
  }
  function clearFilters() {
    $('analyticsSearch').value = '';
    $('analyticsDateRange').value = '';
    $('analyticsDateFrom').value = '';
    $('analyticsDateTo').value = '';
    $('analyticsLocation').value = '';
    $('analyticsArticle').value = '';
    toggleCustomDates();
    render();
  }
  function bindEvents() {
    $('loginForm').addEventListener('submit', async event => {
      event.preventDefault();
      $('loginError').textContent = '';
      try { await signIn($('emailInput').value.trim(), $('passwordInput').value); await start(); }
      catch (error) { $('loginError').textContent = error.message || 'Sign in failed.'; }
    });
    $('signOutBtn').addEventListener('click', signOut);
    $('refreshBtn').addEventListener('click', loadData);
    $('analyticsSearch').addEventListener('input', render);
    ['analyticsLocation', 'analyticsArticle'].forEach(id => $(id).addEventListener('change', render));
    $('analyticsDateRange').addEventListener('change', () => { toggleCustomDates(); render(); });
    ['analyticsDateFrom', 'analyticsDateTo'].forEach(id => { $(id).addEventListener('input', render); $(id).addEventListener('change', render); });
    $('clearAnalyticsFilters').addEventListener('click', clearFilters);
    $('exportAnalytics').addEventListener('click', exportCsv);
    $('locationReviewBody').addEventListener('click', event => {
      const button = event.target.closest('.location-standardize-btn');
      if (button) standardizeObservedLocation(Number(button.dataset.locationIndex), button);
    });
    document.querySelectorAll('.opportunity-tab').forEach(button => button.addEventListener('click', () => setOpportunityView(button.dataset.opportunityView)));
  }
  async function start() {
    await ensureAccess();
    $('signedInAs').textContent = session.user?.email || '';
    hide('loginScreen');
    show('app');
    await loadData();
  }

  try {
    bindEvents();
    try { session = JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null'); } catch (_) { session = null; }
    if (session?.access_token && session?.refresh_token) start().catch(error => { hide('app'); show('loginScreen'); $('loginError').textContent = error.message; });
    else { sessionStorage.removeItem(SESSION_KEY); show('loginScreen'); }
  } catch (error) {
    document.getElementById('app')?.classList.add('hidden');
    document.getElementById('loginScreen')?.classList.remove('hidden');
    const loginError = document.getElementById('loginError');
    if (loginError) loginError.textContent = error?.message || 'The analytics page could not start.';
  }
})();
