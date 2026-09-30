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
const MAX_ROWS = 50000;
const PROTECTED = new Set<string>(SERVER_FIELDS);

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

type WorkSheet = XLSX.WorkSheet;

function cellRaw(sheet: WorkSheet, row: number, column: number): unknown {
  const address = XLSX.utils.encode_cell({ r: row, c: column });
  const cell = sheet[address] as XLSX.CellObject | undefined;
  if (!cell || cell.v == null || cell.v === '') return null;
  return cell.v;
}

function cellText(value: unknown): string {
  if (value == null || value instanceof Date) return '';
  return String(value).trim();
}

function classifySubheader(value: unknown): 'date' | 'number' | 'email' | 'phone' | 'data' | 'empty' | 'header' {
  if (value instanceof Date) return 'date';
  if (typeof value === 'number' && Number.isFinite(value)) return 'number';
  const text = cellText(value);
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
  if (kind === 'header') return cellText(value);
  const bucket = kind === 'empty' ? 'empty' : kind === 'email' ? 'email' : 'detail';
  const seen = (counters.get(`${groupKey}:${bucket}`) || 0) + 1;
  counters.set(`${groupKey}:${bucket}`, seen);
  if (kind === 'email') return seen === 1 ? 'Email' : `Email ${seen}`;
  if (kind === 'empty') return fallbackHeaderLabel(groupKey, groupTitle, seen);
  return `Detail ${seen}`;
}

function bannerCovers(sheet: WorkSheet, column: number, merges: NonNullable<WorkSheet['!merges']>): boolean {
  if (cellText(cellRaw(sheet, 0, column))) return true;
  const merge = merges.find((item) => item.s.r === 0 && column >= item.s.c && column <= item.e.c);
  return Boolean(merge && cellText(cellRaw(sheet, 0, merge.s.c)));
}

function lastHeaderColumn(sheet: WorkSheet): number {
  if (!sheet['!ref']) return -1;
  const range = XLSX.utils.decode_range(sheet['!ref']);
  const cap = Math.min(range.e.c, MAX_SCAN_COLUMNS - 1);
  const merges = sheet['!merges'] || [];
  let last = -1;
  for (let column = 0; column <= cap; column += 1) {
    const kind = classifySubheader(cellRaw(sheet, 1, column));
    if (bannerCovers(sheet, column, merges) || kind === 'header') last = column;
  }
  return last;
}

function carriedTitles(sheet: WorkSheet, lastCol: number, merges: NonNullable<WorkSheet['!merges']>): string[] {
  const titles: string[] = [];
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

function coerce(column: ParsedColumn, value: unknown): string | number | null {
  if (value == null || value === '') return null;
  if (column.dataType === 'date' || /^pms_\d+$/.test(column.key) || /^pm_date(_\d+)?$/.test(column.key) || column.key.endsWith('_date') || column.key.endsWith('_due') || column.key === 'next_follow_up') {
    return parseDate(value);
  }
  if (column.dataType === 'number') {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    const numeric = Number(String(value).replace(/,/g, '').trim());
    return Number.isFinite(numeric) && String(value).trim() !== '' ? numeric : null;
  }
  const text = value instanceof Date ? '' : String(value).trim();
  return text || null;
}

export function parseWorkbook(buffer: Buffer): ParsedWorkbook {
  const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    const error = new Error('The workbook has no sheets.');
    (error as Error & { status?: number; code?: string }).status = 400;
    (error as Error & { code?: string }).code = 'EMPTY_WORKBOOK';
    throw error;
  }
  const sheet = workbook.Sheets[sheetName] as WorkSheet;
  const lastCol = lastHeaderColumn(sheet);
  if (lastCol < 0) {
    const error = new Error('The sheet has no header row.');
    (error as Error & { status?: number; code?: string }).status = 400;
    (error as Error & { code?: string }).code = 'EMPTY_HEADER';
    throw error;
  }
  const merges = sheet['!merges'] || [];
  const titles = carriedTitles(sheet, lastCol, merges);
  const used = new Set<string>();
  const counters = new Map<string, number>();
  const groups: { key: string; title: string }[] = [];
  const seenGroups = new Set<string>();
  const columns: ParsedColumn[] = [];
  for (let column = 0; column <= lastCol; column += 1) {
    const groupTitle = titles[column] || 'General';
    const groupKey = normalizeGroupKey(groupTitle) || 'customer_detail';
    if (!seenGroups.has(groupKey)) {
      seenGroups.add(groupKey);
      groups.push({ key: groupKey, title: groupTitle });
    }
    const label = subheaderLabel(cellRaw(sheet, 1, column), groupKey, groupTitle, counters);
    const key = uniqueKey(canonicalColumnKey(label), used);
    const dataType = inferColumnType(key, label);
    columns.push({
      key,
      label,
      groupKey,
      groupTitle,
      dataType,
      semanticTag: semanticTagFor(key),
      displayOrder: column,
      isSystem: PROTECTED.has(key),
    });
  }
  const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1');
  const records: ParsedRecord[] = [];
  for (let row = 2; row <= range.e.r; row += 1) {
    if (records.length >= MAX_ROWS) {
      const error = new Error(`Workbooks are limited to ${MAX_ROWS} data rows.`);
      (error as Error & { status?: number; code?: string }).status = 400;
      (error as Error & { code?: string }).code = 'ROW_LIMIT';
      throw error;
    }
    const data: CellMap = {};
    let hasValue = false;
    for (let column = 0; column < columns.length; column += 1) {
      const spec = columns[column];
      const value = coerce(spec, cellRaw(sheet, row, column));
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
  return { groups, columns, records };
}

export function buildWorkbook(columns: ParsedColumn[], rows: CellMap[]): Buffer {
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
  const body = rows.map((row) => columns.map((column) => {
    const value = row[column.key];
    return value == null ? '' : value;
  }));
  const sheet = XLSX.utils.aoa_to_sheet([banner, headers, ...body]);
  sheet['!merges'] = merges;
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'Master');
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

export function sourceKeys(columns: ParsedColumn[]): Set<string> {
  return new Set(columns.filter((column) => !PROTECTED.has(column.key)).map((column) => column.key));
}
