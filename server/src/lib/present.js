import { presentComputation, withStoredDays } from '../../../shared/compute.js';
import { initials } from './time.js';

export function publicUser(user) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    active: user.active,
  };
}

export function presentDataset(row) {
  const schema = row.schema || { groups: [], columns: [] };
  return {
    id: row.id,
    name: row.name,
    originalFilename: row.original_filename,
    schema,
    rowCount: row.row_count,
    columnCount: schema.columns?.length || 0,
    uploaderName: row.uploader_name || '',
    uploaderInitials: initials(row.uploader_name),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function presentRow(row, today, columns) {
  const data = withStoredDays(row.data || {});
  const computed = presentComputation(data, today, columns);
  return {
    id: row.id,
    position: row.position,
    data,
    computed: {
      days: computed.days,
      warrantyStatus: computed.warranty.label,
      warrantyTone: computed.warranty.tone,
      warrantyDue: computed.warranty.due,
      warrantyActive: computed.warranty.active,
      nextDuePms: computed.nextDuePms,
    },
    updatedAt: row.updated_at,
  };
}

export function presentAudit(row) {
  return {
    id: row.id,
    action: row.action,
    summary: row.summary,
    actorName: row.actor_name,
    createdAt: row.created_at,
  };
}

export function customerLabel(data) {
  return data?.customer_name || data?.serial_no || 'record';
}
