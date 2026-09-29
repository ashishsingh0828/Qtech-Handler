import { Router } from 'express';
import { pool, withTransaction } from '../db.js';
import { assertUuid, asyncHandler, HttpError } from '../lib/http.js';
import { logAudit, loadDataset, touchDataset } from '../lib/audit.js';
import { customerLabel, presentAudit, presentRow } from '../lib/present.js';
import { fetchDatasetCounts, tabClause } from '../lib/metrics.js';
import { todayISO } from '../lib/time.js';
import { notifyManagers } from '../lib/notify.js';
import { requirePermission, requireUser } from '../middleware/auth.js';
import { canEditColumn } from '../config/roles.js';
import { amcTransition, asISODate, warrantyStatus, withStoredDays } from '../../../shared/compute.js';
import { env } from '../config/env.js';

const router = Router({ mergeParams: true });

router.use(requireUser);
router.param('rowId', (req, res, next, value) => {
  try {
    assertUuid(value);
    next();
  } catch (error) {
    next(error);
  }
});

router.get('/', asyncHandler(async (req, res) => {
  const dataset = await loadDataset(pool, req.params.datasetId);
  if (!dataset) throw new HttpError(404, 'Dataset not found.', 'NOT_FOUND');
  const today = todayISO();
  const tab = String(req.query.tab || 'all');
  const q = String(req.query.q || '').trim().slice(0, 80);
  const limit = clamp(req.query.limit, 150, 1, 500);
  const offset = clamp(req.query.offset, 0, 0, 1000000);
  const params = [dataset.id, today];
  const where = ['dataset_id = $1'];
  const clause = tabClause(tab, '$2');
  if (clause) where.push(clause);
  if (q) {
    params.push(`%${q.replace(/[\\%_]/g, '\\$&')}%`);
    const token = `$${params.length}`;
    where.push(`(
      COALESCE(data->>'customer_name', '') ILIKE ${token} ESCAPE '\\'
      OR COALESCE(data->>'city', '') ILIKE ${token} ESCAPE '\\'
      OR COALESCE(data->>'serial_no', '') ILIKE ${token} ESCAPE '\\'
      OR COALESCE(data->>'mobile_no', '') ILIKE ${token} ESCAPE '\\'
      OR COALESCE(data->>'equipment_name', '') ILIKE ${token} ESCAPE '\\'
      OR COALESCE(data->>'sr_no', '') ILIKE ${token} ESCAPE '\\'
    )`);
  }
  const whereSql = where.join(' AND ');
  const totalResult = await pool.query(
    `SELECT COUNT(*)::int AS total FROM dataset_rows WHERE ${whereSql}`,
    params,
  );
  const limitIndex = params.length + 1;
  params.push(limit);
  const offsetIndex = params.length + 1;
  params.push(offset);
  const rows = await pool.query(
    `SELECT * FROM dataset_rows
     WHERE ${whereSql}
     ORDER BY position ASC
     LIMIT $${limitIndex} OFFSET $${offsetIndex}`,
    params,
  );
  const counts = await fetchDatasetCounts(pool, dataset.id, today);
  res.json({
    today,
    timezone: env.timezone,
    tab,
    total: totalResult.rows[0].total,
    counts,
    rows: rows.rows.map((row) => presentRow(row, today, dataset.schema.columns)),
  });
}));

router.post('/', requirePermission('insertRows'), asyncHandler(async (req, res) => {
  const today = todayISO();
  const created = await withTransaction(async (client) => {
    const dataset = await lockDataset(client, req.params.datasetId);
    const positionResult = await client.query(
      'SELECT COALESCE(MAX(position), 0) + 1 AS position FROM dataset_rows WHERE dataset_id = $1',
      [dataset.id],
    );
    const inserted = await client.query(
      `INSERT INTO dataset_rows (dataset_id, position, data)
       VALUES ($1, $2, '{}'::jsonb)
       RETURNING *`,
      [dataset.id, positionResult.rows[0].position],
    );
    await client.query('UPDATE datasets SET row_count = row_count + 1, updated_at = NOW() WHERE id = $1', [dataset.id]);
    await logAudit(client, {
      datasetId: dataset.id,
      rowId: inserted.rows[0].id,
      actorId: req.user.id,
      actorName: req.user.name,
      action: 'insert_row',
      summary: `Inserted row ${inserted.rows[0].position}.`,
    });
    return { dataset, row: inserted.rows[0] };
  });
  const counts = await fetchDatasetCounts(pool, created.dataset.id, today);
  res.status(201).json({
    row: presentRow(created.row, today, created.dataset.schema.columns),
    counts,
  });
}));

