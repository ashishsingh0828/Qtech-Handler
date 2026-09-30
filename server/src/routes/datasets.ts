import { Router } from 'express';
import { prisma } from '../lib/prisma.ts';
import { asyncHandler, assertUuid, HttpError } from '../lib/http.ts';
import { requirePermission, requireUser } from '../middleware/auth.ts';
import { buildCsv, buildWorkbook, parseWorkbook, type ExportCall, type ParsedColumn } from '../lib/excel.ts';
import { jsonObject } from '../lib/ensureSchema.ts';
import { asCells, equipmentOf, indexesOf } from '../lib/present.ts';
import { mergeKey } from '../lib/records.ts';
import { emit } from '../lib/notify.ts';
import { todayInZone } from '../../../shared/dates.ts';
import { env } from '../config/env.ts';
import { GROUP_CATALOG, isServerField, normalizeGroupKey, semanticTagFor } from '../../../shared/permissions.ts';
import type { Prisma } from '@prisma/client';
import type { CellMap } from '../../../shared/metrics.ts';

const router = Router();
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
router.use(requireUser);

function chunks<T>(items: T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let index = 0; index < items.length; index += size) batches.push(items.slice(index, index + size));
  return batches;
}

function groupTitleFor(key: string, stored: string | null | undefined): string {
  if (stored && stored.trim()) return stored;
  return GROUP_CATALOG.find((group) => group.key === key)?.title || key;
}

router.get('/', asyncHandler(async (_req, res) => {
  const datasets = await prisma.dataset.findMany({ orderBy: { updatedAt: 'desc' } });
  res.json({
    datasets: datasets.map((dataset) => ({
      id: dataset.id,
      name: dataset.name,
      rowCount: dataset.rowCount,
      columnCount: dataset.columnCount,
      createdAt: dataset.createdAt.toISOString(),
      updatedAt: dataset.updatedAt.toISOString(),
    })),
  });
}));

router.get('/:id', asyncHandler(async (req, res) => {
  assertUuid(req.params.id);
  const dataset = await prisma.dataset.findUnique({
    where: { id: req.params.id },
    include: { columns: { orderBy: { displayOrder: 'asc' } } },
  });
  if (!dataset) throw new HttpError(404, 'Dataset not found.', 'NOT_FOUND');
  res.json({
    dataset: {
      id: dataset.id,
      name: dataset.name,
      rowCount: dataset.rowCount,
      columnCount: dataset.columnCount,
      createdAt: dataset.createdAt.toISOString(),
      updatedAt: dataset.updatedAt.toISOString(),
      columns: dataset.columns,
    },
  });
}));

router.delete('/:id', requirePermission('deleteDatasets'), asyncHandler(async (req, res) => {
  assertUuid(req.params.id);
  if (!req.user) throw new HttpError(401, 'Sign in required.', 'UNAUTHORIZED');
  const dataset = await prisma.dataset.findUnique({ where: { id: req.params.id } });
  if (!dataset) throw new HttpError(404, 'Dataset not found.', 'NOT_FOUND');
  await prisma.$transaction(async (tx) => {
    await tx.activityLog.create({
      data: {
        datasetId: dataset.id,
        userId: req.user?.id,
        action: 'delete_dataset',
        changes: jsonObject({ name: dataset.name }),
      },
    });
    await tx.dataset.delete({ where: { id: dataset.id } });
  });
  emit('dataset.deleted', dataset.id, null, req.user.id);
  res.json({ ok: true });
}));

