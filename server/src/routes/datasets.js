import express, { Router } from 'express';
import { pool, withTransaction } from '../db.js';
import { assertUuid, asyncHandler, HttpError } from '../lib/http.js';
import { buildWorkbook, parseWorkbook } from '../lib/excel.js';
import { logAudit, loadDataset, touchDataset } from '../lib/audit.js';
import { presentDataset } from '../lib/present.js';
import { requirePermission, requireUser } from '../middleware/auth.js';
import {
  canonicalColumnKey,
  inferColumnType,
  normalizeGroupKey,
  slugKey,
  uniqueKey,
} from '../config/roles.js';
import { withStoredDays } from '../../../shared/compute.js';

const router = Router();

router.use(requireUser);
router.param('id', (req, res, next, value) => {
  try {
    assertUuid(value);
    next();
  } catch (error) {
    next(error);
  }
});
router.param('datasetId', (req, res, next, value) => {
  try {
    assertUuid(value);
    next();
  } catch (error) {
    next(error);
  }
});

router.get('/', asyncHandler(async (req, res) => {
  const result = await pool.query(
    `SELECT d.*, u.name AS uploader_name
     FROM datasets d
     LEFT JOIN users u ON u.id = d.uploaded_by
     ORDER BY d.updated_at DESC`,
  );
  res.json({ datasets: result.rows.map(presentDataset) });
}));

router.post(
  '/import',
  requirePermission('uploadExcel'),
  express.raw({
    type: [
      'application/octet-stream',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel',
    ],
    limit: '40mb',
  }),
  asyncHandler(async (req, res) => {
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      throw new HttpError(400, 'Upload the workbook as the request body.', 'VALIDATION');
    }
    let parsed;
    try {
      parsed = parseWorkbook(req.body);
    } catch (error) {
      if (error.status) throw error;
      throw new HttpError(400, 'The workbook could not be read.', 'INVALID_WORKBOOK');
    }
    const rawName = decodeHeader(req.get('x-filename')) || 'workbook.xlsx';
    const originalFilename = rawName.slice(0, 240);
    const fallback = originalFilename.replace(/\.(xlsx|xls)$/i, '');
    const name = cleanName(req.query.name || fallback) || 'Untitled sheet';

    const dataset = await withTransaction(async (client) => {
      const inserted = await client.query(
        `INSERT INTO datasets (name, original_filename, schema, uploaded_by, row_count)
         VALUES ($1, $2, $3::jsonb, $4, $5)
         RETURNING id`,
        [
          name,
          originalFilename,
          JSON.stringify({ groups: parsed.groups, columns: parsed.columns }),
          req.user.id,
          parsed.records.length,
        ],
      );
      const datasetId = inserted.rows[0].id;
      await insertRecords(client, datasetId, parsed.records);
      await logAudit(client, {
        datasetId,
        actorId: req.user.id,
        actorName: req.user.name,
        action: 'import',
        summary: `Imported ${parsed.records.length} rows from ${originalFilename}.`,
        detail: { columns: parsed.columns.length, rows: parsed.records.length },
      });
      return loadDataset(client, datasetId);
    });

    res.status(201).json({ dataset: presentDataset(dataset) });
  }),
);

router.get('/:id', asyncHandler(async (req, res) => {
  const dataset = await loadDataset(pool, req.params.id);
  if (!dataset) throw new HttpError(404, 'Dataset not found.', 'NOT_FOUND');
  res.json({ dataset: presentDataset(dataset) });
}));

router.delete('/:id', requirePermission('deleteDatasets'), asyncHandler(async (req, res) => {
  await withTransaction(async (client) => {
    const dataset = await loadDataset(client, req.params.id);
    if (!dataset) throw new HttpError(404, 'Dataset not found.', 'NOT_FOUND');
    await logAudit(client, {
      datasetId: dataset.id,
      actorId: req.user.id,
      actorName: req.user.name,
      action: 'delete_dataset',
      summary: `Deleted dataset ${dataset.name}.`,
    });
    await client.query('DELETE FROM datasets WHERE id = $1', [dataset.id]);
  });
  res.json({ ok: true });
}));

