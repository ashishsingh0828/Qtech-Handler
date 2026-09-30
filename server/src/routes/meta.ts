import { Router } from 'express';
import { prisma } from '../lib/prisma.ts';
import { asyncHandler, HttpError } from '../lib/http.ts';
import { requireUser } from '../middleware/auth.ts';
import { addClient, removeClient } from '../lib/events.ts';
import { env } from '../config/env.ts';
import { todayInZone } from '../../../shared/dates.ts';
import { addDays } from '../../../shared/dates.ts';
import { pmsOverdueSql } from '../lib/filters.ts';

const router = Router();

function activitySummary(entry: { columnKey: string | null; fromValue: string | null; toValue: string | null; changes: unknown }): string {
  if (entry.columnKey) return `${entry.columnKey}: ${entry.fromValue || '—'} → ${entry.toValue || '—'}`;
  if (entry.changes && typeof entry.changes === 'object' && !Array.isArray(entry.changes)) {
    const record = entry.changes as Record<string, unknown>;
    const label = record.customerName ?? record.name;
    if (typeof label === 'string' && label) return label;
  }
  return '';
}

router.get('/events', requireUser, (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();
  res.write(`data: ${JSON.stringify({ type: 'hello', datasetId: null, rowId: null, actorId: req.user?.id || '' })}\n\n`);
  addClient(res);
  const beat = setInterval(() => {
    res.write(': keep-alive\n\n');
  }, 25000);
  req.on('close', () => {
    clearInterval(beat);
    removeClient(res);
  });
});

router.get('/notifications', requireUser, asyncHandler(async (req, res) => {
  const notifications = await prisma.notification.findMany({
    where: { userId: req.user?.id },
    orderBy: { createdAt: 'desc' },
    take: 40,
  });
  const unread = await prisma.notification.count({ where: { userId: req.user?.id, isRead: false } });
  res.json({
    unread,
    notifications: notifications.map((item) => ({
      id: item.id,
      type: item.type,
      message: item.message,
      rowId: item.rowId,
      datasetId: item.datasetId,
      priority: item.priority,
      isRead: item.isRead,
      createdAt: item.createdAt.toISOString(),
    })),
  });
}));

router.post('/notifications/:id/read', requireUser, asyncHandler(async (req, res) => {
  await prisma.notification.updateMany({
    where: { id: req.params.id, userId: req.user?.id },
    data: { isRead: true },
  });
  res.json({ ok: true });
}));

router.post('/notifications/read-all', requireUser, asyncHandler(async (req, res) => {
  await prisma.notification.updateMany({ where: { userId: req.user?.id, isRead: false }, data: { isRead: true } });
  res.json({ ok: true });
}));

router.get('/activity', requireUser, asyncHandler(async (req, res) => {
  const datasetId = typeof req.query.datasetId === 'string' && req.query.datasetId ? req.query.datasetId : undefined;
  const entries = await prisma.activityLog.findMany({
    where: datasetId ? { datasetId } : {},
    orderBy: { createdAt: 'desc' },
    take: 80,
    include: { user: true, dataset: true },
  });
  res.json({
    activity: entries.map((entry) => ({
      id: entry.id,
      action: entry.action,
      changes: entry.changes,
      datasetId: entry.datasetId,
      datasetName: entry.dataset?.name || '',
      rowId: entry.rowId,
      createdAt: entry.createdAt.toISOString(),
      userName: entry.user?.name || entry.actorName || 'System',
      summary: activitySummary(entry),
    })),
  });
}));

