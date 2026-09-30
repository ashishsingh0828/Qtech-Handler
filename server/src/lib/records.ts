import type { Prisma } from '@prisma/client';
import { prisma } from './prisma.ts';
import { HttpError } from './http.ts';
import { emit, notifyUsers, userIdsByRole } from './notify.ts';
import { isolate } from './sideEffect.ts';
import { applyColumnTypes, asCells, equipmentOf, indexesOf, normalizeToken, presentRow, type ColumnDTO, type RecordDTO, type StoredRow } from './present.ts';
import { jsonObject } from './ensureSchema.ts';
import { parseDate } from '../../../shared/dates.ts';
import { canEditColumn, isServerField, requiredPermissionFor, type Role } from '../../../shared/permissions.ts';
import { deriveRecord, effectiveAmcStatus, pmsDoneKey, type CellMap } from '../../../shared/metrics.ts';
import type { AuthUser } from '../middleware/auth.ts';

type Tx = Prisma.TransactionClient;

const CALL_TYPES = new Set(['Complaint', 'Breakdown', 'Emergency', 'Courtesy Visit']);

export async function loadColumns(datasetId: string): Promise<ColumnDTO[]> {
  const columns = await prisma.columnDefinition.findMany({
    where: { datasetId },
    orderBy: { displayOrder: 'asc' },
  });
  return columns.map((column) => ({
    id: column.id,
    key: column.key,
    label: column.label,
    groupKey: column.groupKey,
    semanticTag: column.semanticTag,
    dataType: column.dataType,
    displayOrder: column.displayOrder,
    isSystem: column.isSystem,
  }));
}

function toStored(row: {
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
}): StoredRow {
  return row;
}

async function locked(tx: Tx, datasetId: string, rowId: string, version: number, today: string): Promise<{ row: StoredRow; presented: RecordDTO }> {
  const row = await tx.row.findFirst({ where: { id: rowId, datasetId } });
  if (!row) throw new HttpError(404, 'Record not found.', 'NOT_FOUND');
  const stored = toStored(row);
  if (stored.version !== version) {
    throw new HttpError(409, 'This record changed. Refresh and try again.', 'CONFLICT', {
      row: presentRow(stored, today),
    });
  }
  return { row: stored, presented: presentRow(stored, today) };
}

export async function writeActivity(tx: Tx, input: {
  datasetId: string;
  rowId: string | null;
  userId: string;
  actorName?: string;
  action: string;
  columnKey?: string | null;
  fromValue?: string | null;
  toValue?: string | null;
  changes: Prisma.InputJsonObject;
}): Promise<void> {
  await isolate(tx, 'activity', async () => {
    await tx.activityLog.create({
      data: {
        action: input.action,
        actorName: input.actorName || null,
        columnKey: input.columnKey || null,
        fromValue: input.fromValue ?? null,
        toValue: input.toValue ?? null,
        changes: input.changes,
        ...(input.datasetId ? { dataset: { connect: { id: input.datasetId } } } : {}),
        ...(input.rowId ? { row: { connect: { id: input.rowId } } } : {}),
        ...(input.userId ? { user: { connect: { id: input.userId } } } : {}),
      },
    });
  });
}

export async function patchRecord(input: {
  datasetId: string;
  rowId: string;
  version: number;
  updates: Record<string, unknown>;
  user: AuthUser;
  today: string;
  columns: ColumnDTO[];
}): Promise<RecordDTO> {
  const keys = Object.keys(input.updates);
  const blocked = keys.filter((key) => isServerField(key) || !canEditColumn(input.user.role, {
    key,
    groupKey: input.columns.find((column) => column.key === key)?.groupKey || '',
  }));
  if (blocked.length) {
    throw new HttpError(403, 'Those fields cannot be edited.', 'FORBIDDEN', {
      requiredPermission: requiredPermissionFor({
        key: blocked[0],
        groupKey: input.columns.find((column) => column.key === blocked[0])?.groupKey || '',
      }),
      blockedFields: blocked,
    });
  }
  const saved = await prisma.$transaction(async (tx) => {
    const { row } = await locked(tx, input.datasetId, input.rowId, input.version, input.today);
    const incoming = applyColumnTypes(input.updates as CellMap, input.columns);
    const data: CellMap = { ...asCells(row.data), ...incoming };
    const indexed = indexesOf(data);
    const next = await tx.row.update({
      where: { id: row.id },
      data: {
        version: { increment: 1 }, updatedByName: input.user.name,
        data: jsonObject(data),
        serialNo: indexed.serialNo,
        customerName: indexed.customerName,
      },
    });
    const changedKey = Object.keys(incoming)[0] || null;
    const previous = asCells(row.data);
    await writeActivity(tx, {
      datasetId: input.datasetId,
      rowId: row.id,
      userId: input.user.id,
      actorName: input.user.name,
      action: 'edit',
      columnKey: changedKey,
      fromValue: changedKey ? String(previous[changedKey] ?? '') : null,
      toValue: changedKey ? String(incoming[changedKey] ?? '') : null,
      changes: jsonObject(incoming),
    });
    return next;
  });
  emit('row.updated', input.datasetId, saved.id, input.user.id);
  return presentRow(toStored(saved), input.today);
}