router.get('/:id/export-excel', asyncHandler(async (req, res) => {
  const dataset = await loadDataset(pool, req.params.id);
  if (!dataset) throw new HttpError(404, 'Dataset not found.', 'NOT_FOUND');
  const result = await pool.query(
    `SELECT data FROM dataset_rows WHERE dataset_id = $1 ORDER BY position ASC`,
    [dataset.id],
  );
  const rows = result.rows.map((row) => ({ data: withStoredDays(row.data) }));
  const buffer = buildWorkbook(dataset, rows);
  const filename = `${cleanName(dataset.name) || 'dataset'}.xlsx`;
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename.replace(/"/g, '')}"`);
  res.send(buffer);
}));

router.post('/:id/groups', requirePermission('alterSchema'), asyncHandler(async (req, res) => {
  const title = cleanName(req.body?.title);
  if (!title) throw new HttpError(400, 'A group title is required.', 'VALIDATION');
  const dataset = await mutateSchema(req, (schema) => {
    const base = normalizeGroupKey(title) || slugKey(title);
    if (schema.groups.some((group) => group.key === base)) {
      throw new HttpError(409, 'That group already exists.', 'CONFLICT');
    }
    schema.groups.push({ key: base, title });
    return { action: 'schema_add_group', summary: `Added group ${title}.` };
  });
  res.status(201).json({ dataset });
}));

router.patch('/:id/groups/:key', requirePermission('alterSchema'), asyncHandler(async (req, res) => {
  const title = cleanName(req.body?.title);
  if (!title) throw new HttpError(400, 'A group title is required.', 'VALIDATION');
  const dataset = await mutateSchema(req, (schema) => {
    const group = schema.groups.find((item) => item.key === req.params.key);
    if (!group) throw new HttpError(404, 'Group not found.', 'NOT_FOUND');
    group.title = title;
    return { action: 'schema_rename_group', summary: `Renamed a group to ${title}.` };
  });
  res.json({ dataset });
}));

router.delete('/:id/groups/:key', requirePermission('alterSchema'), asyncHandler(async (req, res) => {
  const dataset = await mutateSchema(req, async (schema, record, client) => {
    const group = schema.groups.find((item) => item.key === req.params.key);
    if (!group) throw new HttpError(404, 'Group not found.', 'NOT_FOUND');
    const removed = schema.columns.filter((column) => column.group === group.key);
    schema.groups = schema.groups.filter((item) => item.key !== group.key);
    schema.columns = schema.columns.filter((column) => column.group !== group.key);
    if (removed.length) {
      await client.query(
        `UPDATE dataset_rows
         SET data = data - $2::text[], updated_at = NOW()
         WHERE dataset_id = $1`,
        [record.id, removed.map((column) => column.key)],
      );
    }
    return { action: 'schema_delete_group', summary: `Removed group ${group.title}.` };
  });
  res.json({ dataset });
}));

router.post('/:id/columns', requirePermission('alterSchema'), asyncHandler(async (req, res) => {
  const label = cleanName(req.body?.label);
  const group = String(req.body?.group || '');
  const type = String(req.body?.type || 'text');
  if (!label) throw new HttpError(400, 'A column label is required.', 'VALIDATION');
  if (!['text', 'date', 'number'].includes(type)) {
    throw new HttpError(400, 'Unknown column type.', 'VALIDATION');
  }
  const dataset = await mutateSchema(req, (schema) => {
    if (!schema.groups.some((item) => item.key === group)) {
      throw new HttpError(400, 'Choose an existing group.', 'VALIDATION');
    }
    const used = new Set(schema.columns.map((column) => column.key));
    const key = uniqueKey(canonicalColumnKey(label), used);
    schema.columns.push({
      key,
      label,
      group,
      type: ['text', 'date', 'number'].includes(type) ? type : inferColumnType(key, label),
    });
    return { action: 'schema_add_column', summary: `Added column ${label}.` };
  });
  res.status(201).json({ dataset });
}));

router.patch('/:id/columns/:key', requirePermission('alterSchema'), asyncHandler(async (req, res) => {
  const label = cleanName(req.body?.label);
  if (!label) throw new HttpError(400, 'A column label is required.', 'VALIDATION');
  const dataset = await mutateSchema(req, (schema) => {
    const column = schema.columns.find((item) => item.key === req.params.key);
    if (!column) throw new HttpError(404, 'Column not found.', 'NOT_FOUND');
    column.label = label;
    if (req.body?.group) {
      const group = String(req.body.group);
      if (!schema.groups.some((item) => item.key === group)) {
        throw new HttpError(400, 'Choose an existing group.', 'VALIDATION');
      }
      column.group = group;
    }
    return { action: 'schema_rename_column', summary: `Renamed a column to ${label}.` };
  });
  res.json({ dataset });
}));

router.delete('/:id/columns/:key', requirePermission('alterSchema'), asyncHandler(async (req, res) => {
  const dataset = await mutateSchema(req, async (schema, record, client) => {
    const column = schema.columns.find((item) => item.key === req.params.key);
    if (!column) throw new HttpError(404, 'Column not found.', 'NOT_FOUND');
    schema.columns = schema.columns.filter((item) => item.key !== column.key);
    await client.query(
      `UPDATE dataset_rows
       SET data = data - $2, updated_at = NOW()
       WHERE dataset_id = $1`,
      [record.id, column.key],
    );
    return { action: 'schema_delete_column', summary: `Removed column ${column.label}.` };
  });
  res.json({ dataset });
}));

async function mutateSchema(req, mutator) {
  return withTransaction(async (client) => {
    const record = await loadDataset(client, req.params.id);
    if (!record) throw new HttpError(404, 'Dataset not found.', 'NOT_FOUND');
    const schema = {
      groups: (record.schema.groups || []).map((group) => ({ ...group })),
      columns: (record.schema.columns || []).map((column) => ({ ...column })),
    };
    const audit = await mutator(schema, record, client);
    await client.query(
      'UPDATE datasets SET schema = $2::jsonb, updated_at = NOW() WHERE id = $1',
      [record.id, JSON.stringify(schema)],
    );
    await logAudit(client, {
      datasetId: record.id,
      actorId: req.user.id,
      actorName: req.user.name,
      action: audit.action,
      summary: audit.summary,
    });
    await touchDataset(client, record.id);
    return presentDataset(await loadDataset(client, record.id));
  });
}

async function insertRecords(client, datasetId, records) {
  const batchSize = 1000;
  for (let offset = 0; offset < records.length; offset += batchSize) {
    const slice = records.slice(offset, offset + batchSize);
    const values = [];
    const placeholders = slice.map((record, index) => {
      const base = index * 3;
      values.push(datasetId, record.position, JSON.stringify(record.data));
      return `($${base + 1}, $${base + 2}, $${base + 3}::jsonb)`;
    });
    await client.query(
      `INSERT INTO dataset_rows (dataset_id, position, data)
       VALUES ${placeholders.join(', ')}`,
      values,
    );
  }
}

function cleanName(value) {
  return String(value || '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 180);
}

function decodeHeader(value) {
  if (!value) return '';
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export default router;
