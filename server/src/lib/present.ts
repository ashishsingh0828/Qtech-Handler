import type { Prisma } from '@prisma/client';
import { deriveRecord, type CellMap, type Derived } from '../../../shared/metrics.ts';
import { isServerField } from '../../../shared/permissions.ts';
import { parseDate } from '../../../shared/dates.ts';

export interface ColumnDTO {
  id: string;
  key: string;
  label: string;
  groupKey: string;
  semanticTag: string | null;
  dataType: string;
  displayOrder: number;
  isSystem: boolean;
}

export interface RecordDTO {
  id: string;
  datasetId: string;
  version: number;
  position: number;
  serialNo: string | null;
  customerName: string | null;
  isDuplicateSuspect: boolean;
  validatedById: string | null;
  validatedAt: string | null;
  verifiedById: string | null;
  verifiedAt: string | null;
  amcStatus: string | null;
  assignedValidatorId: string | null;
  assignedServiceId: string | null;
  updatedAt: string;
  data: CellMap;
  derived: Derived;
}

export interface StoredRow {
  id: string;
  datasetId: string;
  version: number;
  position: number;
  serialNo: string | null;
  customerName: string | null;
  data: Prisma.JsonValue;
  isDuplicateSuspect: boolean;
  validatedById: string | null;
  validatedAt: Date | null;
  verifiedById: string | null;
  verifiedAt: Date | null;
  amcStatus: string | null;
  proposalSentAt?: Date | null;
  ackResponse?: string | null;
  ackNote?: string | null;
  nextFollowUp?: Date | null;
  importedData?: Prisma.JsonValue | null;
  assignedValidatorId: string | null;
  assignedServiceId: string | null;
  updatedAt: Date;
}

export function asCells(value: Prisma.JsonValue): CellMap {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const cells: CellMap = {};
  for (const [key, entry] of Object.entries(value)) {
    if (entry == null) cells[key] = null;
    else if (typeof entry === 'string' || typeof entry === 'number') cells[key] = entry;
    else if (typeof entry === 'boolean') cells[key] = entry ? 'Yes' : 'No';
  }
  return cells;
}

export function presentRow(row: StoredRow, today: string): RecordDTO {
  const data = asCells(row.data);
  const derived = deriveRecord(data, today, row.amcStatus);
  return {
    id: row.id,
    datasetId: row.datasetId,
    version: row.version,
    position: row.position,
    serialNo: row.serialNo,
    customerName: row.customerName,
    isDuplicateSuspect: row.isDuplicateSuspect,
    validatedById: row.validatedById,
    validatedAt: row.validatedAt ? row.validatedAt.toISOString() : null,
    verifiedById: row.verifiedById,
    verifiedAt: row.verifiedAt ? row.verifiedAt.toISOString() : null,
    amcStatus: derived.amcStatus,
    assignedValidatorId: row.assignedValidatorId,
    assignedServiceId: row.assignedServiceId,
    updatedAt: row.updatedAt.toISOString(),
    data,
    derived,
  };
}

export function indexesOf(data: CellMap): { serialNo: string | null; customerName: string | null } {
  const serial = data.serial_no;
  const name = data.customer_name;
  return {
    serialNo: serial == null || String(serial).trim() === '' ? null : String(serial).trim(),
    customerName: name == null || String(name).trim() === '' ? null : String(name).trim(),
  };
}

export function equipmentOf(data: CellMap): string | null {
  const value = data.equipment_name ?? data.equipment_model;
  if (value == null || String(value).trim() === '') return null;
  return String(value).trim();
}

export function normalizeToken(value: string | null): string {
  return (value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

export function applyColumnTypes(data: CellMap, columns: { key: string; dataType: string }[]): CellMap {
  const types = new Map(columns.map((column) => [column.key, column.dataType]));
  const next: CellMap = {};
  for (const [key, value] of Object.entries(data)) {
    if (isServerField(key)) continue;
    const type = types.get(key);
    if (type === 'date' || key.endsWith('_date') || key.endsWith('_due') || key === 'next_follow_up' || /^pms_\d+$/.test(key) || /^pm_date(_\d+)?$/.test(key)) {
      next[key] = parseDate(value);
    } else if (type === 'number') {
      if (typeof value === 'number' && Number.isFinite(value)) next[key] = value;
      else if (value == null || String(value).trim() === '') next[key] = null;
      else {
        const numeric = Number(String(value).replace(/,/g, ''));
        next[key] = Number.isFinite(numeric) ? numeric : null;
      }
    } else if (value == null) next[key] = null;
    else next[key] = typeof value === 'number' ? value : String(value).trim() || null;
  }
  return next;
}