export async function validateRecord(input: {
  datasetId: string;
  rowId: string;
  version: number;
  decision: 'Yes' | 'No';
  reason?: string;
  expectedDate?: string;
  user: AuthUser;
  today: string;
}): Promise<RecordDTO> {
  const saved = await prisma.$transaction(async (tx) => {
    const { row } = await locked(tx, input.datasetId, input.rowId, input.version, input.today);
    const data = asCells(row.data);
    if (input.decision === 'No') {
      const reason = (input.reason || '').trim();
      const due = parseDate(input.expectedDate);
      if (reason.length < 5 || !due) {
        throw new HttpError(400, 'A reason of at least 5 characters and an expected date are required.', 'VALIDATION');
      }
      data.validated = 'No';
      data.rejection_reason = reason;
      data.validation_due = due;
    } else {
      data.validated = 'Yes';
      data.rejection_reason = null;
      data.validation_due = null;
    }
    data.validated_by = input.user.name;
    data.validated_at = new Date().toISOString();
    const next = await tx.row.update({
      where: { id: row.id },
        data: {
        version: { increment: 1 }, updatedByName: input.user.name,
        data: jsonObject(data),
        validatedById: input.user.id,
        validatedAt: new Date(),
        rejectionReason: input.decision === 'No' ? String(data.rejection_reason || '') : null,
        validationDue: input.decision === 'No' && data.validation_due ? new Date(String(data.validation_due)) : null,
      },
    });
    await writeActivity(tx, {
      datasetId: input.datasetId,
      rowId: row.id,
      userId: input.user.id,
      actorName: input.user.name,
      action: input.decision === 'Yes' ? 'validate_yes' : 'validate_no',
      columnKey: 'validated',
      fromValue: String(asCells(row.data).validated || ''),
      toValue: input.decision,
      changes: jsonObject({ decision: input.decision, reason: data.rejection_reason }),
    });
    const leaders = await userIdsByRole(tx, ['ADMIN', 'MANAGER']);
    await notifyUsers(tx, {
      userIds: leaders,
      actorId: input.user.id,
      type: input.decision === 'Yes' ? 'ready_to_verify' : 'validation_rejected',
      message: input.decision === 'Yes'
        ? `${row.customerName || 'Record'} is ready to verify.`
        : `${row.customerName || 'Record'} was rejected: ${String(data.rejection_reason)}`,
      rowId: row.id,
      datasetId: input.datasetId,
      priority: input.decision === 'No' ? 'HIGH' : 'NORMAL',
    });
    return next;
  });
  emit('row.validated', input.datasetId, saved.id, input.user.id);
  return presentRow(toStored(saved), input.today);
}

