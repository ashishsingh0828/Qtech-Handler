import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.ts';
import { asyncHandler, assertUuid, HttpError } from '../lib/http.ts';
import { requirePermission, requireUser } from '../middleware/auth.ts';
import { env } from '../config/env.ts';
import { addDays, todayInZone } from '../../../shared/dates.ts';
import { chipSql, countsFrom, pmsOverdueSql, type MetricCounts } from '../lib/filters.ts';
import { asCells, presentRow } from '../lib/present.ts';
import { jsonObject } from '../lib/ensureSchema.ts';
import { loadColumns, amcRecord, assignRecord, logCall, markPms, patchRecord, resolveCall, validateRecord, verifyRecord } from '../lib/records.ts';
import { emit } from '../lib/notify.ts';
import { hasPermission } from '../../../shared/permissions.ts';

const router = Router({ mergeParams: true });
router.use(requireUser);

router.param('rowId', (req, _res, next, value) => {
  try {
    assertUuid(value);
    next();
  } catch (error) {
    next(error);
  }
});

async function metrics(datasetId: string, today: string): Promise<MetricCounts> {
  const soon = addDays(today, 30);
  const pms = pmsOverdueSql(today);
  const rows = await prisma.$queryRaw<{
    all_rows: number;
    needs_validation: number;
    validation_overdue: number;
    pending_verification: number;
    amc_due: number;
    pms_overdue: number;
    followup_due: number;
    expiring_soon: number;
    duplicates: number;
    missing_dates: number;
  }[]>`
    SELECT
      COUNT(*)::int AS all_rows,
      COUNT(*) FILTER (WHERE COALESCE(data->>'validated', '') = '')::int AS needs_validation,
      COUNT(*) FILTER (WHERE data->>'validated' = 'No' AND COALESCE(data->>'validation_due', '') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' AND data->>'validation_due' < ${today})::int AS validation_overdue,
      COUNT(*) FILTER (WHERE data->>'validated' = 'Yes' AND COALESCE(data->>'verified', '') <> 'Verified OK')::int AS pending_verification,
      COUNT(*) FILTER (WHERE COALESCE(data->>'end_date', '') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' AND data->>'end_date' < ${today} AND COALESCE(NULLIF(amc_status, ''), NULLIF(data->>'amc_status', ''), '') NOT IN ('Proposal Sent', 'Acknowledged', 'Declined'))::int AS amc_due,
      COUNT(*) FILTER (WHERE ${pms})::int AS pms_overdue,
      COUNT(*) FILTER (WHERE COALESCE(data->>'next_follow_up', '') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' AND data->>'next_follow_up' <= ${today})::int AS followup_due,
      COUNT(*) FILTER (WHERE COALESCE(data->>'end_date', '') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' AND data->>'end_date' >= ${today} AND data->>'end_date' <= ${soon})::int AS expiring_soon,
      COUNT(*) FILTER (WHERE is_duplicate_suspect = TRUE)::int AS duplicates,
      COUNT(*) FILTER (WHERE COALESCE(data->>'start_date', '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' OR COALESCE(data->>'end_date', '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$')::int AS missing_dates
    FROM dataset_rows
    WHERE dataset_id = ${datasetId}::uuid
  `;
  const openCalls = await prisma.serviceCall.count({
    where: { status: 'Open', row: { datasetId } },
  });
  return countsFrom(rows[0], openCalls);
}