router.get('/:rowId', asyncHandler(async (req, res) => {
  const dataset = await loadDataset(pool, req.params.datasetId);
  if (!dataset) throw new HttpError(404, 'Dataset not found.', 'NOT_FOUND');
  const row = await pool.query(
    'SELECT * FROM dataset_rows WHERE id = $1 AND dataset_id = $2',
    [req.params.rowId, dataset.id],
  );
  if (!row.rowCount) throw new HttpError(404, 'Row not found.', 'NOT_FOUND');
  const activity = await pool.query(
    `SELECT * FROM audit_log
     WHERE row_id = $1
     ORDER BY created_at DESC
     LIMIT 80`,
    [row.rows[0].id],
  );
  const today = todayISO();
  res.json({
    today,
    row: presentRow(row.rows[0], today, dataset.schema.columns),
    activity: activity.rows.map(presentAudit),
  });
}));

router.patch('/:rowId', asyncHandler(async (req, res) => {
  const updates = req.body?.updates;
  if (!updates || typeof updates !== 'object' || Array.isArray(updates)) {
    throw new HttpError(400, 'Updates are required.', 'VALIDATION');
  }
  const keys = Object.keys(updates);
  if (!keys.length) throw new HttpError(400, 'Updates are required.', 'VALIDATION');

  const today = todayISO();
  const saved = await withTransaction(async (client) => {
    const dataset = await lockDataset(client, req.params.datasetId);
    const blocked = keys.filter((key) => !canEditColumn(req.user.role, key, dataset.schema));
    if (blocked.length) {
      throw new HttpError(403, 'Forbidden', 'FORBIDDEN', { blockedFields: blocked });
    }
    const current = await lockRow(client, dataset.id, req.params.rowId);
    const data = { ...(current.data || {}) };
    const labels = [];
    for (const key of keys) {
      const column = dataset.schema.columns.find((item) => item.key === key);
      data[key] = coerceValue(column, updates[key]);
      labels.push(column?.label || key);
    }
    const stored = withStoredDays(data);
    const updated = await client.query(
      `UPDATE dataset_rows
       SET data = $3::jsonb, updated_at = NOW()
       WHERE id = $1 AND dataset_id = $2
       RETURNING *`,
      [current.id, dataset.id, JSON.stringify(stored)],
    );
    await touchDataset(client, dataset.id);
    await logAudit(client, {
      datasetId: dataset.id,
      rowId: current.id,
      actorId: req.user.id,
      actorName: req.user.name,
      action: 'cell_update',
      summary: `Updated ${labels.join(', ')} on ${customerLabel(stored)}.`,
      detail: { fields: keys },
    });
    return { dataset, row: updated.rows[0], keys };
  });

  if (req.user.role === 'service' && touchesWatchedGroups(saved.dataset.schema, saved.keys)) {
    await safeNotify({
      actor: req.user,
      datasetId: saved.dataset.id,
      rowId: saved.row.id,
      kind: 'service_update',
      message: `${req.user.name} updated AMC / PMS data for ${customerLabel(saved.row.data)}.`,
    });
  }

  const counts = await fetchDatasetCounts(pool, saved.dataset.id, today);
  res.json({
    row: presentRow(saved.row, today, saved.dataset.schema.columns),
    counts,
  });
}));

