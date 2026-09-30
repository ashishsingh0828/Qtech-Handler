import { Router } from 'express';
import { prisma } from '../lib/prisma.ts';
import { asyncHandler, assertUuid, HttpError } from '../lib/http.ts';
import { requireUser } from '../middleware/auth.ts';
import { todayInZone } from '../../../shared/dates.ts';
import { env } from '../config/env.ts';
import { hasPermission } from '../../../shared/permissions.ts';
import { assignRecord, validateRecord, verifyRecord } from '../lib/records.ts';
import { HttpError as Failure } from '../lib/http.ts';

const router = Router();
router.use(requireUser);

interface Item {
  rowId: string;
  version: number;
}

function itemsOf(body: unknown): Item[] {
  const source = body && typeof body === 'object' && 'items' in body ? (body as { items?: unknown }).items : null;
  if (!Array.isArray(source) || !source.length) throw new HttpError(400, 'Choose at least one record.', 'VALIDATION');
  return source.map((item) => {
    const row = item as { rowId?: string; version?: number };
    if (!row.rowId || !Number.isInteger(row.version)) throw new HttpError(400, 'Each record needs an id and version.', 'VALIDATION');
    assertUuid(row.rowId);
    return { rowId: row.rowId, version: Number(row.version) };
  });
}

function datasetOf(body: unknown): string {
  const datasetId = body && typeof body === 'object' && 'datasetId' in body ? String((body as { datasetId?: string }).datasetId || '') : '';
  assertUuid(datasetId);
  return datasetId;
}

async function settle(total: number, run: () => Promise<{ succeeded: string[]; failed: { rowId: string; reason: string }[] }>, res: import('express').Response): Promise<void> {
  const result = await run();
  res.status(result.failed.length ? 207 : 200).json({ total, ...result });
}

router.post('/bulk-validate', asyncHandler(async (req, res) => {
  if (!req.user || !hasPermission(req.user.role, 'validateRecords')) {
    throw new HttpError(403, 'You cannot validate records.', 'FORBIDDEN', { requiredPermission: 'validateRecords', blockedFields: [] });
  }
  const datasetId = datasetOf(req.body);
  const items = itemsOf(req.body);
  const decision = req.body?.decision === 'No' ? 'No' : 'Yes';
  const today = todayInZone(env.timezone);
  await settle(items.length, async () => {
    const succeeded: string[] = [];
    const failed: { rowId: string; reason: string }[] = [];
    for (const item of items) {
      try {
        await validateRecord({
          datasetId,
          rowId: item.rowId,
          version: item.version,
          decision,
          reason: req.body?.reason,
          expectedDate: req.body?.expectedDate,
          user: req.user!,
          today,
        });
        succeeded.push(item.rowId);
      } catch (error) {
        failed.push({ rowId: item.rowId, reason: error instanceof Failure ? error.message : 'Could not validate this record.' });
      }
    }
    return { succeeded, failed };
  }, res);
}));

router.post('/bulk-verify', asyncHandler(async (req, res) => {
  if (!req.user || !hasPermission(req.user.role, 'verifyRecords')) {
    throw new HttpError(403, 'You cannot verify records.', 'FORBIDDEN', { requiredPermission: 'verifyRecords', blockedFields: [] });
  }
  const datasetId = datasetOf(req.body);
  const items = itemsOf(req.body);
  const action = req.body?.action === 'revert' ? 'revert' : 'verify';
  const today = todayInZone(env.timezone);
  await settle(items.length, async () => {
    const succeeded: string[] = [];
    const failed: { rowId: string; reason: string }[] = [];
    for (const item of items) {
      try {
        await verifyRecord({ datasetId, rowId: item.rowId, version: item.version, action, user: req.user!, today });
        succeeded.push(item.rowId);
      } catch (error) {
        failed.push({ rowId: item.rowId, reason: error instanceof Failure ? error.message : 'Could not verify this record.' });
      }
    }
    return { succeeded, failed };
  }, res);
}));

router.post('/bulk-assign', asyncHandler(async (req, res) => {
  if (!req.user || !hasPermission(req.user.role, 'assignRecords')) {
    throw new HttpError(403, 'You cannot assign records.', 'FORBIDDEN', { requiredPermission: 'assignRecords', blockedFields: [] });
  }
  const datasetId = datasetOf(req.body);
  const items = itemsOf(req.body);
  const validatorId = req.body?.validatorId ? String(req.body.validatorId) : null;
  const serviceId = req.body?.serviceId ? String(req.body.serviceId) : null;
  if (validatorId) assertUuid(validatorId);
  if (serviceId) assertUuid(serviceId);
  if (validatorId) {
    const user = await prisma.user.findFirst({ where: { id: validatorId, role: 'VALIDATOR', isActive: true } });
    if (!user) throw new HttpError(400, 'Choose an active validator.', 'VALIDATION');
  }
  if (serviceId) {
    const user = await prisma.user.findFirst({ where: { id: serviceId, role: 'SERVICE', isActive: true } });
    if (!user) throw new HttpError(400, 'Choose an active service user.', 'VALIDATION');
  }
  const today = todayInZone(env.timezone);
  await settle(items.length, async () => {
    const succeeded: string[] = [];
    const failed: { rowId: string; reason: string }[] = [];
    for (const item of items) {
      try {
        await assignRecord({
          datasetId,
          rowId: item.rowId,
          version: item.version,
          validatorId,
          serviceId,
          user: req.user!,
          today,
        });
        succeeded.push(item.rowId);
      } catch (error) {
        failed.push({ rowId: item.rowId, reason: error instanceof Failure ? error.message : 'Could not assign this record.' });
      }
    }
    return { succeeded, failed };
  }, res);
}));

export default router;