router.post('/import', requirePermission('uploadExcel'), asyncHandler(async (req, res) => {
  if (!req.user) throw new HttpError(401, 'Sign in required.', 'UNAUTHORIZED');
  const buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.from([]);
  if (!buffer.length) throw new HttpError(400, 'Upload an Excel workbook.', 'VALIDATION');
  if (buffer.length > MAX_UPLOAD_BYTES) throw new HttpError(400, 'This file is larger than 25 MB.', 'TOO_LARGE');
  let filename = 'workbook.xlsx';
  try {
    filename = decodeURIComponent(String(req.get('x-filename') || 'workbook.xlsx')).slice(0, 240);
  } catch {
    filename = 'workbook.xlsx';
  }
  if (!/\.(xlsx|xls|csv)$/i.test(filename)) throw new HttpError(400, 'Upload an Excel file (.xlsx or .xls).', 'WRONG_TYPE');
  let parsed;
  try {
    parsed = parseWorkbook(buffer);
  } catch (error) {
    const status = error instanceof Error && 'status' in error ? Number((error as { status?: number }).status) : 400;
    const code = error instanceof Error && 'code' in error ? String((error as { code?: string }).code) : 'IMPORT';
    throw new HttpError(status || 400, error instanceof Error ? error.message : 'Import failed.', code || 'IMPORT');
  }
  const name = filename.replace(/\.(xlsx|xls|csv)$/i, '') || 'Workbook';
  const datasetId = typeof req.query.datasetId === 'string' ? req.query.datasetId : '';
  if (datasetId) assertUuid(datasetId);
  const today = todayInZone(env.timezone);
  const summary = await prisma.$transaction(async (tx) => {
    let dataset = datasetId
      ? await tx.dataset.findUnique({ where: { id: datasetId }, include: { columns: true, rows: true } })
      : null;
    if (datasetId && !dataset) throw new HttpError(404, 'Dataset not found.', 'NOT_FOUND');
    if (!dataset) {
      dataset = await tx.dataset.create({
        data: {
          name,
          createdById: req.user?.id,
          rowCount: 0,
          columnCount: parsed.columns.length,
          columns: {
            create: parsed.columns.map((column) => ({
              key: column.key,
              label: column.label,
              groupKey: column.groupKey,
              groupTitle: column.groupTitle,
              semanticTag: column.semanticTag,
              dataType: column.dataType,
              displayOrder: column.displayOrder,
              isSystem: column.isSystem,
            })),
          },
        },
        include: { columns: true, rows: true },
      });
    } else {
      const current = dataset;
      const known = new Set(current.columns.map((column) => column.key));
      const additions = parsed.columns.filter((column) => !known.has(column.key));
      if (additions.length) {
        await tx.columnDefinition.createMany({
          data: additions.map((column, index) => ({
            datasetId: current.id,
            key: column.key,
            label: column.label,
            groupKey: column.groupKey,
            groupTitle: column.groupTitle,
            semanticTag: column.semanticTag,
            dataType: column.dataType,
            displayOrder: current.columns.length + index,
            isSystem: column.isSystem,
          })),
        });
      }
    }
    const existing = dataset.rows;
    const serialMap = new Map<string, typeof existing>();
    const equipMap = new Map<string, typeof existing>();
    for (const row of existing) {
      const cells = asCells(row.data);
      const key = mergeKey(row.serialNo, row.customerName, equipmentOf(cells));
      const bucket = key.kind === 'serial' ? serialMap : key.kind === 'equipment' ? equipMap : null;
      if (!bucket || !key.key) continue;
      const list = bucket.get(key.key) || [];
      list.push(row);
      bucket.set(key.key, list);
    }
    let inserted = 0;
    let updated = 0;
    let duplicates = 0;
    let position = existing.reduce((max, row) => Math.max(max, row.position), 0);
    const inserts: Prisma.RowCreateManyInput[] = [];
    for (const record of parsed.records) {
      const key = mergeKey(record.serialNo, record.customerName, record.equipmentName);
      const matches = key.kind === 'serial'
        ? serialMap.get(key.key) || []
        : key.kind === 'equipment'
          ? equipMap.get(key.key) || []
          : [];
      if (matches.length === 1) {
        const current = matches[0];
        const data: CellMap = { ...asCells(current.data) };
        for (const [field, value] of Object.entries(record.data)) {
          if (!isServerField(field)) data[field] = value;
        }
        const indexed = indexesOf(data);
        await tx.row.update({
          where: { id: current.id },
          data: {
            version: { increment: 1 },
            data: jsonObject(data),
            serialNo: indexed.serialNo,
            customerName: indexed.customerName,
            ...(current.importedData == null ? { importedData: jsonObject(record.data) } : {}),
          },
        });
        updated += 1;
      } else {
        position += 1;
        const suspect = matches.length > 1;
        if (suspect) duplicates += 1;
        const indexed = indexesOf(record.data);
        inserts.push({
          datasetId: dataset.id,
          position,
          version: 1,
          serialNo: indexed.serialNo,
          customerName: indexed.customerName,
          data: jsonObject(record.data),
          importedData: jsonObject(record.data),
          isDuplicateSuspect: suspect,
        });
        inserted += 1;
      }
    }
    for (const batch of chunks(inserts, 400)) {
      await tx.row.createMany({ data: batch });
    }
    const rowCount = await tx.row.count({ where: { datasetId: dataset.id } });
    const columnCount = await tx.columnDefinition.count({ where: { datasetId: dataset.id } });
    await tx.dataset.update({
      where: { id: dataset.id },
      data: { rowCount, columnCount },
    });
    await tx.activityLog.create({
      data: {
        datasetId: dataset.id,
        userId: req.user?.id,
        action: 'import',
        changes: jsonObject({ filename, inserted, updated, duplicates }),
      },
    });
    return { id: dataset.id, name: dataset.name, inserted, updated, duplicates, rowCount, columnCount, groups: parsed.groups.length };
  }, { timeout: 120_000, maxWait: 20_000 });
  emit('dataset.imported', summary.id, null, req.user.id);
  res.json({ dataset: summary, today });
}));

