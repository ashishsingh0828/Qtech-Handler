const NON_DATES = new Set([
  'na', 'n/a', 'n.a', 'done', '-', '—', 'pending', 'nil', 'none', 'null', 'tbd', 'tba',
]);

const MONTHS: Record<string, string> = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
  jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
};

export function parseDate(value: unknown): string | null {
  if (value == null) return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    const month = String(value.getUTCMonth() + 1).padStart(2, '0');
    const day = String(value.getUTCDate()).padStart(2, '0');
    return `${value.getUTCFullYear()}-${month}-${day}`;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    const serial = Math.floor(value);
    if (serial > 20000 && serial < 80000) {
      const utc = new Date(Date.UTC(1899, 11, 30) + serial * 86400000);
      return utc.toISOString().slice(0, 10);
    }
    return null;
  }
  const text = String(value).trim();
  if (!text || NON_DATES.has(text.toLowerCase())) return null;
  if (/^\d{4,6}(\.\d+)?$/.test(text)) return parseDate(Number(text));
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) {
    const iso = text.slice(0, 10);
    return isRealDate(iso) ? iso : null;
  }
  let match = text.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
  if (match) {
    const day = match[1].padStart(2, '0');
    const month = match[2].padStart(2, '0');
    let year = match[3];
    if (year.length === 2) year = `${Number(year) > 50 ? '19' : '20'}${year}`;
    const iso = `${year}-${month}-${day}`;
    return isRealDate(iso) ? iso : null;
  }
  match = text.match(/^(\d{1,2})[\s\-/]+([A-Za-z]{3,})[\s\-/]+(\d{4})$/);
  if (match && MONTHS[match[2].slice(0, 3).toLowerCase()]) {
    const iso = `${match[3]}-${MONTHS[match[2].slice(0, 3).toLowerCase()]}-${match[1].padStart(2, '0')}`;
    return isRealDate(iso) ? iso : null;
  }
  match = text.match(/^([A-Za-z]{3,})\s+(\d{1,2}),?\s+(\d{4})$/);
  if (match && MONTHS[match[1].slice(0, 3).toLowerCase()]) {
    const iso = `${match[3]}-${MONTHS[match[1].slice(0, 3).toLowerCase()]}-${match[2].padStart(2, '0')}`;
    return isRealDate(iso) ? iso : null;
  }
  return null;
}

function isRealDate(iso: string): boolean {
  const [year, month, day] = iso.split('-').map(Number);
  if (!year || !month || !day) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function addDays(iso: string, days: number): string {
  const [year, month, day] = iso.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function calendarDays(start: unknown, end: unknown): number | null {
  const startISO = parseDate(start);
  const endISO = parseDate(end);
  if (!startISO || !endISO) return null;
  const [startYear, startMonth, startDay] = startISO.split('-').map(Number);
  const [endYear, endMonth, endDay] = endISO.split('-').map(Number);
  const ms = Date.UTC(endYear, endMonth - 1, endDay) - Date.UTC(startYear, startMonth - 1, startDay);
  return Math.round(ms / 86400000);
}

export function todayInZone(timeZone: string, now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
  return parts.slice(0, 10);
}

export function businessDateLabel(timeZone: string, now = new Date()): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(now);
}
