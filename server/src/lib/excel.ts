import XLSX from 'xlsx';
import {
  canonicalColumnKey,
  fallbackHeaderLabel,
  inferColumnType,
  normalizeGroupKey,
  semanticTagFor,
  uniqueKey,
  SERVER_FIELDS,
} from '../../../shared/permissions.ts';
import { parseDate } from '../../../shared/dates.ts';
import type { CellMap } from '../../../shared/metrics.ts';

const MAX_SCAN_COLUMNS = 1024;
const MAX_ROWS = 200000;
const PROTECTED = new Set<string>(SERVER_FIELDS);
const INTEGER_KEYS = new Set(['sr_no', 'month', 'year', 'days']);
const TEXT_KEYS = new Set(['serial_no', 'mobile_no']);
const PLACEHOLDER = /^(na|n\/a|n\.a\.?|-|—)$/i;

export interface ParsedColumn {
  key: string;
  label: string;
  groupKey: string;
  groupTitle: string;
  dataType: 'text' | 'number' | 'date';
  semanticTag: string | null;
  displayOrder: number;
  isSystem: boolean;
}

export interface ParsedRecord {
  data: CellMap;
  serialNo: string | null;
  customerName: string | null;
  equipmentName: string | null;
}

export interface ParsedWorkbook {
  groups: { key: string; title: string }[];
  columns: ParsedColumn[];
  records: ParsedRecord[];
}

export interface ExportCall {
  position: number;
  customerName: string | null;
  serialNo: string | null;
  type: string;
  description: string;
  status: string;
  reportedAt: Date;
  resolvedAt: Date | null;
  note: string | null;
}

type WorkSheet = XLSX.WorkSheet;

interface GridCell {
  v: unknown;
  w?: string;
}

interface SheetIndex {
  rows: Map<number, Map<number, GridCell>>;
  valued: number;
}

function fail(status: number, message: string, code: string): Error {
  const error = new Error(message);
  (error as Error & { status?: number; code?: string }).status = status;
  (error as Error & { code?: string }).code = code;
  return error;
}

function cleanLabel(value: string): string {
  return value.replace(/\s+/g, ' ').trim().replace(/:$/, '').trim();
}

function valueText(value: unknown): string {
  if (value == null || value instanceof Date) return '';
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Number.isInteger(value) ? String(value) : String(value);
  }
  return cleanLabel(String(value));
}

function classifySubheader(value: unknown): 'date' | 'number' | 'email' | 'phone' | 'data' | 'empty' | 'header' {
  if (value instanceof Date) return 'date';
  if (typeof value === 'number' && Number.isFinite(value)) return 'number';
  const text = valueText(value);
  if (!text) return 'empty';
  if (text.includes('@')) return 'email';
  if (/^\d{4}-\d{2}-\d{2}(?:[tT\s].*)?$/.test(text)) return 'date';
  if (/^\d{1,2}[/.\\-]\d{1,2}[/.\\-]\d{2,4}$/.test(text)) return 'date';
  const digits = text.replace(/\D/g, '');
  if (/^\+?[\d\s().-]{8,}$/.test(text) && digits.length >= 8 && digits.length <= 15) return 'phone';
  if (/^-?\d[\d,]*(\.\d+)?$/.test(text)) return 'number';
  if (text.length > 48) return 'data';
  return 'header';
}

function subheaderLabel(value: unknown, groupKey: string, groupTitle: string, counters: Map<string, number>): string {
  const kind = classifySubheader(value);
  if (kind === 'header') return valueText(value);
  const bucket = kind === 'empty' ? 'empty' : kind === 'email' ? 'email' : 'detail';
  const seen = (counters.get(`${groupKey}:${bucket}`) || 0) + 1;
  counters.set(`${groupKey}:${bucket}`, seen);
  if (kind === 'email') return seen === 1 ? 'Email' : `Email ${seen}`;
  if (kind === 'empty') return fallbackHeaderLabel(groupKey, groupTitle, seen);
  return `Detail ${seen}`;
}