router.delete('/:rowId', requirePermission('deleteRows'), asyncHandler(async (req, res) => {
  const today = todayISO();
  const datasetId = await withTransaction(async (client) => {
    const dataset = await lockDataset(client, req.params.datasetId);
    const current = await lockRow(client, dataset.id, req.params.rowId);
    await client.query('DELETE FROM dataset_rows WHERE id = $1', [current.id]);
    await client.query(
      'UPDATE datasets SET row_count = GREATEST(row_count - 1, 0), updated_at = NOW() WHERE id = $1',
      [dataset.id],
    );
    await logAudit(client, {
      datasetId: dataset.id,
      rowId: current.id,
      actorId: req.user.id,
      actorName: req.user.name,
      action: 'delete_row',
      summary: `Deleted row ${current.position} (${customerLabel(current.data)}).`,
    });
    return dataset.id;
  });
  const counts = await fetchDatasetCounts(pool, datasetId, today);
  res.json({ ok: true, counts });
}));

router.post('/:rowId/duplicate', requirePermission('duplicateRows'), asyncHandler(async (req, res) => {
  const today = todayISO();
  const saved = await withTransaction(async (client) => {
    const dataset = await lockDataset(client, req.params.datasetId);
    const current = await lockRow(client, dataset.id, req.params.rowId);
    await client.query(
      `UPDATE dataset_rows
       SET position = position + 1
       WHERE dataset_id = $1 AND position > $2`,
      [dataset.id, current.position],
    );
    const inserted = await client.query(
      `INSERT INTO dataset_rows (dataset_id, position, data)
       VALUES ($1, $2, $3::jsonb)
       RETURNING *`,
      [dataset.id, current.position + 1, JSON.stringify(businessCopy(current.data))],
    );
    await client.query(
      'UPDATE datasets SET row_count = row_count + 1, updated_at = NOW() WHERE id = $1',
      [dataset.id],
    );
    await logAudit(client, {
      datasetId: dataset.id,
      rowId: inserted.rows[0].id,
      actorId: req.user.id,
      actorName: req.user.name,
      action: 'duplicate_row',
      summary: `Duplicated row ${current.position}.`,
    });
    return { dataset, row: inserted.rows[0] };
  });
  const counts = await fetchDatasetCounts(pool, saved.dataset.id, today);
  res.status(201).json({
    row: presentRow(saved.row, today, saved.dataset.schema.columns),
    counts,
  });
}));

router.post('/:rowId/validate', requirePermission('validateRecords'), asyncHandler(async (req, res) => {
  const result = req.body?.result;
  if (result !== 'Yes' && result !== 'No') {
    throw new HttpError(400, 'Result must be Yes or No.', 'VALIDATION');
  }
  const today = todayISO();
  const saved = await withTransaction(async (client) => {
    const dataset = await lockDataset(client, req.params.datasetId);
    const current = await lockRow(client, dataset.id, req.params.rowId);
    const data = { ...(current.data || {}) };
    const now = new Date().toISOString();
    if (result === 'Yes') {
      data.validated = 'Yes';
      data.validated_by = req.user.name;
      data.validated_at = now;
      data.rejection_reason = '';
      data.validation_due = '';
    } else {
      const reason = String(req.body?.rejectionReason || '').trim();
      const expected = asISODate(req.body?.expectedDate);
      if (reason.length < 5) {
        throw new HttpError(400, 'A rejection reason of at least 5 characters is required.', 'VALIDATION');
      }
      if (!expected) throw new HttpError(400, 'An expected date is required.', 'VALIDATION');
      data.validated = 'No';
      data.validated_by = req.user.name;
      data.validated_at = now;
      data.rejection_reason = reason.slice(0, 2000);
      data.validation_due = expected;
    }
    const stored = withStoredDays(data);
    const updated = await client.query(
      `UPDATE dataset_rows SET data = $3::jsonb, updated_at = NOW()
       WHERE id = $1 AND dataset_id = $2 RETURNING *`,
      [current.id, dataset.id, JSON.stringify(stored)],
    );
    await touchDataset(client, dataset.id);
    await logAudit(client, {
      datasetId: dataset.id,
      rowId: current.id,
      actorId: req.user.id,
      actorName: req.user.name,
      action: 'validate',
      summary: result === 'Yes'
        ? `Validated ${customerLabel(stored)}.`
        : `Returned ${customerLabel(stored)} with a rejection.`,
      detail: { result },
    });
    return { dataset, row: updated.rows[0] };
  });

  if (req.user.role === 'validator') {
    await safeNotify({
      actor: req.user,
      datasetId: saved.dataset.id,
      rowId: saved.row.id,
      kind: 'validation',
      message: `${req.user.name} recorded a validation decision for ${customerLabel(saved.row.data)}.`,
    });
  }

  const counts = await fetchDatasetCounts(pool, saved.dataset.id, today);
  res.json({
    row: presentRow(saved.row, today, saved.dataset.schema.columns),
    counts,
  });
}));