router.get('/', asyncHandler(async (req, res) => {
  assertUuid(String(req.params.datasetId || ''));
  const dataset = await prisma.dataset.findUnique({ where: { id: req.params.datasetId } });
  if (!dataset) throw new HttpError(404, 'Dataset not found.', 'NOT_FOUND');
  const today = todayInZone(env.timezone);
  const soon = addDays(today, 30);
  const chip = String(req.query.chip || 'all');
  const q = String(req.query.q || '').trim().slice(0, 80);
  const mine = req.query.mine === '1';
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 80));
  const offset = Math.max(0, Number(req.query.offset) || 0);
  const sort = String(req.query.sort || 'position');
  const order = sort === 'customer'
    ? Prisma.sql`customer_name ASC NULLS LAST, position ASC`
    : sort === 'serial'
      ? Prisma.sql`serial_no ASC NULLS LAST, position ASC`
      : sort === 'updated'
        ? Prisma.sql`updated_at DESC`
        : Prisma.sql`position ASC`;
  const clause = chipSql(chip, today, soon);
  const like = `%${q.replace(/[\\%_]/g, '\\$&')}%`;
  const mineSql = mine && req.user?.role === 'VALIDATOR'
    ? Prisma.sql`AND assigned_validator_id = ${req.user.id}::uuid`
    : mine && req.user?.role === 'SERVICE'
      ? Prisma.sql`AND assigned_service_id = ${req.user.id}::uuid`
      : Prisma.sql``;
  const whereSearch = q
    ? Prisma.sql`AND (
        COALESCE(customer_name, '') ILIKE ${like} ESCAPE '\\'
        OR COALESCE(serial_no, '') ILIKE ${like} ESCAPE '\\'
        OR COALESCE(data->>'city', '') ILIKE ${like} ESCAPE '\\'
        OR COALESCE(data->>'email', '') ILIKE ${like} ESCAPE '\\'
        OR COALESCE(data->>'mobile_no', '') ILIKE ${like} ESCAPE '\\'
        OR COALESCE(data->>'equipment_name', '') ILIKE ${like} ESCAPE '\\'
      )`
    : Prisma.sql``;
  const totalRows = await prisma.$queryRaw<{ total: number }[]>`
    SELECT COUNT(*)::int AS total
    FROM dataset_rows
    WHERE dataset_id = ${dataset.id}::uuid
      AND (${clause})
      ${mineSql}
      ${whereSearch}
  `;
  const list = await prisma.$queryRaw<{ id: string }[]>`
    SELECT id
    FROM dataset_rows
    WHERE dataset_id = ${dataset.id}::uuid
      AND (${clause})
      ${mineSql}
      ${whereSearch}
    ORDER BY ${order}
    LIMIT ${limit} OFFSET ${offset}
  `;
  const ids = list.map((row) => row.id);
  const records = ids.length
    ? await prisma.row.findMany({ where: { id: { in: ids } } })
    : [];
  const byId = new Map(records.map((row) => [row.id, row]));
  const counts = await metrics(dataset.id, today);
  res.json({
    today,
    timezone: env.timezone,
    total: totalRows[0]?.total || 0,
    counts,
    rows: ids.map((id) => byId.get(id)).filter((row): row is NonNullable<typeof row> => Boolean(row)).map((row) => presentRow(row, today)),
  });
}));

router.post('/', requirePermission('insertRows'), asyncHandler(async (req, res) => {
  assertUuid(String(req.params.datasetId || ''));
  if (!req.user) throw new HttpError(401, 'Sign in required.', 'UNAUTHORIZED');
  const today = todayInZone(env.timezone);
  const created = await prisma.$transaction(async (tx) => {
    const dataset = await tx.dataset.findUnique({ where: { id: req.params.datasetId } });
    if (!dataset) throw new HttpError(404, 'Dataset not found.', 'NOT_FOUND');
    await tx.row.updateMany({ where: { datasetId: dataset.id }, data: { position: { increment: 1 } } });
    const row = await tx.row.create({
      data: { datasetId: dataset.id, position: 1, version: 1, data: {} },
    });
    await tx.dataset.update({ where: { id: dataset.id }, data: { rowCount: { increment: 1 } } });
    await tx.activityLog.create({
      data: { datasetId: dataset.id, rowId: row.id, userId: req.user?.id, action: 'insert_row', changes: {} },
    });
    return row;
  });
  emit('row.inserted', created.datasetId, created.id, req.user.id);
  res.status(201).json({ row: presentRow(created, today) });
}));