function autoName(groupTitle: string, index: number, total: number): string {
  const cleaned = cleanLabel(groupTitle) || 'Field';
  if (total === 1) return cleaned;
  const stem = cleaned.split(/[/(]/)[0]?.trim() || cleaned;
  return `${stem} ${index}`;
}

function indexSheet(sheet: WorkSheet): SheetIndex {
  const rows = new Map<number, Map<number, GridCell>>();
  let valued = 0;
  for (const key of Object.keys(sheet)) {
    if (key.startsWith('!')) continue;
    const cell = sheet[key] as XLSX.CellObject | undefined;
    if (!cell || cell.v == null || cell.v === '') continue;
    let pos: XLSX.CellAddress;
    try {
      pos = XLSX.utils.decode_cell(key);
    } catch {
      continue;
    }
    if (pos.c >= MAX_SCAN_COLUMNS || pos.r < 0) continue;
    let line = rows.get(pos.r);
    if (!line) {
      line = new Map();
      rows.set(pos.r, line);
    }
    line.set(pos.c, { v: cell.v, w: typeof cell.w === 'string' ? cell.w : undefined });
    valued += 1;
  }
  return { rows, valued };
}

function occupiedRows(index: SheetIndex): number[] {
  return [...index.rows.keys()].filter((row) => (index.rows.get(row)?.size || 0) > 0).sort((a, b) => a - b);
}

function isFlat(index: SheetIndex, merges: NonNullable<WorkSheet['!merges']>): boolean {
  if (merges.some((merge) => merge.s.r === 0 && merge.e.c > merge.s.c)) return false;
  const rows = occupiedRows(index);
  if (rows.length < 2) return true;
  const first = index.rows.get(rows[0])?.size || 0;
  const next = index.rows.get(rows[1])?.size || 0;
  return first >= next;
}

function lastUsedColumn(index: SheetIndex, headerRow: number, bannerRow: number | null, merges: NonNullable<WorkSheet['!merges']>): number {
  let last = -1;
  const header = index.rows.get(headerRow);
  if (header) {
    for (const column of header.keys()) {
      const kind = classifySubheader(header.get(column)?.v);
      if (bannerRow == null || kind === 'header') last = Math.max(last, column);
    }
  }
  if (bannerRow == null) return last;
  const banner = index.rows.get(bannerRow);
  if (banner) {
    for (const column of banner.keys()) last = Math.max(last, column);
  }
  for (const merge of merges) {
    if (merge.s.r > bannerRow || merge.e.r < bannerRow) continue;
    const origin = banner?.get(merge.s.c);
    if (origin && valueText(origin.v)) last = Math.max(last, Math.min(merge.e.c, MAX_SCAN_COLUMNS - 1));
  }
  if (header) {
    for (const column of header.keys()) {
      if (column <= last) continue;
      if (classifySubheader(header.get(column)?.v) === 'header') last = column;
    }
  }
  return last;
}

function carriedTitles(index: SheetIndex, lastCol: number, merges: NonNullable<WorkSheet['!merges']>): string[] {
  const titles: string[] = [];
  const banner = index.rows.get(0);
  let current = '';
  for (let column = 0; column <= lastCol; column += 1) {
    let raw = valueText(banner?.get(column)?.v);
    if (!raw) {
      const merge = merges.find((item) => item.s.r === 0 && column >= item.s.c && column <= item.e.c);
      if (merge) raw = valueText(banner?.get(merge.s.c)?.v);
    }
    if (raw) current = raw;
    titles[column] = current;
  }
  return titles;
}

function plainText(cell: GridCell): string {
  const formatted = cell.w?.trim();
  if (formatted && !/[eE][+]?\d/.test(formatted)) {
    const stripped = formatted.replace(/,/g, '').trim();
    if (/^-?\d+\.0+$/.test(stripped)) return stripped.replace(/\.0+$/, '');
    return stripped;
  }
  if (typeof cell.v === 'number' && Number.isFinite(cell.v)) {
    if (Number.isInteger(cell.v)) return String(cell.v);
    const rounded = Math.round(cell.v);
    if (Math.abs(cell.v - rounded) < 1e-6) return String(rounded);
    return String(cell.v);
  }
  if (cell.v instanceof Date) return '';
  const text = String(cell.v ?? '').trim();
  if (/^-?\d+\.0+$/.test(text)) return text.replace(/\.0+$/, '');
  return text;
}

function asInteger(cell: GridCell): number | null {
  if (typeof cell.v === 'number' && Number.isFinite(cell.v)) return Math.trunc(cell.v);
  const text = plainText(cell).replace(/,/g, '');
  if (!/^-?\d+(\.0+)?$/.test(text)) return null;
  const numeric = Number(text);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : null;
}

function asDecimal(cell: GridCell): number | null {
  if (typeof cell.v === 'number' && Number.isFinite(cell.v)) return cell.v;
  const text = plainText(cell).replace(/,/g, '');
  if (!text) return null;
  const numeric = Number(text);
  return Number.isFinite(numeric) ? numeric : null;
}

function isDateColumn(column: ParsedColumn): boolean {
  return column.dataType === 'date'
    || /^pms_\d+$/.test(column.key)
    || /^pm_date(_\d+)?$/.test(column.key)
    || column.key.endsWith('_date')
    || column.key.endsWith('_due')
    || column.key === 'next_follow_up';
}

function coerce(column: ParsedColumn, cell: GridCell | undefined): string | number | null {
  if (!cell) return null;
  if (cell.v == null || cell.v === '') return null;
  if (TEXT_KEYS.has(column.key) || column.key.includes('serial') || column.key === 'mobile_no') {
    const text = plainText(cell);
    return text || null;
  }
  if (INTEGER_KEYS.has(column.key)) return asInteger(cell);
  if (isDateColumn(column)) {
    const text = plainText(cell);
    if (PLACEHOLDER.test(text)) return text.toLowerCase() === 'na' ? 'NA' : text;
    const parsed = parseDate(cell.v);
    if (parsed) return parsed;
    return text || null;
  }
  if (column.dataType === 'number') return asDecimal(cell);
  const text = plainText(cell);
  return text || null;
}

function readWorkbook(buffer: Buffer): XLSX.WorkBook {
  try {
    return XLSX.read(buffer, { type: 'buffer', cellDates: true, cellText: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (/password|encrypt/i.test(message)) {
      throw fail(400, 'This workbook is password-protected. Remove the password and upload it again.', 'PROTECTED');
    }
    throw fail(400, 'This file is not a readable Excel workbook.', 'CORRUPT');
  }
}

export function parseWorkbook(buffer: Buffer): ParsedWorkbook {
  const workbook = readWorkbook(buffer);
  let chosen: { sheet: WorkSheet; index: SheetIndex } | null = null;
  for (const name of workbook.SheetNames) {
    const sheet = workbook.Sheets[name] as WorkSheet | undefined;
    if (!sheet) continue;
    const index = indexSheet(sheet);
    if (!chosen || index.valued > chosen.index.valued) chosen = { sheet, index };
  }
  if (!chosen || chosen.index.valued === 0) throw fail(400, 'The workbook has no data.', 'EMPTY_WORKBOOK');
  const merges = chosen.sheet['!merges'] || [];
  const flat = isFlat(chosen.index, merges);
  const rows = occupiedRows(chosen.index);
  const headerRow = flat ? rows[0] : 1;
  const bannerRow = flat ? null : 0;
  const lastCol = lastUsedColumn(chosen.index, headerRow, bannerRow, merges);
  if (lastCol < 0) throw fail(400, 'The sheet has no header row.', 'EMPTY_HEADER');
  const titles = flat ? [] : carriedTitles(chosen.index, lastCol, merges);
  const headerLine = chosen.index.rows.get(headerRow);
  const used = new Set<string>();
  const counters = new Map<string, number>();
  const groups: { key: string; title: string }[] = [];
  const seenGroups = new Set<string>();
  const drafts: { column: number; groupKey: string; groupTitle: string; blank: boolean; label: string }[] = [];
  for (let column = 0; column <= lastCol; column += 1) {
    const groupTitle = flat ? 'General' : (titles[column] || 'General');
    const groupKey = flat ? 'general' : (normalizeGroupKey(groupTitle) || 'general');
    if (!seenGroups.has(groupKey)) {
      seenGroups.add(groupKey);
      groups.push({ key: groupKey, title: groupTitle });
    }
    const cell = headerLine?.get(column);
    const kind = classifySubheader(cell?.v);
    const blank = !cell || kind === 'empty';
    drafts.push({
      column,
      groupKey,
      groupTitle,
      blank,
      label: blank ? '' : subheaderLabel(cell?.v, groupKey, groupTitle, counters),
    });
  }
  const blanksByGroup = new Map<string, number>();
  for (const draft of drafts) {
    if (!draft.blank) continue;
    blanksByGroup.set(draft.groupKey, (blanksByGroup.get(draft.groupKey) || 0) + 1);
  }
  const blankSeen = new Map<string, number>();
  const columns: ParsedColumn[] = [];
  for (const draft of drafts) {
    let label = draft.label;
    if (draft.blank) {
      const total = blanksByGroup.get(draft.groupKey) || 1;
      const seen = (blankSeen.get(draft.groupKey) || 0) + 1;
      blankSeen.set(draft.groupKey, seen);
      label = autoName(draft.groupTitle, seen, total);
    }
    const key = uniqueKey(canonicalColumnKey(label), used);
    const dataType = inferColumnType(key, label);
    columns.push({
      key,
      label,
      groupKey: draft.groupKey,
      groupTitle: draft.groupTitle,
      dataType,
      semanticTag: semanticTagFor(key),
      displayOrder: draft.column,
      isSystem: PROTECTED.has(key),
    });
  }
  const dataRows = rows.filter((row) => row > headerRow);
  const records: ParsedRecord[] = [];
  for (const row of dataRows) {
    if (records.length >= MAX_ROWS) throw fail(400, `Workbooks are limited to ${MAX_ROWS} data rows.`, 'ROW_LIMIT');
    const line = chosen.index.rows.get(row);
    const data: CellMap = {};
    let hasValue = false;
    for (let column = 0; column < columns.length; column += 1) {
      const spec = columns[column];
      const value = coerce(spec, line?.get(column));
      if (value != null && value !== '') {
        data[spec.key] = value;
        hasValue = true;
      }
    }
    if (!hasValue) continue;
    records.push({
      data,
      serialNo: data.serial_no == null ? null : String(data.serial_no),
      customerName: data.customer_name == null ? null : String(data.customer_name),
      equipmentName: data.equipment_name == null ? null : String(data.equipment_name),
    });
  }
  if (!records.length) throw fail(400, 'The workbook has no data rows.', 'NO_DATA');
  return { groups, columns, records };
}

function exportValue(column: ParsedColumn, value: string | number | null | undefined): string | number | Date {
  if (value == null || value === '') return '';
  if (isDateColumn(column)) {
    if (typeof value === 'string' && PLACEHOLDER.test(value.trim())) return value;
    const iso = parseDate(value);
    if (!iso) return typeof value === 'number' ? value : String(value);
    const [year, month, day] = iso.split('-').map(Number);
    return new Date(Date.UTC(year, month - 1, day));
  }
  if (TEXT_KEYS.has(column.key) || column.key.includes('serial')) return String(value);
  return value;
}

export function buildWorkbook(columns: ParsedColumn[], rows: CellMap[], calls: ExportCall[] = []): Buffer {
  const banner: string[] = [];
  const headers = columns.map((column) => column.label);
  const merges: { s: { r: number; c: number }; e: { r: number; c: number } }[] = [];
  let start = 0;
  columns.forEach((column, index) => {
    const previous = index === 0 ? null : columns[index - 1];
    if (index === 0) {
      banner.push(column.groupTitle);
      return;
    }
    if (previous && previous.groupKey === column.groupKey) banner.push('');
    else {
      if (index - 1 > start) merges.push({ s: { r: 0, c: start }, e: { r: 0, c: index - 1 } });
      start = index;
      banner.push(column.groupTitle);
    }
  });
  if (columns.length && columns.length - 1 > start) {
    merges.push({ s: { r: 0, c: start }, e: { r: 0, c: columns.length - 1 } });
  }
  const body = rows.map((row) => columns.map((column) => exportValue(column, row[column.key] ?? null)));
  const sheet = XLSX.utils.aoa_to_sheet([banner, headers, ...body], { cellDates: true });
  sheet['!merges'] = merges;
  for (let row = 2; row < body.length + 2; row += 1) {
    columns.forEach((column, columnIndex) => {
      if (!isDateColumn(column)) return;
      const address = XLSX.utils.encode_cell({ r: row, c: columnIndex });
      const cell = sheet[address] as XLSX.CellObject | undefined;
      if (cell && (cell.t === 'd' || cell.t === 'n')) cell.z = 'dd-mmm-yyyy';
    });
  }
  sheet['!cols'] = columns.map((column, index) => {
    let width = Math.max(column.label.length, column.groupTitle.length);
    for (const line of body.slice(0, 200)) {
      const entry = line[index];
      const text = entry instanceof Date ? '07 Apr 2023' : String(entry ?? '');
      width = Math.max(width, text.length);
    }
    return { wch: Math.min(40, Math.max(8, width + 1)) };
  });
  let pin = 0;
  for (const column of columns) {
    if (pin >= 3) break;
    if (column.key === 'sr_no' || column.key === 'customer_name' || column.key === 'serial_no') pin += 1;
    else break;
  }
  const lastColumn = XLSX.utils.encode_col(Math.max(columns.length - 1, 0));
  const lastRow = Math.max(2, body.length + 2);
  sheet['!autofilter'] = { ref: `A2:${lastColumn}${lastRow}` };
  sheet['!views'] = [{
    state: 'frozen',
    xSplit: pin,
    ySplit: 2,
    topLeftCell: `${XLSX.utils.encode_col(pin)}3`,
    activeCell: `${XLSX.utils.encode_col(pin)}3`,
  }];
  const callRows = calls.map((call) => [
    call.position,
    call.customerName || '',
    call.serialNo || '',
    call.type,
    call.description,
    call.status,
    call.reportedAt,
    call.resolvedAt || '',
    call.note || '',
  ]);
  const callsSheet = XLSX.utils.aoa_to_sheet([
    ['Position', 'Customer', 'Serial', 'Type', 'Description', 'Status', 'Reported', 'Resolved', 'Note'],
    ...callRows,
  ], { cellDates: true });
  callsSheet['!cols'] = [12, 28, 18, 18, 36, 14, 20, 20, 28].map((wch) => ({ wch }));
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, 'Master');
  XLSX.utils.book_append_sheet(book, callsSheet, 'Service Calls');
  return XLSX.write(book, { type: 'buffer', bookType: 'xlsx', cellDates: true }) as Buffer;
}

export function buildCsv(columns: ParsedColumn[], rows: CellMap[]): string {
  const headers = columns.map((column) => column.label);
  const body = rows.map((row) => columns.map((column) => {
    const value = row[column.key];
    return value == null ? '' : value;
  }));
  return XLSX.utils.sheet_to_csv(XLSX.utils.aoa_to_sheet([headers, ...body]));
}

export function sourceKeys(columns: ParsedColumn[]): Set<string> {
  return new Set(columns.filter((column) => !PROTECTED.has(column.key)).map((column) => column.key));
}
