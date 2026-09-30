export const ROLES = ['ADMIN', 'MANAGER', 'VALIDATOR', 'SERVICE'] as const;
export type Role = (typeof ROLES)[number];

export const GROUP_CATALOG = [
  { key: 'customer_detail', title: 'Customer', tint: 'customer' },
  { key: 'instrument_details', title: 'Instrument', tint: 'instrument' },
  { key: 'data_validation', title: 'Validation', tint: 'validation' },
  { key: 'schedule_services', title: 'Schedule', tint: 'schedule' },
  { key: 'complaint', title: 'Complaint', tint: 'complaint' },
  { key: 'breakdown_calls', title: 'Breakdown', tint: 'breakdown' },
  { key: 'amc', title: 'AMC', tint: 'amc' },
  { key: 'follow_up', title: 'Follow-up', tint: 'followup' },
] as const;

export type GroupKey = (typeof GROUP_CATALOG)[number]['key'];

export const SERVER_FIELDS = [
  'validated',
  'validated_by',
  'validated_at',
  'verified',
  'verified_by',
  'verified_at',
  'amc_status',
  'amc_state',
  'amc_notes',
  'ack_at',
  'proposal_sent_at',
  'amc_decided_at',
  'warranty_live',
  'warranty_status',
  'days',
  'next_due_pms',
  'next_due_pms_tone',
  'assigned_validator_id',
  'assigned_service_id',
] as const;

const HEADER_ALIASES: Record<string, string> = {
  'sr no': 'sr_no',
  srno: 'sr_no',
  'customer name': 'customer_name',
  city: 'city',
  email: 'email',
  'email id': 'email',
  'mobile no': 'mobile_no',
  mobile: 'mobile_no',
  'phone no': 'mobile_no',
  'contract type': 'contract_type',
  'euipment name': 'equipment_name',
  'equipment name': 'equipment_name',
  'equipment model': 'equipment_name',
  'serial no': 'serial_no',
  'serial number': 'serial_no',
  'start date': 'start_date',
  'end date': 'end_date',
  status: 'status',
  'validated yes no': 'validated',
  validated: 'validated',
  'validated by': 'validated_by',
  'validated at': 'validated_at',
  'rejection reason': 'rejection_reason',
  'validation due': 'validation_due',
  verified: 'verified',
  'verified by': 'verified_by',
  'verified at': 'verified_at',
  days: 'days',
  'total pms': 'total_pms',
  'pm date': 'pm_date',
  'follow up notes': 'follow_up_notes',
  'followup notes': 'follow_up_notes',
  'next follow up': 'next_follow_up',
  'complaint notes': 'complaint_notes',
  'amc status': 'amc_status',
};

const EMPTY_HEADER_LABELS: Record<string, string> = {
  customer_detail: 'Customer Notes',
  instrument_details: 'Instrument Notes',
  data_validation: 'Validation Notes',
  schedule_services: 'Schedule Notes',
  complaint: 'Complaint Notes',
  breakdown_calls: 'Breakdown Notes',
  amc: 'AMC Status',
  follow_up: 'Follow-up Notes',
};

export interface PermissionSet {
  label: string;
  manageUsers: boolean;
  alterSchema: boolean;
  uploadExcel: boolean;
  insertRows: boolean;
  duplicateRows: boolean;
  deleteRows: boolean;
  deleteDatasets: boolean;
  verifyRecords: boolean;
  validateRecords: boolean;
  amcActions: boolean;
  assignRecords: boolean;
  logCalls: boolean;
  editGroups: '*' | readonly string[];
}

export const ROLE_PERMISSIONS: Record<Role, PermissionSet> = {
  ADMIN: {
    label: 'Admin',
    manageUsers: true,
    alterSchema: true,
    uploadExcel: true,
    insertRows: true,
    duplicateRows: true,
    deleteRows: true,
    deleteDatasets: true,
    verifyRecords: true,
    validateRecords: true,
    amcActions: true,
    assignRecords: true,
    logCalls: true,
    editGroups: '*',
  },
  MANAGER: {
    label: 'Manager',
    manageUsers: false,
    alterSchema: false,
    uploadExcel: true,
    insertRows: true,
    duplicateRows: true,
    deleteRows: true,
    deleteDatasets: true,
    verifyRecords: true,
    validateRecords: true,
    amcActions: true,
    assignRecords: true,
    logCalls: true,
    editGroups: '*',
  },
  VALIDATOR: {
    label: 'Validator',
    manageUsers: false,
    alterSchema: false,
    uploadExcel: false,
    insertRows: false,
    duplicateRows: false,
    deleteRows: false,
    deleteDatasets: false,
    verifyRecords: false,
    validateRecords: true,
    amcActions: false,
    assignRecords: false,
    logCalls: false,
    editGroups: ['data_validation'],
  },
  SERVICE: {
    label: 'Service',
    manageUsers: false,
    alterSchema: false,
    uploadExcel: false,
    insertRows: false,
    duplicateRows: false,
    deleteRows: false,
    deleteDatasets: false,
    verifyRecords: false,
    validateRecords: false,
    amcActions: true,
    assignRecords: false,
    logCalls: true,
    editGroups: ['amc', 'schedule_services', 'breakdown_calls', 'follow_up', 'complaint'],
  },
};

export type PermissionFlag = {
  [K in keyof PermissionSet]: PermissionSet[K] extends boolean ? K : never;
}[keyof PermissionSet];