router.post('/:rowId/verify', requirePermission('verifyRecords'), asyncHandler(async (req, res) => {
  if (typeof req.body?.verified !== 'boolean') {
    throw new HttpError(400, 'Verified must be true or false.', 'VALIDATION');
  }
  const today = todayISO();
  const saved = await withTransaction(async (client) => {
    const dataset = await lockDataset(client, req.params.datasetId);
    const current = await lockRow(client, dataset.id, req.params.rowId);
    if (current.data?.validated !== 'Yes') {
      throw new HttpError(409, 'Record has not been validated.', 'CONFLICT');
    }
    const data = { ...(current.data || {}) };
    data.verified = req.body.verified ? 'Verified OK' : 'Pending';
    data.verified_by = req.user.name;
    data.verified_at = new Date().toISOString();
    const stored = withStoredDays(data);
    const updated = await client.query(
      `UPDATE dataset_rows SET data = $3::jsonb, updated_at = NOW()
       WHERE id = $1 AND dataset_id = $2 RETURNING *`,
      [current.id, dataset.id, JSON.stringify(stored)],
    );
    await touchDataset(client, dataset.id);
    await logAudit(client, {
      datasetId: dataset.id,
      rowId: current.id,
      actorId: req.user.id,
      actorName: req.user.name,
      action: 'verify',
      summary: req.body.verified
        ? `Verified ${customerLabel(stored)}.`
        : `Reset verification on ${customerLabel(stored)} to Pending.`,
    });
    return { dataset, row: updated.rows[0] };
  });
  const counts = await fetchDatasetCounts(pool, saved.dataset.id, today);
  res.json({
    row: presentRow(saved.row, today, saved.dataset.schema.columns),
    counts,
  });
}));

