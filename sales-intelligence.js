(() => {
  'use strict';

  const CONFIG = window.PO_TRACKER_CONFIG || {};
  const BASE_URL = String(CONFIG.SUPABASE_URL || '').replace(/\/$/, '');
  const PUBLIC_KEY = CONFIG.SUPABASE_ANON_KEY || '';
  const SESSION_KEY = 'ksdl-po-tracker-session';
  const DAY_MS = 86400000;
  const INR = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
  const NUMBER = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
  const CBS = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 1 });

  let session = null;
  let refreshPromise = null;
  let trackerRole = '';
  let locationCycles = [];
  let invoiceRows = [];
  let purchaseOrders = [];
  const CHANNELS = window.KSDLChannelInsights;

  const $ = id => document.getElementById(id);
  const safe = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
  const money = value => INR.format(Number(value || 0));
  const number = value => NUMBER.format(Number(value || 0));
  const cbs = value => CBS.format(Number(value || 0));
  const show = id => $(id).classList.remove('hidden');
  const hide = id => $(id).classList.add('hidden');
  const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));
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
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    }));
  }
  async function signOut() {
    try { await api('/auth/v1/logout', { method: 'POST' }); } catch (_) { /* Local sign-out still succeeds. */ }
    session = null;
    sessionStorage.removeItem(SESSION_KEY);
    hide('app');
    show('loginScreen');
  }
  async function ensureAccess() {
    trackerRole = await api('/rest/v1/rpc/po_tracker_role', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}'
    });
    if (!['owner', 'accountant', 'brand_manager'].includes(trackerRole)) {
      throw new Error('Only the owner, accountant or brand manager can access Sales Intelligence.');
    }
    document.querySelectorAll('.operational-nav').forEach(link => link.classList.toggle('hidden', trackerRole === 'brand_manager'));
  }

  function localIsoDate(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }
  function parseDate(value) {
    const parts = String(value || '').slice(0, 10).split('-').map(Number);
    return parts.length === 3 && parts.every(Number.isFinite)
      ? new Date(parts[0], parts[1] - 1, parts[2])
      : null;
  }
  function addDays(value, days) {
    const date = value instanceof Date ? new Date(value) : parseDate(value);
    if (!date) return null;
    date.setDate(date.getDate() + Number(days || 0));
    return date;
  }
  function differenceDays(later, earlier) {
    const end = later instanceof Date ? later : parseDate(later);
    const start = earlier instanceof Date ? earlier : parseDate(earlier);
    return end && start ? Math.round((end - start) / DAY_MS) : null;
  }
  function shortDate(value) {
    const date = value instanceof Date ? value : parseDate(value);
    return date ? date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: '2-digit' }) : '—';
  }
  function locationName(value) {
    const name = String(value || 'Location pending').replace(/\s+/g, ' ').trim();
    return /^modasa(?:\b|[,\-])/i.test(name) ? 'Modasa' : name;
  }
  function key(value) {
    return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  }
  function className(value) {
    return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  }

  function confidenceForCycle(row) {
    const count = Number(row.po_count || 0);
    const average = Number(row.avg_days_between_pos || 0);
    const deviation = Number(row.stddev_days_between_pos || 0);
    const variation = average > 0 ? deviation / average : 1;
    if (count >= 6 && variation <= .5) return 'High';
    if (count >= 3 && average > 0) return 'Medium';
    return 'Early estimate';
  }
  function cyclePrediction(row) {
    const today = parseDate(localIsoDate(new Date()));
    const averageGap = Math.max(1, Number(row.avg_days_between_pos || 15));
    const expectedDate = addDays(row.last_po_date, Math.round(averageGap));
    const timing = differenceDays(expectedDate, today);
    const daysSincePo = differenceDays(today, row.last_po_date);
    const confidence = confidenceForCycle(row);
    const horizon = Number($('forecastHorizon').value || 14);
    let probability;
    if (timing == null) probability = 20;
    else if (timing <= 0) probability = clamp(82 + Math.abs(timing) * 2, 82, 96);
    else if (timing <= horizon) probability = clamp(88 - (timing / Math.max(horizon, 1)) * 28, 55, 88);
    else probability = clamp(45 - ((timing - horizon) / Math.max(averageGap, 1)) * 35, 8, 45);
    if (confidence === 'Early estimate') probability = Math.min(probability, 65);

    let priority = 'Monitor';
    let priorityClass = 'monitor';
    let action = `Usual PO cycle is about ${Math.round(averageGap)} days. Monitor until ${shortDate(expectedDate)}.`;
    if (timing != null && timing <= 0) {
      priority = 'Call now';
      priorityClass = 'call-now';
      action = `PO is ${Math.abs(timing)} day${Math.abs(timing) === 1 ? '' : 's'} beyond the expected cycle. Ask sales staff to contact the store today and confirm the next PO.`;
    } else if (timing != null && timing <= horizon) {
      priority = 'Upcoming';
      priorityClass = 'upcoming';
      action = `PO is expected within ${timing} day${timing === 1 ? '' : 's'}. Confirm shelf stock, article requirement and the expected PO date.`;
    }
    return {
      ...row,
      delivery_location: locationName(row.delivery_location),
      averageGap,
      expectedDate,
      timing,
      daysSincePo,
      probability: Math.round(probability),
      confidence,
      priority,
      priorityClass,
      action,
      expectedValue: Number(row.recent_avg_po_value || row.avg_po_value || 0)
    };
  }

  function selectedLocation() { return $('intelligenceLocation').value; }
  function searchText() { return $('intelligenceSearch').value.trim().toLowerCase(); }
  function confidenceMatches(value) { return !$('confidenceFilter').value || $('confidenceFilter').value === value; }
  function locationMatchesSearch(location, search) {
    if (!search || String(location).toLowerCase().includes(search)) return true;
    return invoiceRows.some(row =>
      locationName(row.delivery_location) === location
      && [row.article_name, row.article_description, row.po_number, row.invoice_number]
        .join(' ').toLowerCase().includes(search)
    );
  }
  function filteredPredictions() {
    const location = selectedLocation();
    const search = searchText();
    return locationCycles.map(cyclePrediction).filter(item =>
      (!location || item.delivery_location === location)
      && locationMatchesSearch(item.delivery_location, search)
      && confidenceMatches(item.confidence)
    );
  }
  function probabilityMarkup(value) {
    return `<span class="probability"><strong>${value}%</strong><span class="probability-bar"><span style="width:${value}%"></span></span></span>`;
  }
  function timingLabel(prediction) {
    if (prediction.timing == null) return 'Insufficient history';
    if (prediction.timing < 0) return `${Math.abs(prediction.timing)} days overdue`;
    if (prediction.timing === 0) return 'Expected today';
    return `In ${prediction.timing} days`;
  }
  function renderPriorities(predictions) {
    const horizon = Number($('forecastHorizon').value || 14);
    const showing = predictions
      .filter(item => Number(item.open_po_count || 0) === 0 && (item.timing == null || item.timing <= horizon))
      .sort((left, right) => (left.timing ?? 999) - (right.timing ?? 999) || right.expectedValue - left.expectedValue);
    $('priorityBody').innerHTML = showing.map(item => `
      <tr>
        <td><span class="signal-chip ${item.priorityClass}">${safe(item.priority)}</span></td>
        <td><span class="cell-main">${safe(item.delivery_location)}</span><span class="cell-sub">${number(item.po_count)} historical PO(s)</span></td>
        <td>${shortDate(item.last_po_date)}<span class="cell-sub">${item.daysSincePo == null ? '—' : `${item.daysSincePo} days ago`}</span></td>
        <td><span class="number-cell">${item.averageGap.toFixed(1)} days</span><span class="cell-sub">Variation ${Number(item.stddev_days_between_pos || 0).toFixed(1)} days</span></td>
        <td><strong>${shortDate(item.expectedDate)}</strong></td>
        <td><strong>${safe(timingLabel(item))}</strong></td>
        <td><strong>${money(item.expectedValue)}</strong></td>
        <td>${probabilityMarkup(item.probability)}</td>
        <td><span class="confidence-chip ${className(item.confidence)}">${safe(item.confidence)}</span></td>
        <td class="recommended-action">${safe(item.action)}</td>
      </tr>`).join('');
    $('priorityCount').textContent = `${showing.length} location${showing.length === 1 ? '' : 's'}`;
    $('priorityEmpty').classList.toggle('hidden', showing.length > 0);
    return showing;
  }

  function periodIndex(dateValue, referenceDate) {
    const date = parseDate(dateValue);
    if (!date) return -1;
    const daysAgo = Math.floor((referenceDate - date) / DAY_MS);
    if (daysAgo < 0 || daysAgo >= 90) return -1;
    return Math.floor(daysAgo / 30);
  }
  function articleForecasts(rows) {
    const today = parseDate(localIsoDate(new Date()));
    const groups = new Map();
    rows.forEach(row => {
      const article = row.article_name || row.article_description || 'Unknown article';
      if (!groups.has(article)) groups.set(article, {
        article, periods: [0, 1, 2].map(() => ({ cbs: 0, pieces: 0, value: 0 })),
        invoices: new Set(), locations: new Set(), totalCbs: 0, totalValue: 0
      });
      const group = groups.get(article);
      const index = periodIndex(row.invoice_date, today);
      if (index >= 0) {
        group.periods[index].cbs += Number(row.quantity_cbs || 0);
        group.periods[index].pieces += Number(row.quantity || 0);
        group.periods[index].value += Number(row.taxable_amount || 0);
        group.totalCbs += Number(row.quantity_cbs || 0);
        group.totalValue += Number(row.taxable_amount || 0);
        group.invoices.add(row.invoice_number_normalized || row.invoice_number);
        group.locations.add(locationName(row.delivery_location));
      }
    });
    return [...groups.values()].map(group => {
      const [current, previous, earlier] = group.periods;
      const available = [current, previous, earlier].filter(period => period.cbs > 0);
      const forecastCbs = available.length >= 3
        ? current.cbs * .5 + previous.cbs * .3 + earlier.cbs * .2
        : available.length === 2
          ? current.cbs * .6 + previous.cbs * .4
          : current.cbs || previous.cbs || earlier.cbs;
      const piecesPerCbs = group.totalCbs > 0
        ? sum(group.periods, period => period.pieces) / group.totalCbs
        : 0;
      const valuePerCbs = group.totalCbs > 0 ? group.totalValue / group.totalCbs : 0;
      const change = previous.cbs > 0 ? (current.cbs - previous.cbs) / previous.cbs * 100 : (current.cbs > 0 ? 100 : 0);
      let trend = 'Stable';
      if (change >= 15) trend = 'Growing';
      else if (change <= -20) trend = 'Declining';
      const confidence = group.invoices.size >= 8 && available.length === 3
        ? 'High'
        : group.invoices.size >= 3 && available.length >= 2 ? 'Medium' : 'Early estimate';
      let action = `Maintain approximately ${Math.ceil(forecastCbs)} CBS for expected 30-day demand.`;
      if (trend === 'Growing') action = `Movement is rising. Secure ${Math.ceil(forecastCbs * 1.1)} CBS and protect availability at leading locations.`;
      if (trend === 'Declining') action = `Confirm store requirements before replenishment and investigate which locations or articles caused the decline.`;
      return {
        ...group,
        forecastCbs,
        forecastPieces: forecastCbs * piecesPerCbs,
        forecastValue: forecastCbs * valuePerCbs,
        change,
        trend,
        confidence,
        action
      };
    }).filter(item => item.forecastCbs > 0).sort((left, right) => right.forecastCbs - left.forecastCbs);
  }
  function filteredInvoiceRows() {
    const location = selectedLocation();
    const search = searchText();
    return invoiceRows.filter(row => {
      const rowLocation = locationName(row.delivery_location);
      const searchable = [rowLocation, row.article_name, row.article_description, row.po_number, row.invoice_number].join(' ').toLowerCase();
      return (!location || rowLocation === location) && (!search || searchable.includes(search));
    });
  }
  function renderArticleForecasts(forecasts) {
    const showing = forecasts.filter(item => confidenceMatches(item.confidence));
    $('articleForecastBody').innerHTML = showing.map(item => `
      <tr>
        <td><span class="cell-main">${safe(item.article)}</span><span class="cell-sub">${item.invoices.size} invoice(s)</span></td>
        <td><strong>${cbs(item.periods[0].cbs)} CBS</strong><span class="cell-sub">${number(item.periods[0].pieces)} PCS</span></td>
        <td><strong>${cbs(item.periods[1].cbs)} CBS</strong><span class="cell-sub">${number(item.periods[1].pieces)} PCS</span></td>
        <td><strong>${cbs(item.forecastCbs)} CBS</strong></td>
        <td>${number(item.forecastPieces)} PCS</td>
        <td><strong>${money(item.forecastValue)}</strong></td>
        <td><span class="trend-chip ${className(item.trend)}">${safe(item.trend)} ${item.change >= 0 ? '+' : ''}${item.change.toFixed(0)}%</span></td>
        <td>${item.locations.size}</td>
        <td><span class="confidence-chip ${className(item.confidence)}">${safe(item.confidence)}</span></td>
        <td class="recommended-action">${safe(item.action)}</td>
      </tr>`).join('');
    $('articleForecastCount').textContent = `${showing.length} article${showing.length === 1 ? '' : 's'}`;
    $('articleForecastEmpty').classList.toggle('hidden', showing.length > 0);
    return showing;
  }

  function growthOpportunities(predictions) {
    const today = parseDate(localIsoDate(new Date()));
    const recentCutoff = addDays(today, -60);
    const globalArticles = new Map();
    const locationArticles = new Map();
    invoiceRows.forEach(row => {
      const article = row.article_name || row.article_description || 'Unknown article';
      const location = locationName(row.delivery_location);
      const date = parseDate(row.invoice_date);
      if (!globalArticles.has(article)) globalArticles.set(article, { article, cbs: 0, locations: new Set() });
      const global = globalArticles.get(article);
      global.cbs += Number(row.quantity_cbs || 0);
      global.locations.add(location);
      if (!locationArticles.has(location)) locationArticles.set(location, new Map());
      const articles = locationArticles.get(location);
      if (!articles.has(article)) articles.set(article, { lastDate: '', cbs: 0, recentCbs: 0 });
      const local = articles.get(article);
      local.cbs += Number(row.quantity_cbs || 0);
      if (date && date >= recentCutoff) local.recentCbs += Number(row.quantity_cbs || 0);
      if (String(row.invoice_date || '') > local.lastDate) local.lastDate = String(row.invoice_date || '');
    });
    const leaders = [...globalArticles.values()]
      .filter(article => article.locations.size >= 2 && article.cbs > 0)
      .sort((left, right) => right.cbs - left.cbs)
      .slice(0, 8);
    const selected = selectedLocation();
    const search = searchText();
    const opportunities = [];
    predictions.forEach(prediction => {
      const location = prediction.delivery_location;
      if (selected && location !== selected) return;
      const localArticles = locationArticles.get(location) || new Map();
      leaders.forEach(article => {
        const local = localArticles.get(article.article);
        if (local?.recentCbs > 0) return;
        const type = local ? 'Recover dormant article' : 'Cross-sell article';
        const detail = local
          ? `${article.article} previously moved here but has no CBS in the latest 60 days. Last invoice: ${shortDate(local.lastDate)}.`
          : `${article.article} moves at ${article.locations.size} other locations but has no recorded movement here.`;
        const confidence = article.locations.size >= 5 && Number(prediction.po_count || 0) >= 4 ? 'High' : 'Medium';
        if (!confidenceMatches(confidence)) return;
        if (search && !`${location} ${article.article}`.toLowerCase().includes(search)) return;
        opportunities.push({ location, article: article.article, type, detail, confidence, score: article.cbs, expectedPo: prediction.expectedDate });
      });
    });
    return opportunities.sort((left, right) => right.score - left.score).slice(0, 12);
  }
  function renderGrowth(opportunities) {
    $('growthGrid').innerHTML = opportunities.map(item => `
      <article class="growth-card">
        <header><div><span class="eyebrow">${safe(item.type)}</span><h3>${safe(item.location)}</h3></div><span class="confidence-chip ${className(item.confidence)}">${safe(item.confidence)}</span></header>
        <span class="article-tag">${safe(item.article)}</span>
        <p>${safe(item.detail)} Ask the store about listing, shelf stock or replenishment in the next PO.</p>
        <footer><span>Expected PO ${shortDate(item.expectedPo)}</span><strong>Sales follow-up</strong></footer>
      </article>`).join('');
    $('growthCount').textContent = `${opportunities.length} action${opportunities.length === 1 ? '' : 's'}`;
    $('growthEmpty').classList.toggle('hidden', opportunities.length > 0);
  }

  function locationMovement(rows) {
    const today = parseDate(localIsoDate(new Date()));
    const groups = new Map();
    rows.forEach(row => {
      const location = locationName(row.delivery_location);
      if (!groups.has(location)) groups.set(location, { location, current: 0, previous: 0 });
      const index = periodIndex(row.invoice_date, today);
      if (index === 0) groups.get(location).current += Number(row.quantity_cbs || 0);
      else if (index === 1) groups.get(location).previous += Number(row.quantity_cbs || 0);
    });
    return groups;
  }
  function riskLocations(predictions) {
    const movement = locationMovement(invoiceRows);
    const selected = selectedLocation();
    const search = searchText();
    return predictions.map(prediction => {
      const values = movement.get(prediction.delivery_location) || { current: 0, previous: 0 };
      const change = values.previous > 0
        ? (values.current - values.previous) / values.previous * 100
        : values.current > 0 ? 100 : 0;
      const overdue = Number(prediction.open_po_count || 0) === 0
        && prediction.timing != null && prediction.timing <= 0;
      const declining = values.previous > 0 && change <= -25;
      let risk = 'Low';
      let action = 'Maintain normal stock and PO follow-up.';
      if (overdue && declining) {
        risk = 'High';
        action = 'PO cycle is overdue and CBS has declined. Contact the store, check listings, shelf availability and missing articles.';
      } else if (overdue || declining) {
        risk = 'Medium';
        action = overdue
          ? 'The PO is overdue. Confirm the next order date and store stock today.'
          : 'CBS movement has declined. Compare article movement and recover missing products.';
      }
      return { ...prediction, ...values, change, risk, action };
    }).filter(item =>
      item.risk !== 'Low'
      && (!selected || item.delivery_location === selected)
      && locationMatchesSearch(item.delivery_location, search)
      && confidenceMatches(item.confidence)
    ).sort((left, right) => (left.risk === 'High' ? -1 : 1) - (right.risk === 'High' ? -1 : 1) || left.change - right.change);
  }
  function renderRisks(items) {
    $('riskBody').innerHTML = items.map(item => `
      <tr>
        <td><span class="cell-main">${safe(item.delivery_location)}</span></td>
        <td><strong>${cbs(item.current)} CBS</strong></td>
        <td>${cbs(item.previous)} CBS</td>
        <td><span class="trend-chip ${item.change <= -20 ? 'declining' : 'stable'}">${item.change >= 0 ? '+' : ''}${item.change.toFixed(0)}%</span></td>
        <td>${item.daysSincePo == null ? '—' : `${item.daysSincePo} days`}</td>
        <td><span class="signal-chip risk-chip ${className(item.risk)}">${safe(item.risk)}</span></td>
        <td class="recommended-action">${safe(item.action)}</td>
      </tr>`).join('');
    $('riskCount').textContent = `${items.length} risk${items.length === 1 ? '' : 's'}`;
    $('riskEmpty').classList.toggle('hidden', items.length > 0);
  }

  function populateFilters() {
    const current = $('intelligenceLocation').value;
    const locations = unique([
      ...locationCycles.map(row => locationName(row.delivery_location)),
      ...invoiceRows.map(row => locationName(row.delivery_location))
    ]).sort((left, right) => left.localeCompare(right));
    $('intelligenceLocation').innerHTML = '<option value="">All locations</option>'
      + locations.map(location => `<option value="${safe(location)}">${safe(location)}</option>`).join('');
    if (locations.includes(current)) $('intelligenceLocation').value = current;
  }
  function renderDataDate() {
    const dates = [
      ...locationCycles.map(row => row.last_po_date),
      ...invoiceRows.map(row => row.invoice_date),
      ...purchaseOrders.map(row => row.po_date || row.po_received_date)
    ].filter(Boolean).sort();
    $('dataAsOf').textContent = dates.length ? `Data through ${shortDate(dates[dates.length - 1])}` : 'Waiting for data';
  }

  function intelligenceBandMarkup(channel, primaryLabel, primaryValue, primaryHelp, secondaryLabel, secondaryValue, metrics) {
    return `
      <header><div><h3>${safe(channel)}</h3><p>${channel === 'Store' ? 'DMart and Reliance account decisions' : 'Blinkit, Zepto, BigBasket and other accounts'}</p></div><span class="channel-growth ${metrics.attention ? 'down' : ''}">${safe(metrics.headline)}</span></header>
      <div class="channel-band-primary">
        <div><span>${safe(primaryLabel)}</span><strong>${safe(primaryValue)}</strong><small>${safe(primaryHelp)}</small></div>
        <div><span>${safe(secondaryLabel)}</span><strong>${safe(secondaryValue)}</strong><small>${safe(metrics.secondaryHelp)}</small></div>
      </div>
      <div class="channel-metric-row">
        ${metrics.items.map(item => `<div class="channel-metric"><span>${safe(item.label)}</span><strong>${safe(item.value)}</strong></div>`).join('')}
      </div>`;
  }

  function renderChannelIntelligence(allPredictions) {
    if (!CHANNELS) return;
    const horizon = Number($('forecastHorizon').value || 14);
    const analysis = CHANNELS.analyse(purchaseOrders, 30, localIsoDate(new Date()));
    const forecasts = articleForecasts(invoiceRows);
    const storeCalls = allPredictions.filter(item => Number(item.open_po_count || 0) === 0 && item.timing != null && item.timing <= 0);
    const storeExpected = allPredictions.filter(item => Number(item.open_po_count || 0) === 0 && item.timing != null && item.timing <= horizon);
    const storeRisks = riskLocations(allPredictions);
    const storeForecastCbs = sum(forecasts, item => item.forecastCbs);
    const storeExpectedValue = sum(storeExpected, item => item.expectedValue);
    const ecomRows = purchaseOrders.map(row => CHANNELS.normalize(row)).filter(row => row.channel === 'E-commerce' && !row.cancelled);
    const ecomOpen = ecomRows.filter(row => row.open);
    const today = localIsoDate(new Date());
    const upcomingAppointments = ecomOpen.filter(row => {
      const timing = row.delivery_date ? CHANNELS.differenceDays(row.delivery_date, today) : null;
      return timing != null && timing >= 0 && timing <= horizon;
    });
    const missingAppointments = ecomOpen.filter(row => !row.delivery_date);
    const ecomQueue = CHANNELS.ecomActions(purchaseOrders, horizon, today);
    const ecomDue = ecomQueue.filter(item => ['Urgent', 'High'].includes(item.priority)).length;

    $('storeIntelligenceBand').innerHTML = intelligenceBandMarkup(
      'Store', '30-day CBS forecast', `${cbs(storeForecastCbs)} CBS`, 'Detailed invoice Alt. Quantity',
      'Expected PO value', money(storeExpectedValue), {
        headline: `${storeCalls.length} call${storeCalls.length === 1 ? '' : 's'} due`, attention: storeCalls.length > 0,
        secondaryHelp: `Next ${horizon} days`,
        items: [
          { label: 'Overdue locations', value: number(storeCalls.length) },
          { label: 'POs expected', value: number(storeExpected.length) },
          { label: 'At-risk locations', value: number(storeRisks.length) },
          { label: 'Open POs', value: number(analysis.byChannel.Store.openCount) }
        ]
      }
    );
    $('ecomIntelligenceBand').innerHTML = intelligenceBandMarkup(
      'E-commerce', 'Open PO value', money(analysis.byChannel['E-commerce'].openValue), `${ecomOpen.length} open PO(s)`,
      'Latest 30-day value', money(analysis.byChannel['E-commerce'].value), {
        headline: `${ecomDue} action${ecomDue === 1 ? '' : 's'} due`, attention: ecomDue > 0,
        secondaryHelp: 'Invoice amount when available, otherwise PO value',
        items: [
          { label: `Appointments ≤${horizon}d`, value: number(upcomingAppointments.length) },
          { label: 'Missing appointments', value: number(missingAppointments.length) },
          { label: 'Urgent / high', value: number(ecomDue) },
          { label: 'Active customers', value: number(analysis.customers.filter(item => item.channel === 'E-commerce').length) }
        ]
      }
    );

    const storeQueue = allPredictions
      .filter(item => Number(item.open_po_count || 0) === 0 && item.timing != null && item.timing <= horizon)
      .map(item => ({
        priority: item.timing <= 0 ? 'High' : 'Plan',
        score: item.timing <= 0 ? 88 + Math.abs(item.timing) : 70 - item.timing,
        channel: 'Store', customer: 'DMart', location: item.delivery_location,
        signal: item.timing <= 0 ? 'PO cycle overdue' : 'PO expected soon',
        evidence: item.timing <= 0
          ? `${Math.abs(item.timing)} day(s) beyond the ${Math.round(item.averageGap)}-day average cycle`
          : `Next PO expected in ${item.timing} day(s); expected value ${money(item.expectedValue)}`,
        action: item.action
      }));
    const channelFocus = $('intelligenceChannelFocus').value;
    const search = searchText();
    const queue = [...storeQueue, ...ecomQueue]
      .filter(item => !channelFocus || item.channel === channelFocus)
      .filter(item => !search || [item.channel, item.customer, item.location, item.signal, item.evidence, item.action].join(' ').toLowerCase().includes(search))
      .sort((left, right) => right.score - left.score || left.customer.localeCompare(right.customer))
      .slice(0, 30);
    $('channelActionBody').innerHTML = queue.map(item => `<tr><td><span class="channel-priority ${className(item.priority)}">${safe(item.priority)}</span></td><td><span class="channel-chip ${item.channel === 'E-commerce' ? 'ecommerce' : ''}">${safe(item.channel)}</span></td><td><span class="channel-account">${safe(item.customer)}</span><span class="channel-account-sub">${safe(item.location)}</span></td><td><strong>${safe(item.signal)}</strong></td><td>${safe(item.evidence)}</td><td class="channel-action-text">${safe(item.action)}</td></tr>`).join('');
    $('channelActionCount').textContent = `${queue.length} action${queue.length === 1 ? '' : 's'}`;
    $('channelActionEmpty').classList.toggle('hidden', queue.length > 0);
  }

  function render() {
    const allPredictions = locationCycles.map(cyclePrediction);
    const predictions = filteredPredictions();
    const horizon = Number($('forecastHorizon').value || 14);
    const priorities = renderPriorities(predictions);
    const forecasts = renderArticleForecasts(articleForecasts(filteredInvoiceRows()));
    const growth = growthOpportunities(allPredictions);
    renderGrowth(growth);
    const risks = riskLocations(allPredictions);
    renderRisks(risks);

    $('callTodayCount').textContent = predictions.filter(item =>
      Number(item.open_po_count || 0) === 0 && item.timing != null && item.timing <= 0
    ).length;
    $('expectedPoCount').textContent = priorities.length;
    $('expectedPoHorizon').textContent = `Next ${horizon} days, including overdue`;
    $('forecastCbs').textContent = `${cbs(sum(forecasts, item => item.forecastCbs))} CBS`;
    $('forecastValue').textContent = money(sum(forecasts, item => item.forecastValue));
    $('riskLocationCount').textContent = risks.length;
    renderChannelIntelligence(allPredictions);
    renderDataDate();
  }

  async function fetchAllRows(path, pageSize = 1000) {
    const all = [];
    for (let offset = 0; ; offset += pageSize) {
      const page = await api(path, { headers: { Range: `${offset}-${offset + pageSize - 1}` } });
      const batch = Array.isArray(page) ? page : [];
      all.push(...batch);
      if (batch.length < pageSize) break;
    }
    return all;
  }
  async function loadData() {
    $('connectionStatus').textContent = 'Loading predictions…';
    [locationCycles, invoiceRows, purchaseOrders] = await Promise.all([
      api('/rest/v1/rpc/sales_intelligence_location_cycles', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}'
      }),
      fetchAllRows('/rest/v1/dmart_invoice_items?select=invoice_number,invoice_number_normalized,po_number,invoice_date,delivery_location,article_name,article_description,quantity,quantity_cbs,taxable_amount&order=invoice_date.desc,line_number.asc'),
      fetchAllRows('/rest/v1/purchase_orders?is_archived=eq.false&select=id,customer_name,po_number,po_date,po_received_date,delivery_date,delivery_completed_date,status,po_value,invoice_number,invoice_date,invoice_amount,delivery_location&order=po_date.desc')
    ]);
    locationCycles = Array.isArray(locationCycles) ? locationCycles : [];
    invoiceRows = Array.isArray(invoiceRows) ? invoiceRows : [];
    purchaseOrders = Array.isArray(purchaseOrders) ? purchaseOrders : [];
    populateFilters();
    render();
    $('connectionStatus').textContent = 'Cloud synced';
  }
  function clearFilters() {
    $('intelligenceSearch').value = '';
    $('forecastHorizon').value = '14';
    $('intelligenceLocation').value = '';
    $('confidenceFilter').value = '';
    $('intelligenceChannelFocus').value = '';
    render();
  }
  function bindEvents() {
    $('loginForm').addEventListener('submit', async event => {
      event.preventDefault();
      $('loginError').textContent = '';
      try {
        await signIn($('emailInput').value.trim(), $('passwordInput').value);
        await start();
      } catch (error) {
        $('loginError').textContent = error.message || 'Sign in failed.';
      }
    });
    $('signOutBtn').addEventListener('click', signOut);
    $('refreshBtn').addEventListener('click', () => loadData().catch(error => toast(error.message)));
    $('intelligenceSearch').addEventListener('input', render);
    ['forecastHorizon', 'intelligenceLocation', 'confidenceFilter', 'intelligenceChannelFocus'].forEach(id => $(id).addEventListener('change', render));
    $('clearIntelligenceFilters').addEventListener('click', clearFilters);
  }
  async function start() {
    if (!BASE_URL || !PUBLIC_KEY) throw new Error('The app is not configured.');
    await ensureAccess();
    $('signedInAs').textContent = session.user?.email || '';
    hide('loginScreen');
    show('app');
    await loadData();
  }

  try {
    bindEvents();
    try { session = JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null'); } catch (_) { session = null; }
    if (session?.access_token && session?.refresh_token) {
      start().catch(error => { hide('app'); show('loginScreen'); $('loginError').textContent = error.message; });
    } else {
      sessionStorage.removeItem(SESSION_KEY);
      show('loginScreen');
    }
  } catch (error) {
    document.getElementById('app')?.classList.add('hidden');
    document.getElementById('loginScreen')?.classList.remove('hidden');
    const loginError = document.getElementById('loginError');
    if (loginError) loginError.textContent = error?.message || 'Sales Intelligence could not start.';
  }
})();