export function normalizeRole(role: unknown): Role | '' {
  const value = String(role || '').trim().toUpperCase();
  return ROLES.includes(value as Role) ? (value as Role) : '';
}

export function permissionsFor(role: unknown): PermissionSet | null {
  const normalized = normalizeRole(role);
  return normalized ? ROLE_PERMISSIONS[normalized] : null;
}

export function hasPermission(role: unknown, permission: PermissionFlag): boolean {
  return Boolean(permissionsFor(role)?.[permission]);
}

export function roleTitle(role: unknown): string {
  return permissionsFor(role)?.label || 'User';
}

export function isServerField(key: string): boolean {
  return (SERVER_FIELDS as readonly string[]).includes(key) || key.startsWith('assigned_');
}

export function normalizeHeader(value: unknown): string {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

export function slugKey(label: unknown): string {
  const cleaned = String(label || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_+/g, '_')
    .slice(0, 64);
  if (!cleaned) return 'field';
  if (/^[0-9]/.test(cleaned)) return `f_${cleaned}`.slice(0, 64);
  return cleaned;
}

export function normalizeGroupKey(title: unknown): string {
  const text = normalizeHeader(title);
  if (!text) return '';
  if (text === 'customer' || text.includes('customer')) return 'customer_detail';
  if (text.includes('instrument')) return 'instrument_details';
  if (text.includes('validation')) return 'data_validation';
  if (text.includes('schedule')) return 'schedule_services';
  if (text.includes('compaint') || text.includes('complaint')) return 'complaint';
  if (text.includes('breakdown')) return 'breakdown_calls';
  if (text === 'amc' || text.includes('amc')) return 'amc';
  if (text.includes('follow')) return 'follow_up';
  return slugKey(title);
}

export function canonicalColumnKey(label: unknown): string {
  const norm = normalizeHeader(label);
  if (HEADER_ALIASES[norm]) return HEADER_ALIASES[norm];
  let match = norm.match(/^pms\s*(\d+)$/);
  if (match) return `pms_${Number(match[1])}`;
  match = norm.match(/^pm date\s*(\d+)$/);
  if (match) return `pm_date_${Number(match[1])}`;
  if (norm === 'pm date') return 'pm_date';
  return slugKey(String(label || ''));
}

export function uniqueKey(base: string, used: Set<string>): string {
  let key = base || 'field';
  if (!used.has(key)) {
    used.add(key);
    return key;
  }
  let index = 2;
  while (used.has(`${key}_${index}`)) index += 1;
  const next = `${key}_${index}`.slice(0, 72);
  used.add(next);
  return next;
}

export function fallbackHeaderLabel(groupKey: string, groupTitle: string, occurrence: number): string {
  const base = EMPTY_HEADER_LABELS[groupKey] || `${groupTitle || 'Field'} Notes`;
  if (occurrence <= 1) return base;
  return `${base} ${occurrence}`;
}

export function inferColumnType(key: string, label: string): 'number' | 'date' | 'text' {
  if (key === 'days' || key === 'sr_no' || key === 'total_pms') return 'number';
  if (key === 'validated' || key === 'verified' || key === 'validated_by' || key === 'verified_by' || key === 'status' || key === 'amc_status') {
    return 'text';
  }
  if (/^pms_\d+$/.test(key) || /^pm_date(_\d+)?$/.test(key)) return 'date';
  if (key === 'validation_due' || key === 'next_follow_up' || key.endsWith('_at') || key.endsWith('_due')) return 'date';
  if (/(^|_)date(_|$)/.test(key) || /\bdate\b/i.test(label || '')) return 'date';
  return 'text';
}

export function semanticTagFor(key: string): string | null {
  const known = new Set([
    'serial_no', 'customer_name', 'email', 'city', 'mobile_no', 'contract_type', 'equipment_name',
    'start_date', 'end_date', 'validated', 'verified', 'validation_due', 'rejection_reason',
    'total_pms', 'next_follow_up', 'amc_status', 'status',
  ]);
  if (known.has(key) || /^pms_\d+$/.test(key) || /^pm_date(_\d+)?$/.test(key)) return key;
  return null;
}

export function isPmsDetailColumn(column: { key: string; groupKey: string }): boolean {
  if (column.groupKey !== 'schedule_services') return false;
  return /^pms_\d+$/.test(column.key) || /^pm_date(_\d+)?$/.test(column.key);
}

export interface ColumnRef {
  key: string;
  groupKey: string;
}

export function canEditColumn(role: unknown, column: ColumnRef): boolean {
  if (isServerField(column.key)) return false;
  const permissions = permissionsFor(role);
  if (!permissions) return false;
  if (permissions.editGroups === '*') return true;
  return permissions.editGroups.includes(column.groupKey);
}

export function requiredPermissionFor(column: ColumnRef): string {
  if (isServerField(column.key)) return 'serverManaged';
  return `edit:${column.groupKey}`;
}

export function editDenialMessage(role: unknown): string {
  const permissions = permissionsFor(role);
  if (!permissions) return 'Your role cannot edit this record.';
  if (permissions.editGroups === '*') return 'This field is maintained by the server.';
  const titles = permissions.editGroups
    .map((key) => GROUP_CATALOG.find((group) => group.key === key)?.title || key)
    .join(', ');
  return `Your role (${permissions.label}) can edit ${titles} only.`;
}