router.get('/dashboard', requireUser, asyncHandler(async (req, res) => {
  const datasetId = typeof req.query.datasetId === 'string' ? req.query.datasetId : '';
  const today = todayInZone(env.timezone);
  const soon = addDays(today, 30);
  const activeUsers = await prisma.user.count({ where: { isActive: true } });
  if (!datasetId) {
    res.json({
      today,
      timezone: env.timezone,
      activeUsers,
      counts: null,
      activity: [],
      workload: [],
      health: null,
    });
    return;
  }
  const dataset = await prisma.dataset.findUnique({ where: { id: datasetId } });
  if (!dataset) throw new HttpError(404, 'Dataset not found.', 'NOT_FOUND');
  const pms = pmsOverdueSql(today);
  const counts = await prisma.$queryRaw<{
    needs_validation: number;
    validation_overdue: number;
    pending_verification: number;
    amc_due: number;
    pms_overdue: number;
    followup_due: number;
    expiring_soon: number;
    duplicates: number;
    missing_dates: number;
    validated_today: number;
  }[]>`
    SELECT
      COUNT(*) FILTER (WHERE COALESCE(data->>'validated', '') = '')::int AS needs_validation,
      COUNT(*) FILTER (WHERE data->>'validated' = 'No' AND COALESCE(data->>'validation_due', '') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' AND data->>'validation_due' < ${today})::int AS validation_overdue,
      COUNT(*) FILTER (WHERE data->>'validated' = 'Yes' AND COALESCE(data->>'verified', '') <> 'Verified OK')::int AS pending_verification,
      COUNT(*) FILTER (WHERE COALESCE(data->>'end_date', '') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' AND data->>'end_date' < ${today} AND COALESCE(NULLIF(amc_status, ''), NULLIF(data->>'amc_status', ''), '') NOT IN ('Proposal Sent', 'Acknowledged', 'Declined'))::int AS amc_due,
      COUNT(*) FILTER (WHERE ${pms})::int AS pms_overdue,
      COUNT(*) FILTER (WHERE COALESCE(data->>'next_follow_up', '') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' AND data->>'next_follow_up' <= ${today})::int AS followup_due,
      COUNT(*) FILTER (WHERE COALESCE(data->>'end_date', '') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' AND data->>'end_date' >= ${today} AND data->>'end_date' <= ${soon})::int AS expiring_soon,
      COUNT(*) FILTER (WHERE is_duplicate_suspect = TRUE)::int AS duplicates,
      COUNT(*) FILTER (WHERE COALESCE(data->>'start_date', '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' OR COALESCE(data->>'end_date', '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$')::int AS missing_dates,
      COUNT(*) FILTER (WHERE to_char(validated_at AT TIME ZONE ${env.timezone}, 'YYYY-MM-DD') = ${today})::int AS validated_today
    FROM dataset_rows
    WHERE dataset_id = ${datasetId}::uuid
  `;
  const openCalls = await prisma.serviceCall.count({ where: { status: 'Open', row: { datasetId } } });
  const activity = await prisma.activityLog.findMany({
    where: { datasetId },
    orderBy: { createdAt: 'desc' },
    take: 15,
    include: { user: true },
  });
  const workload = await prisma.$queryRaw<{ user_id: string; name: string; total: number }[]>`
    SELECT u.id AS user_id, u.name, COUNT(r.id)::int AS total
    FROM users u
    LEFT JOIN dataset_rows r ON r.assigned_validator_id = u.id AND r.dataset_id = ${datasetId}::uuid
    WHERE u.role = 'VALIDATOR' AND u.active = TRUE
    GROUP BY u.id, u.name
    ORDER BY total DESC, u.name ASC
  `;
  const duplicateSerials = await prisma.$queryRaw<{ serial_no: string; total: number }[]>`
    SELECT serial_no, COUNT(*)::int AS total
    FROM dataset_rows
    WHERE dataset_id = ${datasetId}::uuid AND COALESCE(serial_no, '') <> ''
    GROUP BY serial_no
    HAVING COUNT(*) > 1
    ORDER BY total DESC
    LIMIT 6
  `;
  res.json({
    today,
    timezone: env.timezone,
    activeUsers,
    openCalls,
    counts: counts[0] || null,
    activity: activity.map((entry) => ({
      id: entry.id,
      action: entry.action,
      rowId: entry.rowId,
      createdAt: entry.createdAt.toISOString(),
      userName: entry.user?.name || entry.actorName || 'System',
      changes: entry.changes,
    })),
    workload,
    health: {
      duplicateSerials,
      missingDates: counts[0]?.missing_dates || 0,
      duplicateSuspects: counts[0]?.duplicates || 0,
    },
  });
}));

export default router;