export async function verifyRecord(input: {
  datasetId: string;
  rowId: string;
  version: number;
  action: 'verify' | 'revert';
  user: AuthUser;
  today: string;
}): Promise<RecordDTO> {
  const saved = await prisma.$transaction(async (tx) => {
    const { row } = await locked(tx, input.datasetId, input.rowId, input.version, input.today);
    const data = asCells(row.data);
    if (data.validated !== 'Yes') {
      throw new HttpError(409, 'Verify is available only after validation is Yes.', 'CONFLICT', {
        row: presentRow(row, input.today),
      });
    }
    if (input.action === 'verify') {
      data.verified = 'Verified OK';
      data.verified_by = input.user.name;
      data.verified_at = new Date().toISOString();
    } else {
      data.verified = null;
      data.verified_by = null;
      data.verified_at = null;
    }
    const next = await tx.row.update({
      where: { id: row.id },
      data: {
        version: { increment: 1 }, updatedByName: input.user.name,
        data: jsonObject(data),
        verifiedById: input.action === 'verify' ? input.user.id : null,
        verifiedAt: input.action === 'verify' ? new Date() : null,
      },
    });
    await writeActivity(tx, {
      datasetId: input.datasetId,
      rowId: row.id,
      userId: input.user.id,
      action: input.action === 'verify' ? 'verify_ok' : 'verify_revert',
      changes: jsonObject({ action: input.action }),
    });
    const derived = deriveRecord(data, input.today, row.amcStatus);
    if (input.action === 'verify') {
      const serviceIds = row.assignedServiceId
        ? [row.assignedServiceId]
        : await userIdsByRole(tx, ['SERVICE']);
      const validatorId = row.assignedValidatorId || row.validatedById;
      await notifyUsers(tx, {
        userIds: serviceIds,
        actorId: input.user.id,
        type: 'amc_lead',
        message: `${row.customerName || 'Record'} is a new AMC lead.`,
        rowId: row.id,
        datasetId: input.datasetId,
        priority: derived.warrantyExpired ? 'HIGH' : 'NORMAL',
      });
      if (validatorId) {
        await notifyUsers(tx, {
          userIds: [validatorId],
          actorId: input.user.id,
          type: 'verified',
          message: `${row.customerName || 'Record'} was verified.`,
          rowId: row.id,
          datasetId: input.datasetId,
        });
      }
    } else if (row.assignedValidatorId) {
      await notifyUsers(tx, {
        userIds: [row.assignedValidatorId],
        actorId: input.user.id,
        type: 'needs_recheck',
        message: `${row.customerName || 'Record'} needs a recheck.`,
        rowId: row.id,
        datasetId: input.datasetId,
        priority: 'HIGH',
      });
    }
    return next;
  });
  emit('row.verified', input.datasetId, saved.id, input.user.id);
  return presentRow(toStored(saved), input.today);
}

export async function amcRecord(input: {
  datasetId: string;
  rowId: string;
  version: number;
  action: 'proposal_sent' | 'acknowledge' | 'decline' | 'reset';
  note?: string;
  nextFollowUp?: string;
  user: AuthUser;
  today: string;
}): Promise<RecordDTO> {
  const saved = await prisma.$transaction(async (tx) => {
    const { row } = await locked(tx, input.datasetId, input.rowId, input.version, input.today);
    const data = asCells(row.data);
    const current = effectiveAmcStatus(data, input.today, row.amcStatus);
    const note = (input.note || '').trim();
    let nextStatus = current;
    if (input.action === 'reset') {
      nextStatus = '';
      data.amc_status = null;
      data.amc_state = null;
      data.proposal_sent_at = null;
      data.amc_notes = null;
      data.ack_at = null;
      data.amc_decided_at = null;
      data.next_follow_up = null;
    } else if (input.action === 'proposal_sent') {
      if (current !== 'AMC Due') throw new HttpError(409, 'A proposal can be sent only when the contract is AMC Due.', 'CONFLICT');
      nextStatus = 'Proposal Sent';
      data.proposal_sent_at = new Date().toISOString();
    } else {
      if (current !== 'Proposal Sent') {
        throw new HttpError(409, 'Acknowledge or decline is available after a proposal has been sent.', 'CONFLICT');
      }
      if (note.length < 5) throw new HttpError(400, 'A note of at least 5 characters is required.', 'VALIDATION');
      const follow = parseDate(input.nextFollowUp);
      if (input.action === 'acknowledge' && !follow) {
        throw new HttpError(400, 'Acknowledgement requires a follow-up date.', 'VALIDATION');
      }
      nextStatus = input.action === 'acknowledge' ? 'Acknowledged' : 'Declined';
      data.amc_notes = note;
      data.amc_decided_at = new Date().toISOString();
      data.ack_at = data.amc_decided_at;
      if (follow) data.next_follow_up = follow;
    }
    data.amc_status = nextStatus;
    data.amc_state = nextStatus;
    const next = await tx.row.update({
      where: { id: row.id },
        data: {
        version: { increment: 1 }, updatedByName: input.user.name,
        data: jsonObject(data),
        amcStatus: input.action === 'reset' ? null : nextStatus,
        proposalSentAt: data.proposal_sent_at ? new Date(String(data.proposal_sent_at)) : row.proposalSentAt,
        ackResponse: input.action === 'acknowledge' ? 'Acknowledged' : input.action === 'decline' ? 'Declined' : row.ackResponse,
        ackNote: note || row.ackNote,
        nextFollowUp: data.next_follow_up ? new Date(String(data.next_follow_up)) : row.nextFollowUp,
      },
    });
    await writeActivity(tx, {
      datasetId: input.datasetId,
      rowId: row.id,
      userId: input.user.id,
      actorName: input.user.name,
      action: `amc_${input.action}`,
      columnKey: 'amc_status',
      fromValue: current,
      toValue: nextStatus,
      changes: jsonObject({ status: nextStatus, note: note || null }),
    });
    const leaders = await userIdsByRole(tx, ['ADMIN', 'MANAGER']);
    await notifyUsers(tx, {
      userIds: leaders,
      actorId: input.user.id,
      type: 'amc_updated',
      message: `${row.customerName || 'Record'} AMC is now ${nextStatus}.`,
      rowId: row.id,
      datasetId: input.datasetId,
      priority: nextStatus === 'Declined' ? 'HIGH' : 'NORMAL',
    });
    return next;
  });
  emit('row.amc', input.datasetId, saved.id, input.user.id);
  return presentRow(toStored(saved), input.today);
}