router.get('/:id/export', asyncHandler(async (req, res) => {
  assertUuid(req.params.id);
  const dataset = await prisma.dataset.findUnique({
    where: { id: req.params.id },
    include: { columns: { orderBy: { displayOrder: 'asc' } }, rows: { orderBy: { position: 'asc' } } },
  });
  if (!dataset) throw new HttpError(404, 'Dataset not found.', 'NOT_FOUND');
  const group = typeof req.query.group === 'string' ? req.query.group : '';
  const columns: ParsedColumn[] = dataset.columns
    .filter((column) => !group || group === 'all' || column.groupKey === group)
    .map((column) => ({
      key: column.key,
      label: column.label,
      groupKey: column.groupKey,
      groupTitle: groupTitleFor(column.groupKey, column.groupTitle),
      dataType: column.dataType === 'date' || column.dataType === 'number' ? column.dataType : 'text',
      semanticTag: column.semanticTag,
      displayOrder: column.displayOrder,
      isSystem: column.isSystem,
    }));
  const cells = dataset.rows.map((row) => asCells(row.data));
  const stem = dataset.name.replace(/[^\w.-]+/g, '_') || 'dataset';
  const day = todayInZone(env.timezone);
  if (req.query.format === 'csv') {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${stem}_${day}.csv"`);
    res.send(buildCsv(columns, cells));
    return;
  }
  const calls = await prisma.serviceCall.findMany({
    where: { row: { datasetId: dataset.id } },
    include: { row: { select: { position: true, serialNo: true, customerName: true } } },
    orderBy: { reportedAt: 'desc' },
  });
  const exportCalls: ExportCall[] = calls.map((call) => ({
    position: call.row.position,
    customerName: call.row.customerName,
    serialNo: call.row.serialNo,
    type: call.type,
    description: call.description,
    status: call.status,
    reportedAt: call.reportedAt,
    resolvedAt: call.resolvedAt,
    note: call.note,
  }));
  const buffer = buildWorkbook(columns, cells, exportCalls);
  const filename = `${stem}_${day}.xlsx`;
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(buffer);
}));

