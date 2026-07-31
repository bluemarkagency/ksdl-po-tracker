(() => {
  'use strict';

  const CONFIG = window.PO_TRACKER_CONFIG || {};
  const BASE_URL = String(CONFIG.SUPABASE_URL || '').replace(/\/$/, '');
  const PUBLIC_KEY = CONFIG.SUPABASE_ANON_KEY || '';
  const SESSION_KEY = 'ksdl-po-tracker-session';
  const INR = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
  const NUMBER = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
  let session = null;
  let refreshPromise = null;
  let rows = [];

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
    const role = await api('/rest/v1/rpc/po_tracker_role', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    if (!['owner', 'accountant'].includes(role)) throw new Error('Only the owner or accountant can access product analytics.');
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
    return String(value || 'Location pending').replace(/\s+/g, ' ').trim();
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
  function renderMatrix(items, articles, locations) {
    const topArticles = articles.slice(0, 8);
    const topLocations = locations.slice(0, 12);
    const values = new Map();
    let maxUnits = 0;
    items.forEach(row => {
      const key = `${locationName(row.delivery_location)}|||${row.article_name}`;
      const units = (values.get(key) || 0) + Number(row.quantity || 0);
      values.set(key, units);
      maxUnits = Math.max(maxUnits, units);
    });
    if (!topArticles.length || !topLocations.length) {
      $('movementMatrix').innerHTML = '<tbody><tr><td>No movement data available.</td></tr></tbody>';
      return;
    }
    const head = `<thead><tr><th>Location</th>${topArticles.map(article => `<th>${safe(article.name)}</th>`).join('')}</tr></thead>`;
    const body = `<tbody>${topLocations.map(location => `<tr><td><strong>${safe(location.name)}</strong></td>${topArticles.map(article => {
      const units = values.get(`${location.name}|||${article.name}`) || 0;
      const intensity = units ? Math.min(.12 + units / Math.max(maxUnits, 1) * .76, .88) : .04;
      const text = intensity > .5 ? '#fff' : '#23423c';
      return `<td><span class="matrix-cell" style="--heat:${intensity.toFixed(2)};--heat-text:${text}">${units ? number(units) : '—'}</span></td>`;
    }).join('')}</tr>`).join('')}</tbody>`;
    $('movementMatrix').innerHTML = head + body;
  }

  function recommendationCard(title, text, impact) {
    return `<article class="recommendation"><header><h3>${safe(title)}</h3><span class="impact ${safe(impact)}">${safe(impact)}</span></header><p>${safe(text)}</p></article>`;
  }
  function renderRecommendations(items, articles, locations) {
    if (!items.length) {
      $('recommendationGrid').innerHTML = recommendationCard('Import product movement', 'Run the historical product importer to generate location and article recommendations.', 'medium');
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
    renderMatrix(items, articles, locations);
  }
  function toggleCustomDates() {
    $('analyticsCustomDates').classList.toggle('hidden', $('analyticsDateRange').value !== 'custom');
  }
  function exportCsv() {
    const items = filteredRows();
    if (!items.length) return toast('No product movement is available to export.');
    const headings = ['Invoice Date', 'Invoice Number', 'PO Number', 'Location', 'Article', 'Description', 'HSN/SAC', 'Quantity', 'Unit', 'Rate', 'Taxable Amount'];
    const body = items.map(row => [row.invoice_date, row.invoice_number, row.po_number, locationName(row.delivery_location), row.article_name, row.article_description, row.hsn_sac, row.quantity, row.unit, row.rate, row.taxable_amount]);
    const csv = [headings, ...body].map(cells => cells.map(value => `"${String(value ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    link.download = `dmart-product-movement-${localIsoDate(new Date())}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  async function fetchAllInvoiceItems() {
    const all = [];
    const pageSize = 1000;
    for (let offset = 0; ; offset += pageSize) {
      const page = await api('/rest/v1/dmart_invoice_items?select=*&order=invoice_date.desc,line_number.asc', {
        headers: { Range: `${offset}-${offset + pageSize - 1}` }
      });
      const batch = Array.isArray(page) ? page : [];
      all.push(...batch);
      if (batch.length < pageSize) break;
    }
    return all;
  }
  async function loadData() {
    $('connectionStatus').textContent = 'Loading analytics…';
    rows = await fetchAllInvoiceItems();
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
