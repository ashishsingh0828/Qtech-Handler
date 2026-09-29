/** @typedef {'admin' | 'manager' | 'validator' | 'service'} Role */

export const ROLES = ['admin', 'manager', 'validator', 'service'];

export const GROUP_CATALOG = [
  { key: 'customer', title: 'Customer Detail', tint: 'customer' },
  { key: 'instrument', title: 'Instrument Details', tint: 'instrument' },
  { key: 'data_validation', title: 'Data Validation', tint: 'validation' },
  { key: 'schedule_services', title: 'Schedule Services', tint: 'schedule' },
  { key: 'compaint', title: 'Compaint', tint: 'complaint' },
  { key: 'breakdown_calls', title: 'Breakdown Calls', tint: 'breakdown' },
  { key: 'amc', title: 'AMC', tint: 'amc' },
  { key: 'follow_up', title: 'Follow up', tint: 'followup' },
];

const GROUP_BY_KEY = Object.fromEntries(GROUP_CATALOG.map((group) => [group.key, group]));

export const SERVER_MANAGED_KEYS = [
  'days',
  'validated',
  'validated_by',
  'validated_at',
  'verified',
  'verified_by',
  'verified_at',
  'warranty_status',
  'next_due_pms',
  'next_due_pms_tone',
  'amc_state',
  'amc_notes',
  'proposal_sent_at',
  'amc_decided_at',
];

const HEADER_ALIASES = {
  'sr no': 'sr_no',
  srno: 'sr_no',
  'customer name': 'customer_name',
  city: 'city',
  'mobile no': 'mobile_no',
  mobile: 'mobile_no',
  'phone no': 'mobile_no',
  'contract type': 'contract_type',
  'euipment name': 'equipment_name',
  'equipment name': 'equipment_name',
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
  'complaint notes': 'complaint_notes',
  'amc status': 'amc_status',
  'next follow up': 'next_follow_up',
};

const EMPTY_HEADER_LABELS = {
  customer: 'Customer Notes',
  instrument: 'Instrument Notes',
  data_validation: 'Validation Notes',
  schedule_services: 'Schedule Notes',
  compaint: 'Complaint Notes',
  breakdown_calls: 'Breakdown Notes',
  amc: 'AMC Status',
  follow_up: 'Follow-up Notes',
};

export const ROLE_PERMISSIONS = {
  admin: {
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
    editGroups: '*',
  },
  manager: {
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
    editGroups: ['follow_up'],
  },
  validator: {
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
    editGroups: ['data_validation'],
  },
  service: {
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
    editGroups: ['amc', 'schedule_services', 'compaint', 'breakdown_calls', 'follow_up'],
  },
};

export function serverManagedSemantics() {
  return {
    keys: [...SERVER_MANAGED_KEYS],
    descriptions: {
      days: 'Whole calendar days between start_date and end_date. Recomputed on read and write.',
      validated: 'Set only by the validation action.',
      validated_by: 'Name of the user who recorded the validation decision.',
      validated_at: 'Timestamp of the validation decision.',
      verified: 'Set only by the manager verification action.',
      verified_by: 'Name of the manager who verified the record.',
      verified_at: 'Timestamp of the verification decision.',
      warranty_status: 'Derived from end_date against today in APP_TIMEZONE.',
      next_due_pms: 'Earliest scheduled PMS date whose paired PM Date is empty.',
      next_due_pms_tone: 'Ruby, amber, or stone tone for the next due PMS pill.',
      amc_state: 'AMC stepper state: proposal_sent, acknowledged, or declined.',
      amc_notes: 'Acknowledgment or decline notes captured by the AMC action.',
      proposal_sent_at: 'Timestamp when the AMC proposal was sent.',
      amc_decided_at: 'Timestamp of the acknowledge or decline decision.',
    },
  };
}

export function isServerManaged(key) {
  return SERVER_MANAGED_KEYS.includes(key);
}