router.get('/:rowId', asyncHandler(async (req, res) => {
  assertUuid(String(req.params.datasetId || ''));
  const today = todayInZone(env.timezone);
  const row = await prisma.row.findFirst({
    where: { id: req.params.rowId, datasetId: req.params.datasetId },
    include: {
      calls: { orderBy: { reportedAt: 'desc' } },
      activity: { orderBy: { createdAt: 'desc' }, take: 40, include: { user: true } },
    },
  });
  if (!row) throw new HttpError(404, 'Record not found.', 'NOT_FOUND');
  res.json({
    row: presentRow(row, today),
    calls: row.calls.map((call) => ({
      id: call.id,
      type: call.type,
      description: call.description,
      reportedAt: call.reportedAt.toISOString(),
      status: call.status,
      resolvedAt: call.resolvedAt ? call.resolvedAt.toISOString() : null,
      note: call.note,
    })),
    activity: row.activity.map((entry) => ({
      id: entry.id,
      action: entry.action,
      changes: entry.changes,
      createdAt: entry.createdAt.toISOString(),
      userName: entry.user?.name || 'System',
    })),
  });
}));

router.patch('/:rowId', asyncHandler(async (req, res) => {
  assertUuid(String(req.params.datasetId || ''));
  if (!req.user) throw new HttpError(401, 'Sign in required.', 'UNAUTHORIZED');
  const version = Number(req.body?.version);
  const updates = req.body?.updates;
  if (!Number.isInteger(version) || !updates || typeof updates !== 'object' || Array.isArray(updates)) {
    throw new HttpError(400, 'Version and updates are required.', 'VALIDATION');
  }
  const columns = await loadColumns(String(req.params.datasetId));
  const row = await patchRecord({
    datasetId: String(req.params.datasetId),
    rowId: req.params.rowId,
    version,
    updates: updates as Record<string, unknown>,
    user: req.user,
    today: todayInZone(env.timezone),
    columns,
  });
  res.json({ row });
}));

router.delete('/:rowId', requirePermission('deleteRows'), asyncHandler(async (req, res) => {
  assertUuid(String(req.params.datasetId || ''));
  if (!req.user) throw new HttpError(401, 'Sign in required.', 'UNAUTHORIZED');
  await prisma.$transaction(async (tx) => {
    const row = await tx.row.findFirst({ where: { id: req.params.rowId, datasetId: req.params.datasetId } });
    if (!row) throw new HttpError(404, 'Record not found.', 'NOT_FOUND');
    await tx.activityLog.updateMany({ where: { rowId: row.id }, data: { rowId: null } });
    await tx.row.delete({ where: { id: row.id } });
    await tx.dataset.update({ where: { id: row.datasetId }, data: { rowCount: { decrement: 1 } } });
    await tx.activityLog.create({
      data: { datasetId: row.datasetId, userId: req.user?.id, action: 'delete_row', changes: { position: row.position } },
    });
  });
  emit('row.deleted', String(req.params.datasetId), req.params.rowId, req.user.id);
  res.json({ ok: true });
}));

router.post('/:rowId/duplicate', requirePermission('duplicateRows'), asyncHandler(async (req, res) => {
  assertUuid(String(req.params.datasetId || ''));
  if (!req.user) throw new HttpError(401, 'Sign in required.', 'UNAUTHORIZED');
  const today = todayInZone(env.timezone);
  const created = await prisma.$transaction(async (tx) => {
    const row = await tx.row.findFirst({ where: { id: req.params.rowId, datasetId: req.params.datasetId } });
    if (!row) throw new HttpError(404, 'Record not found.', 'NOT_FOUND');
    const data = asCells(row.data);
    for (const key of ['validated', 'validated_by', 'validated_at', 'verified', 'verified_by', 'verified_at', 'rejection_reason', 'validation_due', 'amc_status', 'amc_state', 'amc_notes']) {
      data[key] = null;
    }
    await tx.row.updateMany({ where: { datasetId: row.datasetId }, data: { position: { increment: 1 } } });
    const copy = await tx.row.create({
      data: {
        datasetId: row.datasetId,
        position: 1,
        version: 1,
        serialNo: row.serialNo,
        customerName: row.customerName,
        data: data as Prisma.InputJsonObject,
        isDuplicateSuspect: true,
      },
    });
    await tx.dataset.update({ where: { id: row.datasetId }, data: { rowCount: { increment: 1 } } });
    await tx.activityLog.create({
      data: { datasetId: row.datasetId, rowId: copy.id, userId: req.user?.id, action: 'duplicate_row', changes: { sourceId: row.id } },
    });
    return copy;
  });
  emit('row.inserted', created.datasetId, created.id, req.user.id);
  res.status(201).json({ row: presentRow(created, today) });
}));

