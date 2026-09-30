import { Router } from 'express';
import { prisma } from '../lib/prisma.ts';
import { asyncHandler, assertUuid, HttpError } from '../lib/http.ts';
import { requireUser } from '../middleware/auth.ts';
import { env } from '../config/env.ts';
import { todayInZone } from '../../../shared/dates.ts';
import { amcRecord, logCall, markPms, resolveCall, validateRecord, verifyRecord } from '../lib/records.ts';

const rows = Router();
rows.use(requireUser);

async function locate(id: string) {
  assertUuid(id);
  const row = await prisma.row.findUnique({ where: { id }, select: { id: true, datasetId: true, version: true } });
  if (!row) throw new HttpError(404, 'Record not found.', 'NOT_FOUND');
  return row;
}

rows.post('/:id/validate', asyncHandler(async (req, res) => {
  if (!req.user) throw new HttpError(401, 'Sign in required.', 'UNAUTHORIZED');
  const result = req.body?.result === 'No' || req.body?.decision === 'No' ? 'No' : req.body?.result === 'Yes' || req.body?.decision === 'Yes' ? 'Yes' : '';
  if (!result) throw new HttpError(400, 'Result must be Yes or No.', 'VALIDATION');
  const located = await locate(req.params.id);
  const row = await validateRecord({
    datasetId: located.datasetId,
    rowId: located.id,
    version: Number(req.body?.version ?? located.version),
    decision: result,
    reason: req.body?.reason,
    expectedDate: req.body?.expectedDate,
    user: req.user,
    today: todayInZone(env.timezone),
  });
  res.json({ row });
}));

rows.post('/:id/verify', asyncHandler(async (req, res) => {
  if (!req.user) throw new HttpError(401, 'Sign in required.', 'UNAUTHORIZED');
  const verified = req.body?.verified === false || req.body?.action === 'revert' ? 'revert' : 'verify';
  const located = await locate(req.params.id);
  const row = await verifyRecord({
    datasetId: located.datasetId,
    rowId: located.id,
    version: Number(req.body?.version ?? located.version),
    action: verified,
    user: req.user,
    today: todayInZone(env.timezone),
  });
  res.json({ row });
}));

rows.post('/:id/amc', asyncHandler(async (req, res) => {
  if (!req.user) throw new HttpError(401, 'Sign in required.', 'UNAUTHORIZED');
  const action = req.body?.action;
  if (action !== 'proposal_sent' && action !== 'acknowledge' && action !== 'decline' && action !== 'reset') {
    throw new HttpError(400, 'Unknown AMC action.', 'VALIDATION');
  }
  const located = await locate(req.params.id);
  const row = await amcRecord({
    datasetId: located.datasetId,
    rowId: located.id,
    version: Number(req.body?.version ?? located.version),
    action,
    note: req.body?.note,
    nextFollowUp: req.body?.nextFollowUp,
    user: req.user,
    today: todayInZone(env.timezone),
  });
  res.json({ row });
}));

rows.post('/:id/pms', asyncHandler(async (req, res) => {
  if (!req.user) throw new HttpError(401, 'Sign in required.', 'UNAUTHORIZED');
  const raw = String(req.body?.action || '');
  const action = raw === 'reschedule' ? 'reschedule' : 'done';
  const index = Number(req.body?.pmsNumber ?? req.body?.index);
  const located = await locate(req.params.id);
  const row = await markPms({
    datasetId: located.datasetId,
    rowId: located.id,
    version: Number(req.body?.version ?? located.version),
    index,
    action,
    date: req.body?.date,
    user: req.user,
    today: todayInZone(env.timezone),
    role: req.user.role,
  });
  res.json({ row });
}));

rows.post('/:id/service-calls', asyncHandler(async (req, res) => {
  if (!req.user) throw new HttpError(401, 'Sign in required.', 'UNAUTHORIZED');
  const located = await locate(req.params.id);
  const row = await logCall({
    datasetId: located.datasetId,
    rowId: located.id,
    version: Number(req.body?.version ?? located.version),
    type: String(req.body?.type || ''),
    description: String(req.body?.description || ''),
    user: req.user,
    today: todayInZone(env.timezone),
  });
  res.status(201).json({ row });
}));

const calls = Router();
calls.use(requireUser);

calls.patch('/:id/resolve', asyncHandler(async (req, res) => {
  if (!req.user) throw new HttpError(401, 'Sign in required.', 'UNAUTHORIZED');
  assertUuid(req.params.id);
  const call = await prisma.serviceCall.findUnique({ where: { id: req.params.id }, include: { row: true } });
  if (!call) throw new HttpError(404, 'Call not found.', 'NOT_FOUND');
  const row = await resolveCall({
    datasetId: call.row.datasetId,
    rowId: call.rowId,
    callId: call.id,
    version: call.row.version,
    note: req.body?.note,
    user: req.user,
    today: todayInZone(env.timezone),
  });
  res.json({ row });
}));

export { rows as rowActionRoutes, calls as serviceCallRoutes };