export async function assignRecord(input: {
  datasetId: string;
  rowId: string;
  version: number;
  validatorId?: string | null;
  serviceId?: string | null;
  user: AuthUser;
  today: string;
}): Promise<RecordDTO> {
  const saved = await prisma.$transaction(async (tx) => {
    const { row } = await locked(tx, input.datasetId, input.rowId, input.version, input.today);
    const next = await tx.row.update({
      where: { id: row.id },
      data: {
        version: { increment: 1 }, updatedByName: input.user.name,
        assignedValidatorId: input.validatorId === undefined ? row.assignedValidatorId : input.validatorId,
        assignedServiceId: input.serviceId === undefined ? row.assignedServiceId : input.serviceId,
      },
    });
    await writeActivity(tx, {
      datasetId: input.datasetId,
      rowId: row.id,
      userId: input.user.id,
      action: 'assign',
      changes: jsonObject({
        validatorId: input.validatorId ?? null,
        serviceId: input.serviceId ?? null,
      }),
    });
    const targets = [input.validatorId, input.serviceId].filter((id): id is string => Boolean(id));
    await notifyUsers(tx, {
      userIds: targets,
      actorId: input.user.id,
      type: 'assigned',
      message: `${row.customerName || 'A record'} was assigned to you.`,
      rowId: row.id,
      datasetId: input.datasetId,
    });
    return next;
  });
  emit('row.assigned', input.datasetId, saved.id, input.user.id);
  return presentRow(toStored(saved), input.today);
}

export async function markPms(input: {
  datasetId: string;
  rowId: string;
  version: number;
  index: number;
  action: 'done' | 'reschedule';
  date?: string;
  user: AuthUser;
  today: string;
  role: Role;
}): Promise<RecordDTO> {
  if (!canEditColumn(input.role, { key: 'pms_1', groupKey: 'schedule_services' })) {
    throw new HttpError(403, 'You cannot update the PMS schedule.', 'FORBIDDEN', {
      requiredPermission: 'edit:schedule_services',
      blockedFields: ['pms_1'],
    });
  }
  const saved = await prisma.$transaction(async (tx) => {
    const { row } = await locked(tx, input.datasetId, input.rowId, input.version, input.today);
    const data = asCells(row.data);
    if (input.action === 'done') data[pmsDoneKey(input.index)] = input.today;
    else {
      const date = parseDate(input.date);
      if (!date) throw new HttpError(400, 'A reschedule date is required.', 'VALIDATION');
      data[`pms_${input.index}`] = date;
    }
    const next = await tx.row.update({
      where: { id: row.id },
      data: { version: { increment: 1 }, updatedByName: input.user.name, data: jsonObject(data) },
    });
    await writeActivity(tx, {
      datasetId: input.datasetId,
      rowId: row.id,
      userId: input.user.id,
      action: input.action === 'done' ? 'pms_done' : 'pms_reschedule',
      changes: jsonObject({ index: input.index, date: input.action === 'done' ? input.today : data[`pms_${input.index}`] }),
    });
    return next;
  });
  emit('row.pms', input.datasetId, saved.id, input.user.id);
  return presentRow(toStored(saved), input.today);
}

export async function logCall(input: {
  datasetId: string;
  rowId: string;
  version: number;
  type: string;
  description: string;
  user: AuthUser;
  today: string;
}): Promise<RecordDTO> {
  if (!CALL_TYPES.has(input.type)) throw new HttpError(400, 'Choose a call type.', 'VALIDATION');
  const description = input.description.trim();
  if (description.length < 3) throw new HttpError(400, 'Describe the call.', 'VALIDATION');
  const saved = await prisma.$transaction(async (tx) => {
    const { row } = await locked(tx, input.datasetId, input.rowId, input.version, input.today);
    await tx.serviceCall.create({
      data: { row: { connect: { id: row.id } }, datasetId: input.datasetId, type: input.type, description, status: 'Open' },
    });
    const next = await tx.row.update({ where: { id: row.id }, data: { version: { increment: 1 }, updatedByName: input.user.name } });
    await writeActivity(tx, {
      datasetId: input.datasetId,
      rowId: row.id,
      userId: input.user.id,
      action: 'call_opened',
      changes: jsonObject({ type: input.type, description }),
    });
    const leaders = await userIdsByRole(tx, ['ADMIN', 'MANAGER']);
    await notifyUsers(tx, {
      userIds: leaders,
      actorId: input.user.id,
      type: 'call_opened',
      message: `${input.type} logged for ${row.customerName || 'a record'}.`,
      rowId: row.id,
      datasetId: input.datasetId,
      priority: input.type === 'Emergency' ? 'HIGH' : 'NORMAL',
    });
    return next;
  });
  emit('call.opened', input.datasetId, saved.id, input.user.id);
  return presentRow(toStored(saved), input.today);
}

