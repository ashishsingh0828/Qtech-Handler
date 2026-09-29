export function asISODate(value) {
  if (value == null || value === '') return '';
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const month = String(value.getMonth() + 1).padStart(2, '0');
    const day = String(value.getDate()).padStart(2, '0');
    return `${value.getFullYear()}-${month}-${day}`;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    const serial = Math.floor(value);
    if (serial > 20000 && serial < 80000) {
      const utc = new Date(Date.UTC(1899, 11, 30) + serial * 86400000);
      return utc.toISOString().slice(0, 10);
    }
    return '';
  }
  const text = String(value).trim();
  if (!text) return '';
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
  let match = text.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
  if (match) {
    const day = match[1].padStart(2, '0');
    const month = match[2].padStart(2, '0');
    let year = match[3];
    if (year.length === 2) year = `${Number(year) > 50 ? '19' : '20'}${year}`;
    return `${year}-${month}-${day}`;
  }
  const months = {
    jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
    jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
  };
  match = text.match(/^(\d{1,2})[\s\-\/]+([A-Za-z]{3,})[\s\-\/]+(\d{4})$/);
  if (match && months[match[2].slice(0, 3).toLowerCase()]) {
    return `${match[3]}-${months[match[2].slice(0, 3).toLowerCase()]}-${match[1].padStart(2, '0')}`;
  }
  match = text.match(/^([A-Za-z]{3,})\s+(\d{1,2}),?\s+(\d{4})$/);
  if (match && months[match[1].slice(0, 3).toLowerCase()]) {
    return `${match[3]}-${months[match[1].slice(0, 3).toLowerCase()]}-${match[2].padStart(2, '0')}`;
  }
  return '';
}

export function addDaysISO(iso, days) {
  const [year, month, day] = iso.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function calendarDays(start, end) {
  const startISO = asISODate(start);
  const endISO = asISODate(end);
  if (!startISO || !endISO) return null;
  const [startYear, startMonth, startDay] = startISO.split('-').map(Number);
  const [endYear, endMonth, endDay] = endISO.split('-').map(Number);
  const ms = Date.UTC(endYear, endMonth - 1, endDay) - Date.UTC(startYear, startMonth - 1, startDay);
  return Math.round(ms / 86400000);
}

export function warrantyStatus(endDate, today) {
  const end = asISODate(endDate);
  if (!end) {
    return { label: '—', tone: 'stone', due: false, active: false, expired: false };
  }
  if (end < today) {
    return { label: 'AMC Due', tone: 'ruby', due: true, active: false, expired: true };
  }
  if (end <= addDaysISO(today, 30)) {
    return { label: 'Expiring in 30 days', tone: 'amber', due: false, active: true, expired: false };
  }
  return { label: 'Active', tone: 'emerald', due: false, active: true, expired: false };
}

function completionKey(index, columnKeys) {
  const hasPlain = !columnKeys || columnKeys.has('pm_date');
  const hasIndexedFirst = columnKeys?.has('pm_date_1');
  if (!hasPlain && hasIndexedFirst) return `pm_date_${index}`;
  return index === 1 ? 'pm_date' : `pm_date_${index - 1}`;
}

export function computeNextDuePms(data, today, columns) {
  const columnKeys = columns ? new Set(columns.map((column) => column.key)) : null;
  const pending = [];
  let scheduledAny = false;
  for (let index = 1; index <= 15; index += 1) {
    const scheduled = asISODate(data?.[`pms_${index}`]);
    if (!scheduled && data?.[`pms_${index}`]) scheduledAny = true;
    if (!scheduled) continue;
    scheduledAny = true;
    const done = asISODate(data?.[completionKey(index, columnKeys)]);
    if (!done) pending.push({ index, date: scheduled });
  }
  if (!pending.length) {
    return { label: scheduledAny ? 'Complete' : '—', tone: 'stone', index: null, date: '' };
  }
  pending.sort((left, right) => left.date.localeCompare(right.date) || left.index - right.index);
  const next = pending[0];
  let tone = 'stone';
  if (next.date < today) tone = 'ruby';
  else if (next.date <= addDaysISO(today, 15)) tone = 'amber';
  return { label: next.date, tone, index: next.index, date: next.date };
}

export function withStoredDays(data) {
  const next = { ...(data || {}) };
  const days = calendarDays(next.start_date, next.end_date);
  if (days == null) delete next.days;
  else next.days = days;
  return next;
}

export function presentComputation(data, today, columns) {
  const days = calendarDays(data?.start_date, data?.end_date);
  const warranty = warrantyStatus(data?.end_date, today);
  const nextDuePms = computeNextDuePms(data, today, columns);
  return { days, warranty, nextDuePms };
}

export function amcTransition(currentState, action, warranty) {
  const state = currentState || '';
  if (action === 'proposal_sent') {
    if (!warranty?.due) {
      return { error: 'A proposal can be sent only when the contract is AMC Due.' };
    }
    if (state === 'proposal_sent' || state === 'acknowledged') {
      return { error: 'A proposal is already in progress for this record.' };
    }
    return { state: 'proposal_sent' };
  }
  if (action === 'acknowledge' || action === 'decline') {
    if (state !== 'proposal_sent') {
      return { error: 'Acknowledge or decline is available after a proposal has been sent.' };
    }
    return { state: action === 'acknowledge' ? 'acknowledged' : 'declined' };
  }
  return { error: 'Unknown AMC action.' };
}
