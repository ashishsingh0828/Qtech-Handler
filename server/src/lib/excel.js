import XLSX from 'xlsx';
import {
  canonicalColumnKey,
  fallbackHeaderLabel,
  inferColumnType,
  normalizeGroupKey,
  uniqueKey,
} from '../config/roles.js';
import { asISODate, withStoredDays } from '../../../shared/compute.js';

const MAX_SCAN_COLUMNS = 1024;
const MAX_ROWS = 50000;

function cellRaw(sheet, row, column) {
  const address = XLSX.utils.encode_cell({ r: row, c: column });
  const cell = sheet[address];
  if (!cell || cell.v == null || cell.v === '') return null;
  return cell.v;
}

function cellText(value) {
  if (value == null) return '';
  if (value instanceof Date) return '';
  return String(value).trim();
}

function carriedGroupTitles(sheet, lastCol, merges) {
  const titles = [];
  let current = '';
  for (let column = 0; column <= lastCol; column += 1) {
    let raw = cellText(cellRaw(sheet, 0, column));
    if (!raw) {
      const merge = merges.find((item) => item.s.r === 0 && column >= item.s.c && column <= item.e.c);
      if (merge) raw = cellText(cellRaw(sheet, 0, merge.s.c));
    }
    if (raw) current = raw;
    titles[column] = current;
  }
  return titles;
}

function lastHeaderColumn(sheet) {
  const ref = sheet['!ref'];
  if (!ref) return -1;
  const range = XLSX.utils.decode_range(ref);
  const cap = Math.min(range.e.c, MAX_SCAN_COLUMNS - 1);
  let last = -1;
  for (let column = 0; column <= cap; column += 1) {
    const banner = cellText(cellRaw(sheet, 0, column));
    const header = cellRaw(sheet, 1, column);
    const headerText = header instanceof Date ? 'date' : cellText(header);
    if (banner || headerText) last = column;
  }
  return last;
}

function coerceImported(column, value) {
  if (value == null || value === '') return '';
  if (column.type === 'date') return asISODate(value);
  if (column.type === 'number') {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    const numeric = Number(String(value).replace(/,/g, '').trim());
    return Number.isFinite(numeric) && String(value).trim() !== '' ? numeric : '';
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Number.isInteger(value) ? String(value) : String(value);
  }
  if (value instanceof Date) return asISODate(value);
  return String(value).trim();
}

export function parseWorkbook(buffer) {
  const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    const error = new Error('The workbook has no sheets.');
    error.status = 400;
    error.code = 'EMPTY_WORKBOOK';
    throw error;
  }
  const sheet = workbook.Sheets[sheetName];
  const lastCol = lastHeaderColumn(sheet);
  if (lastCol < 0) {
    const error = new Error('The sheet has no header row.');
    error.status = 400;
    error.code = 'EMPTY_HEADER';
    throw error;
  }
  const merges = sheet['!merges'] || [];
  const titles = carriedGroupTitles(sheet, lastCol, merges);
  const usedKeys = new Set();
  const fallbackCount = new Map();
  const groups = [];
  const groupIndex = new Map();
  const columns = [];

  for (let column = 0; column <= lastCol; column += 1) {
    const groupTitle = titles[column] || 'General';
    const groupKey = normalizeGroupKey(groupTitle) || 'general';
    if (!groupIndex.has(groupKey)) {
      groupIndex.set(groupKey, groups.length);
      groups.push({ key: groupKey, title: groupTitle });
    }
    let label = cellRaw(sheet, 1, column);
    label = label instanceof Date ? '' : cellText(label);
    if (!label) {
      const seen = (fallbackCount.get(groupKey) || 0) + 1;
      fallbackCount.set(groupKey, seen);
      label = fallbackHeaderLabel(groupKey, groupTitle, seen);
    }
    const key = uniqueKey(canonicalColumnKey(label), usedKeys);
    columns.push({
      key,
      label,
      group: groupKey,
      type: inferColumnType(key, label),
    });
  }

  const ref = XLSX.utils.decode_range(sheet['!ref']);
  const records = [];
  for (let row = 2; row <= ref.e.r; row += 1) {
    if (records.length >= MAX_ROWS) {
      const error = new Error(`Workbooks are limited to ${MAX_ROWS} data rows.`);
      error.status = 400;
      error.code = 'ROW_LIMIT';
      throw error;
    }
    const data = {};
    let hasValue = false;
    for (let column = 0; column < columns.length; column += 1) {
      const spec = columns[column];
      const value = coerceImported(spec, cellRaw(sheet, row, column));
      if (value !== '' && value != null) {
        data[spec.key] = value;
        hasValue = true;
      }
    }
    if (!hasValue) continue;
    records.push({ position: records.length + 1, data: withStoredDays(data) });
  }

  return { groups, columns, records };
}

export function buildWorkbook(dataset, rows) {
  const columns = dataset.schema.columns || [];
  const groups = dataset.schema.groups || [];
  const titleByKey = Object.fromEntries(groups.map((group) => [group.key, group.title]));
  const banner = [];
  const headers = columns.map((column) => column.label);
  const merges = [];
  let start = 0;
  columns.forEach((column, index) => {
    const title = titleByKey[column.group] || column.group || '';
    const previous = index === 0 ? null : columns[index - 1];
    if (index === 0) {
      banner.push(title);
      return;
    }
    if (previous.group === column.group) {
      banner.push('');
    } else {
      if (index - 1 > start) {
        merges.push({ s: { r: 0, c: start }, e: { r: 0, c: index - 1 } });
      }
      start = index;
      banner.push(title);
    }
  });
  if (columns.length && columns.length - 1 > start) {
    merges.push({ s: { r: 0, c: start }, e: { r: 0, c: columns.length - 1 } });
  }

  const body = rows.map((row) => columns.map((column) => {
    const value = row.data?.[column.key];
    if (value == null) return '';
    return value;
  }));

  const sheet = XLSX.utils.aoa_to_sheet([banner, headers, ...body]);
  sheet['!merges'] = merges;
  sheet['!cols'] = columns.map((column) => ({
    wch: Math.min(36, Math.max(12, column.label.length + 2)),
  }));
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'Master');
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
}