export function hasPermission(role, permission) {
  return Boolean(ROLE_PERMISSIONS[role]?.[permission]);
}

export function roleLabel(role) {
  return ROLE_PERMISSIONS[role]?.label || 'User';
}

/**
 * @param {string} role
 * @param {string | { key: string, group?: string }} column
 * @param {{ columns?: Array<{ key: string, group: string }> }} schema
 */
export function canEditColumn(role, column, schema) {
  const key = typeof column === 'string' ? column : column?.key;
  if (!key || typeof key !== 'string' || !/^[a-z][a-z0-9_]*$/.test(key)) return false;
  if (isServerManaged(key)) return false;
  const permissions = ROLE_PERMISSIONS[role];
  if (!permissions) return false;
  const group = typeof column === 'string'
    ? schema?.columns?.find((item) => item.key === key)?.group
    : column.group;
  if (!group) return false;
  if (permissions.editGroups === '*') return true;
  return permissions.editGroups.includes(group);
}

export function editableGroupTitles(role, schema) {
  const permissions = ROLE_PERMISSIONS[role];
  if (!permissions) return [];
  if (permissions.editGroups === '*') return ['all groups'];
  return permissions.editGroups.map((key) => {
    const fromSchema = schema?.groups?.find((group) => group.key === key);
    return fromSchema?.title || GROUP_BY_KEY[key]?.title || key;
  });
}

export function groupTint(key) {
  return GROUP_BY_KEY[key]?.tint || 'customer';
}

export function normalizeHeader(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

export function slugKey(label) {
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

export function normalizeGroupKey(title) {
  const text = normalizeHeader(title);
  if (!text) return '';
  if (text.includes('customer')) return 'customer';
  if (text.includes('instrument')) return 'instrument';
  if (text.includes('validation')) return 'data_validation';
  if (text.includes('schedule')) return 'schedule_services';
  if (text.includes('compaint') || text.includes('complaint')) return 'compaint';
  if (text.includes('breakdown')) return 'breakdown_calls';
  if (text === 'amc' || text.includes('amc')) return 'amc';
  if (text.includes('follow')) return 'follow_up';
  return slugKey(title);
}

export function canonicalColumnKey(label) {
  const norm = normalizeHeader(label);
  if (HEADER_ALIASES[norm]) return HEADER_ALIASES[norm];
  let match = norm.match(/^pms\s*(\d+)$/);
  if (match) return `pms_${Number(match[1])}`;
  match = norm.match(/^pm date\s*(\d+)$/);
  if (match) return `pm_date_${Number(match[1])}`;
  if (norm === 'pm date') return 'pm_date';
  return slugKey(label);
}

export function uniqueKey(base, used) {
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

export function fallbackHeaderLabel(groupKey, groupTitle, occurrence) {
  const base = EMPTY_HEADER_LABELS[groupKey] || `${groupTitle || 'Field'} Notes`;
  if (occurrence <= 1) return base;
  return `${base} ${occurrence}`;
}

export function inferColumnType(key, label) {
  if (key === 'days' || key === 'sr_no' || key === 'total_pms') return 'number';
  if (key === 'validated' || key === 'verified' || key === 'validated_by' || key === 'verified_by' || key === 'status') {
    return 'text';
  }
  if (/^pms_\d+$/.test(key) || /^pm_date(_\d+)?$/.test(key)) return 'date';
  if (key === 'validation_due' || key === 'next_follow_up' || key.endsWith('_at') || key.endsWith('_due')) return 'date';
  if (/(^|_)date(_|$)/.test(key) || /\bdate\b/i.test(label || '')) return 'date';
  return 'text';
}

export function isPmsDetailColumn(column) {
  if (!column || column.group !== 'schedule_services') return false;
  return /^pms_\d+$/.test(column.key) || /^pm_date(_\d+)?$/.test(column.key);
}

export function isServiceWatchGroup(groupKey) {
  return groupKey === 'amc' || groupKey === 'schedule_services';
}
