(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.KSDLChannelInsights = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  const DAY_MS = 86400000;

  function clean(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function key(value) {
    return clean(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  }

  function customerName(value) {
    const source = clean(value);
    const normalized = key(source);
    if (/\b(dmart|avenue supermarts?)\b/.test(normalized)) return 'DMart';
    if (/\b(blinkit|hands on trades?)\b/.test(normalized)) return 'Blinkit';
    if (/\bzepto\b/.test(normalized)) return 'Zepto';
    if (/\b(big ?basket|innovative retail)\b/.test(normalized)) return 'BigBasket';
    if (/\b(reliance|rrl|reliance retail)\b/.test(normalized)) return 'Reliance';
    if (/\b(swiggy|scootsy|swiggy instamart)\b/.test(normalized)) return 'Swiggy';
    return source || 'Customer pending';
  }

  function channelName(customer) {
    return ['DMart', 'Reliance'].includes(customerName(customer)) ? 'Store' : 'E-commerce';
  }

  function dateValue(value) {
    const parts = String(value || '').slice(0, 10).split('-').map(Number);
    if (parts.length !== 3 || parts.some(part => !Number.isFinite(part))) return null;
    return new Date(parts[0], parts[1] - 1, parts[2]);
  }

  function isoDate(date) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }

  function addDays(value, days) {
    const date = value instanceof Date ? new Date(value) : dateValue(value);
    if (!date) return null;
    date.setDate(date.getDate() + Number(days || 0));
    return date;
  }

  function differenceDays(later, earlier) {
    const end = later instanceof Date ? later : dateValue(later);
    const start = earlier instanceof Date ? earlier : dateValue(earlier);
    return end && start ? Math.round((end - start) / DAY_MS) : null;
  }

  function orderDate(row) {
    return String(row.po_date || row.po_received_date || '').slice(0, 10);
  }

  function rowValue(row) {
    const invoice = Number(row.invoice_amount || 0);
    return invoice > 0 ? invoice : Number(row.po_value || 0);
  }

  function isCancelled(row) {
    return /cancel/i.test(String(row.status || ''));
  }

  function isDelivered(row) {
    return Boolean(row.delivery_completed_date) || /^delivered$/i.test(String(row.status || ''));
  }

  function isOpen(row) {
    return !isCancelled(row) && !isDelivered(row);
  }

  function normalize(row) {
    const customer = customerName(row.customer_name);
    return {
      ...row,
      customer,
      channel: channelName(customer),
      business_date: orderDate(row),
      business_value: rowValue(row),
      delivered: isDelivered(row),
      open: isOpen(row),
      cancelled: isCancelled(row)
    };
  }

  function activeRows(rows) {
    return (Array.isArray(rows) ? rows : []).map(normalize).filter(row => !row.cancelled && row.business_date);
  }

  function average(values) {
    const usable = values.filter(value => Number.isFinite(value));
    return usable.length ? usable.reduce((total, value) => total + value, 0) / usable.length : null;
  }

  function growth(current, previous) {
    if (previous > 0) return (current - previous) / previous * 100;
    return current > 0 ? null : 0;
  }

  function periodRows(rows, days, todayValue) {
    const today = dateValue(todayValue) || new Date();
    if (!Number(days)) return rows;
    const start = addDays(today, -Number(days) + 1);
    return rows.filter(row => {
      const date = dateValue(row.business_date);
      return date && date >= start && date <= today;
    });
  }

  function previousPeriodRows(rows, days, todayValue) {
    if (!Number(days)) return [];
    const today = dateValue(todayValue) || new Date();
    const end = addDays(today, -Number(days));
    const start = addDays(end, -Number(days) + 1);
    return rows.filter(row => {
      const date = dateValue(row.business_date);
      return date && date >= start && date <= end;
    });
  }

  function summarize(rows, previousRows) {
    const delivered = rows.filter(row => row.delivered);
    const open = rows.filter(row => row.open);
    const completionDays = delivered.map(row => differenceDays(row.delivery_completed_date, row.business_date));
    const appointmentRows = delivered.filter(row => row.delivery_date && row.delivery_completed_date);
    const appointmentHits = appointmentRows.filter(row => String(row.delivery_completed_date) <= String(row.delivery_date)).length;
    const value = rows.reduce((total, row) => total + row.business_value, 0);
    const previousValue = previousRows.reduce((total, row) => total + row.business_value, 0);
    const invoiceValue = rows.reduce((total, row) => total + Number(row.invoice_amount || 0), 0);
    return {
      poCount: rows.length,
      value,
      invoiceValue,
      averageOrder: rows.length ? value / rows.length : 0,
      deliveredCount: delivered.length,
      deliveryRate: rows.length ? delivered.length / rows.length * 100 : 0,
      openCount: open.length,
      openValue: open.reduce((total, row) => total + row.business_value, 0),
      averageCompletionDays: average(completionDays),
      appointmentRate: appointmentRows.length ? appointmentHits / appointmentRows.length * 100 : null,
      appointmentSamples: appointmentRows.length,
      growth: growth(value, previousValue),
      previousValue,
      lastPoDate: rows.map(row => row.business_date).sort().pop() || ''
    };
  }

  function analyse(rows, days, todayValue) {
    const all = activeRows(rows);
    const current = periodRows(all, days, todayValue);
    const previous = previousPeriodRows(all, days, todayValue);
    const byChannel = {};
    ['Store', 'E-commerce'].forEach(channel => {
      byChannel[channel] = summarize(
        current.filter(row => row.channel === channel),
        previous.filter(row => row.channel === channel)
      );
    });
    const customers = [...new Set(current.map(row => row.customer))].map(customer => ({
      customer,
      channel: channelName(customer),
      ...summarize(
        current.filter(row => row.customer === customer),
        previous.filter(row => row.customer === customer)
      )
    })).sort((left, right) => right.value - left.value || left.customer.localeCompare(right.customer));
    return { all, current, previous, byChannel, customers, periodDays: Number(days) || 0 };
  }

  function cadenceGroups(rows, channel) {
    const all = activeRows(rows).filter(row => !channel || row.channel === channel);
    const groups = new Map();
    all.forEach(row => {
      const location = clean(row.delivery_location) || 'Location pending';
      const groupKey = `${row.customer}|||${location}`;
      if (!groups.has(groupKey)) groups.set(groupKey, { customer: row.customer, channel: row.channel, location, rows: [] });
      groups.get(groupKey).rows.push(row);
    });
    return [...groups.values()].map(group => {
      const dates = [...new Set(group.rows.map(row => row.business_date).filter(Boolean))].sort();
      const gaps = dates.slice(1).map((date, index) => differenceDays(date, dates[index])).filter(value => value != null && value >= 0);
      const averageGap = average(gaps);
      const lastPoDate = dates[dates.length - 1] || '';
      const nextExpectedDate = averageGap == null ? null : addDays(lastPoDate, Math.round(averageGap));
      const openRows = group.rows.filter(row => row.open);
      const upcomingAppointments = openRows.filter(row => row.delivery_date).sort((a, b) => String(a.delivery_date).localeCompare(String(b.delivery_date)));
      return {
        ...group,
        poCount: group.rows.length,
        lastPoDate,
        averageGap,
        nextExpectedDate: isoDate(nextExpectedDate),
        openCount: openRows.length,
        openValue: openRows.reduce((total, row) => total + row.business_value, 0),
        nextAppointment: upcomingAppointments[0]?.delivery_date || '',
        missingAppointmentCount: openRows.filter(row => !row.delivery_date).length
      };
    });
  }

  function ecomActions(rows, horizonDays, todayValue) {
    const today = dateValue(todayValue) || new Date();
    const horizon = Number(horizonDays || 14);
    const thirty = analyse(rows, 30, isoDate(today));
    const customerTrend = new Map(thirty.customers.map(customer => [customer.customer, customer.growth]));
    const actions = [];
    cadenceGroups(rows, 'E-commerce').forEach(group => {
      const expectedTiming = group.nextExpectedDate ? differenceDays(group.nextExpectedDate, today) : null;
      const appointmentTiming = group.nextAppointment ? differenceDays(group.nextAppointment, today) : null;
      const accountGrowth = customerTrend.get(group.customer);
      if (group.openCount && appointmentTiming != null && appointmentTiming < 0) {
        actions.push({ priority: 'Urgent', score: 100 + Math.abs(appointmentTiming), channel: group.channel, customer: group.customer, location: group.location, signal: 'Appointment passed', evidence: `${group.openCount} open PO(s); appointment was ${Math.abs(appointmentTiming)} day(s) ago`, action: 'Confirm whether delivery or GRN is pending. Correct the appointment or escalate the receiving status today.' });
      } else if (group.openCount && group.missingAppointmentCount) {
        actions.push({ priority: 'High', score: 92 + group.missingAppointmentCount, channel: group.channel, customer: group.customer, location: group.location, signal: 'Appointment needed', evidence: `${group.missingAppointmentCount} of ${group.openCount} open PO(s) have no appointment`, action: 'Book or confirm the appointment, then keep invoice and stock ready for dispatch.' });
      } else if (group.openCount && appointmentTiming != null && appointmentTiming <= horizon) {
        actions.push({ priority: 'Plan', score: 80 - Math.max(appointmentTiming, 0), channel: group.channel, customer: group.customer, location: group.location, signal: 'Dispatch upcoming', evidence: `${group.openCount} open PO(s); next appointment in ${Math.max(appointmentTiming, 0)} day(s)`, action: 'Confirm invoice, stock and transport one working day before the appointment.' });
      } else if (!group.openCount && expectedTiming != null && expectedTiming <= 0) {
        actions.push({ priority: 'High', score: 72 + Math.abs(expectedTiming), channel: group.channel, customer: group.customer, location: group.location, signal: 'PO cycle overdue', evidence: `${Math.abs(expectedTiming)} day(s) beyond the ${Math.round(group.averageGap)}-day average cycle`, action: 'Contact the account buyer and ask for the next PO or the reason for the order gap.' });
      } else if (!group.openCount && Number.isFinite(accountGrowth) && accountGrowth <= -20) {
        actions.push({ priority: 'Watch', score: 55 + Math.abs(accountGrowth), channel: group.channel, customer: group.customer, location: group.location, signal: 'Value declining', evidence: `Latest 30-day account value is ${Math.abs(accountGrowth).toFixed(0)}% below the previous period`, action: 'Review PO frequency, fill rate, appointment failures and missing KSDL articles with the account.' });
      }
    });
    return actions.sort((left, right) => right.score - left.score || left.customer.localeCompare(right.customer));
  }

  return {
    addDays,
    analyse,
    cadenceGroups,
    channelName,
    customerName,
    dateValue,
    differenceDays,
    ecomActions,
    isoDate,
    normalize,
    rowValue
  };
});