router.post('/:rowId/validate', requirePermission('validateRecords'), asyncHandler(async (req, res) => {
  if (!req.user) throw new HttpError(401, 'Sign in required.', 'UNAUTHORIZED');
  const decision = req.body?.decision === 'No' ? 'No' : req.body?.decision === 'Yes' ? 'Yes' : '';
  if (!decision) throw new HttpError(400, 'Decision must be Yes or No.', 'VALIDATION');
  const row = await validateRecord({
    datasetId: String(req.params.datasetId),
    rowId: req.params.rowId,
    version: Number(req.body?.version),
    decision,
    reason: req.body?.reason,
    expectedDate: req.body?.expectedDate,
    user: req.user,
    today: todayInZone(env.timezone),
  });
  res.json({ row });
}));

router.post('/:rowId/verify', requirePermission('verifyRecords'), asyncHandler(async (req, res) => {
  if (!req.user) throw new HttpError(401, 'Sign in required.', 'UNAUTHORIZED');
  const action = req.body?.action === 'revert' ? 'revert' : 'verify';
  const row = await verifyRecord({
    datasetId: String(req.params.datasetId),
    rowId: req.params.rowId,
    version: Number(req.body?.version),
    action,
    user: req.user,
    today: todayInZone(env.timezone),
  });
  res.json({ row });
}));

router.post('/:rowId/amc', requirePermission('amcActions'), asyncHandler(async (req, res) => {
  if (!req.user) throw new HttpError(401, 'Sign in required.', 'UNAUTHORIZED');
  const action = req.body?.action;
  if (action !== 'proposal_sent' && action !== 'acknowledge' && action !== 'decline') {
    throw new HttpError(400, 'Unknown AMC action.', 'VALIDATION');
  }
  const row = await amcRecord({
    datasetId: String(req.params.datasetId),
    rowId: req.params.rowId,
    version: Number(req.body?.version),
    action,
    note: req.body?.note,
    nextFollowUp: req.body?.nextFollowUp,
    user: req.user,
    today: todayInZone(env.timezone),
  });
  res.json({ row });
}));

router.post('/:rowId/pms', asyncHandler(async (req, res) => {
  if (!req.user) throw new HttpError(401, 'Sign in required.', 'UNAUTHORIZED');
  const action = req.body?.action === 'reschedule' ? 'reschedule' : 'done';
  const row = await markPms({
    datasetId: String(req.params.datasetId),
    rowId: req.params.rowId,
    version: Number(req.body?.version),
    index: Number(req.body?.index),
    action,
    date: req.body?.date,
    user: req.user,
    today: todayInZone(env.timezone),
    role: req.user.role,
  });
  res.json({ row });
}));

router.post('/:rowId/calls', asyncHandler(async (req, res) => {
  if (!req.user || !hasPermission(req.user.role, 'logCalls')) {
    throw new HttpError(403, 'You cannot log calls.', 'FORBIDDEN', { requiredPermission: 'logCalls', blockedFields: [] });
  }
  const row = await logCall({
    datasetId: String(req.params.datasetId),
    rowId: req.params.rowId,
    version: Number(req.body?.version),
    type: String(req.body?.type || ''),
    description: String(req.body?.description || ''),
    user: req.user,
    today: todayInZone(env.timezone),
  });
  res.status(201).json({ row });
}));

router.post('/:rowId/calls/:callId/resolve', asyncHandler(async (req, res) => {
  assertUuid(req.params.callId);
  if (!req.user || !hasPermission(req.user.role, 'logCalls')) {
    throw new HttpError(403, 'You cannot resolve calls.', 'FORBIDDEN', { requiredPermission: 'logCalls', blockedFields: [] });
  }
  const row = await resolveCall({
    datasetId: String(req.params.datasetId),
    rowId: req.params.rowId,
    callId: req.params.callId,
    version: Number(req.body?.version),
    note: req.body?.note,
    user: req.user,
    today: todayInZone(env.timezone),
  });
  res.json({ row });
}));

export default router;