router.post('/:rowId/amc', requirePermission('amcActions'), asyncHandler(async (req, res) => {
  const action = String(req.body?.action || '');
  const today = todayISO();
  const saved = await withTransaction(async (client) => {
    const dataset = await lockDataset(client, req.params.datasetId);
    const current = await lockRow(client, dataset.id, req.params.rowId);
    const data = { ...(current.data || {}) };
    const warranty = warrantyStatus(data.end_date, today);
    const transition = amcTransition(data.amc_state, action, warranty);
    if (transition.error) throw new HttpError(409, transition.error, 'CONFLICT');
    const notes = String(req.body?.notes || '').trim();
    const followRaw = req.body?.nextFollowUp;
    const nextFollowUp = followRaw ? asISODate(followRaw) : '';
    if ((action === 'acknowledge' || action === 'decline') && notes.length < 5) {
      throw new HttpError(400, 'Notes of at least 5 characters are required.', 'VALIDATION');
    }
    if (action === 'acknowledge' && !nextFollowUp) {
      throw new HttpError(400, 'A next follow-up date is required.', 'VALIDATION');
    }
    if (followRaw && !nextFollowUp) {
      throw new HttpError(400, 'Invalid follow-up date.', 'INVALID_DATE');
    }
    const now = new Date().toISOString();
    data.amc_state = transition.state;
    if (action === 'proposal_sent') {
      data.proposal_sent_at = now;
      data.amc_decided_at = '';
    } else {
      data.amc_notes = notes.slice(0, 2000);
      data.amc_decided_at = now;
      if (nextFollowUp) data.next_follow_up = nextFollowUp;
    }
    const stored = withStoredDays(data);
    const updated = await client.query(
      `UPDATE dataset_rows SET data = $3::jsonb, updated_at = NOW()
       WHERE id = $1 AND dataset_id = $2 RETURNING *`,
      [current.id, dataset.id, JSON.stringify(stored)],
    );
    await touchDataset(client, dataset.id);
    const verb = action === 'proposal_sent' ? 'Sent an AMC proposal for' : action === 'acknowledge' ? 'Acknowledged AMC for' : 'Declined AMC for';
    await logAudit(client, {
      datasetId: dataset.id,
      rowId: current.id,
      actorId: req.user.id,
      actorName: req.user.name,
      action: 'amc',
      summary: `${verb} ${customerLabel(stored)}.`,
      detail: { action, state: transition.state },
    });
    return { dataset, row: updated.rows[0] };
  });

  if (req.user.role === 'service') {
    await safeNotify({
      actor: req.user,
      datasetId: saved.dataset.id,
      rowId: saved.row.id,
      kind: 'service_update',
      message: `${req.user.name} updated AMC / PMS data for ${customerLabel(saved.row.data)}.`,
    });
  }

  const counts = await fetchDatasetCounts(pool, saved.dataset.id, today);
  res.json({
    row: presentRow(saved.row, today, saved.dataset.schema.columns),
    counts,
  });
}));

async function lockDataset(client, id) {
  const result = await client.query(
    `SELECT d.*, u.name AS uploader_name
     FROM datasets d
     LEFT JOIN users u ON u.id = d.uploaded_by
     WHERE d.id = $1
     FOR UPDATE OF d`,
    [id],
  );
  if (!result.rowCount) throw new HttpError(404, 'Dataset not found.', 'NOT_FOUND');
  return result.rows[0];
}

async function lockRow(client, datasetId, rowId) {
  const result = await client.query(
    `SELECT * FROM dataset_rows WHERE id = $1 AND dataset_id = $2 FOR UPDATE`,
    [rowId, datasetId],
  );
  if (!result.rowCount) throw new HttpError(404, 'Row not found.', 'NOT_FOUND');
  return result.rows[0];
}

function coerceValue(column, value) {
  if (value == null || value === '') return '';
  if (column?.type === 'date') {
    const iso = asISODate(value);
    if (!iso) throw new HttpError(400, 'Invalid date.', 'INVALID_DATE', { field: column.key });
    return iso;
  }
  if (column?.type === 'number') {
    const numeric = typeof value === 'number' ? value : Number(String(value).replace(/,/g, '').trim());
    if (!Number.isFinite(numeric)) {
      throw new HttpError(400, 'Invalid number.', 'INVALID_NUMBER', { field: column.key });
    }
    return numeric;
  }
  return String(value).slice(0, 4000);
}

function businessCopy(data) {
  const next = { ...(data || {}) };
  const clear = [
    'validated', 'validated_by', 'validated_at',
    'verified', 'verified_by', 'verified_at',
    'rejection_reason', 'validation_due',
    'amc_state', 'amc_notes', 'proposal_sent_at', 'amc_decided_at',
  ];
  for (const key of clear) delete next[key];
  return withStoredDays(next);
}

function touchesWatchedGroups(schema, keys) {
  return keys.some((key) => {
    const column = schema.columns.find((item) => item.key === key);
    return column && (column.group === 'amc' || column.group === 'schedule_services');
  });
}

async function safeNotify(payload) {
  try {
    await notifyManagers(payload);
  } catch (error) {
    console.error('Notification failed', error);
  }
}

function clamp(value, fallback, min, max) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(numeric)));
}

export default router;