export async function resolveCall(input: {
  datasetId: string;
  rowId: string;
  callId: string;
  version: number;
  note?: string;
  user: AuthUser;
  today: string;
}): Promise<RecordDTO> {
  const saved = await prisma.$transaction(async (tx) => {
    const { row } = await locked(tx, input.datasetId, input.rowId, input.version, input.today);
    const call = await tx.serviceCall.findFirst({ where: { id: input.callId, rowId: row.id } });
    if (!call) throw new HttpError(404, 'Call not found.', 'NOT_FOUND');
    if (call.status === 'Resolved') throw new HttpError(409, 'This call is already resolved.', 'CONFLICT');
    await tx.serviceCall.update({
      where: { id: call.id },
      data: {
        status: 'Resolved',
        resolvedAt: new Date(),
        resolvedById: input.user.id,
        resolvedByName: input.user.name,
        note: (input.note || '').trim() || null,
      },
    });
    const next = await tx.row.update({ where: { id: row.id }, data: { version: { increment: 1 }, updatedByName: input.user.name } });
    await writeActivity(tx, {
      datasetId: input.datasetId,
      rowId: row.id,
      userId: input.user.id,
      action: 'call_resolved',
      changes: jsonObject({ callId: call.id, note: input.note || null }),
    });
    const leaders = await userIdsByRole(tx, ['ADMIN', 'MANAGER']);
    await notifyUsers(tx, {
      userIds: leaders,
      actorId: input.user.id,
      type: 'call_resolved',
      message: `${call.type} resolved for ${row.customerName || 'a record'}.`,
      rowId: row.id,
      datasetId: input.datasetId,
    });
    return next;
  });
  emit('call.resolved', input.datasetId, saved.id, input.user.id);
  return presentRow(toStored(saved), input.today);
}

export async function revertRecord(input: {
  datasetId: string;
  rowId: string;
  version: number;
  user: AuthUser;
  today: string;
  columns: ColumnDTO[];
}): Promise<RecordDTO> {
  const saved = await prisma.$transaction(async (tx) => {
    const { row } = await locked(tx, input.datasetId, input.rowId, input.version, input.today);
    const imported = asCells(row.importedData ?? null);
    if (!Object.keys(imported).length) throw new HttpError(409, 'This row has no imported snapshot to restore.', 'CONFLICT');
    const current = asCells(row.data);
    const nextData: CellMap = { ...current };
    const restored: Record<string, string | number | null> = {};
    for (const column of input.columns) {
      if (!canEditColumn(input.user.role, column)) continue;
      const value = imported[column.key] ?? null;
      nextData[column.key] = value;
      restored[column.key] = value;
    }
    const indexed = indexesOf(nextData);
    const next = await tx.row.update({
      where: { id: row.id },
      data: {
        version: { increment: 1 }, updatedByName: input.user.name,
        data: jsonObject(nextData),
        serialNo: indexed.serialNo,
        customerName: indexed.customerName,
      },
    });
    await writeActivity(tx, {
      datasetId: input.datasetId,
      rowId: row.id,
      userId: input.user.id,
      actorName: input.user.name,
      action: 'revert_import',
      changes: jsonObject(restored),
    });
    return next;
  });
  emit('row.updated', input.datasetId, saved.id, input.user.id);
  return presentRow(toStored(saved), input.today);
}

export function mergeKey(serial: string | null, customer: string | null, equipment: string | null): { kind: 'serial' | 'equipment' | 'none'; key: string } {
  const serialNorm = normalizeToken(serial);
  const customerNorm = normalizeToken(customer);
  const equipmentNorm = normalizeToken(equipment);
  if (serialNorm) return { kind: 'serial', key: `${serialNorm}|${customerNorm}` };
  if (customerNorm) return { kind: 'equipment', key: `${customerNorm}|${equipmentNorm}` };
  return { kind: 'none', key: '' };
}

export { equipmentOf };