router.post('/:id/columns', requirePermission('alterSchema'), asyncHandler(async (req, res) => {
  assertUuid(req.params.id);
  const dataset = await prisma.dataset.findUnique({ where: { id: req.params.id } });
  if (!dataset) throw new HttpError(404, 'Dataset not found.', 'NOT_FOUND');
  const label = String(req.body?.label || '').trim();
  const groupKey = normalizeGroupKey(req.body?.groupKey) || 'customer_detail';
  if (!label) throw new HttpError(400, 'A column label is required.', 'VALIDATION');
  const key = String(req.body?.key || label).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 64) || 'field';
  const count = await prisma.columnDefinition.count({ where: { datasetId: dataset.id } });
  const column = await prisma.columnDefinition.create({
    data: {
      datasetId: dataset.id,
      key,
      label,
      groupKey,
      semanticTag: semanticTagFor(key),
      dataType: req.body?.dataType === 'date' || req.body?.dataType === 'number' ? req.body.dataType : 'text',
      displayOrder: count,
      isSystem: false,
    },
  });
  await prisma.dataset.update({ where: { id: dataset.id }, data: { columnCount: count + 1 } });
  res.status(201).json({ column });
}));

router.patch('/:id/columns/:columnId', requirePermission('alterSchema'), asyncHandler(async (req, res) => {
  assertUuid(req.params.id);
  assertUuid(req.params.columnId);
  const column = await prisma.columnDefinition.findFirst({ where: { id: req.params.columnId, datasetId: req.params.id } });
  if (!column) throw new HttpError(404, 'Column not found.', 'NOT_FOUND');
  const label = req.body?.label != null ? String(req.body.label).trim() : column.label;
  const groupKey = req.body?.groupKey != null ? (normalizeGroupKey(req.body.groupKey) || column.groupKey) : column.groupKey;
  const displayOrder = Number.isFinite(Number(req.body?.displayOrder)) ? Number(req.body.displayOrder) : column.displayOrder;
  const updated = await prisma.columnDefinition.update({
    where: { id: column.id },
    data: { label, groupKey, displayOrder },
  });
  res.json({ column: updated });
}));

router.delete('/:id/columns/:columnId', requirePermission('alterSchema'), asyncHandler(async (req, res) => {
  assertUuid(req.params.id);
  assertUuid(req.params.columnId);
  const column = await prisma.columnDefinition.findFirst({ where: { id: req.params.columnId, datasetId: req.params.id } });
  if (!column) throw new HttpError(404, 'Column not found.', 'NOT_FOUND');
  if (column.isSystem) throw new HttpError(400, 'System columns stay in the schema.', 'VALIDATION');
  await prisma.columnDefinition.delete({ where: { id: column.id } });
  const columnCount = await prisma.columnDefinition.count({ where: { datasetId: req.params.id } });
  await prisma.dataset.update({ where: { id: req.params.id }, data: { columnCount } });
  res.json({ ok: true });
}));

router.get('/:id/suggest', asyncHandler(async (req, res) => {
  assertUuid(req.params.id);
  const field = String(req.query.field || '');
  const allowed = new Set(['city', 'contract_type', 'equipment_name']);
  if (!allowed.has(field)) throw new HttpError(400, 'Unknown suggestion field.', 'VALIDATION');
  const q = String(req.query.q || '').trim().slice(0, 40);
  const rows = await prisma.$queryRaw<{ value: string }[]>`
    SELECT DISTINCT data->>${field} AS value
    FROM dataset_rows
    WHERE dataset_id = ${req.params.id}::uuid
      AND COALESCE(data->>${field}, '') <> ''
      AND (${q} = '' OR data->>${field} ILIKE ${'%' + q + '%'})
    ORDER BY value ASC
    LIMIT 12
  `;
  res.json({ values: rows.map((row) => row.value) });
}));

export default router;
