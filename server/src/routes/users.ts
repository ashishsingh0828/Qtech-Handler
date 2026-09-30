import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { prisma } from '../lib/prisma.ts';
import { asyncHandler, assertUuid, HttpError } from '../lib/http.ts';
import { requirePermission, requireUser } from '../middleware/auth.ts';
import { normalizeRole, roleTitle } from '../../../shared/permissions.ts';

const router = Router();
router.use(requireUser);

function present(user: { id: string; email: string; name: string; role: string; isActive: boolean; lastLoginAt: Date | null }) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: normalizeRole(user.role),
    roleLabel: roleTitle(user.role),
    isActive: user.isActive,
    lastLoginAt: user.lastLoginAt ? user.lastLoginAt.toISOString() : null,
  };
}

router.get('/assignees', requirePermission('assignRecords'), asyncHandler(async (_req, res) => {
  const users = await prisma.user.findMany({
    where: { isActive: true, role: { in: ['VALIDATOR', 'SERVICE'] } },
    orderBy: { name: 'asc' },
  });
  res.json({ users: users.map(present) });
}));

router.get('/', requirePermission('manageUsers'), asyncHandler(async (_req, res) => {
  const users = await prisma.user.findMany({ orderBy: { name: 'asc' } });
  res.json({ users: users.map(present) });
}));

router.post('/', requirePermission('manageUsers'), asyncHandler(async (req, res) => {
  const name = String(req.body?.name || '').trim();
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  const role = normalizeRole(req.body?.role);
  if (!name || !email || !role) throw new HttpError(400, 'Name, email, and role are required.', 'VALIDATION');
  if (password.length < 8) throw new HttpError(400, 'Password must be at least 8 characters.', 'VALIDATION');
  const passwordHash = await bcrypt.hash(password, 12);
  try {
    const user = await prisma.user.create({ data: { name, email, passwordHash, role, isActive: true } });
    res.status(201).json({ user: present(user) });
  } catch {
    throw new HttpError(409, 'That email is already in use.', 'CONFLICT');
  }
}));

router.patch('/:id', requirePermission('manageUsers'), asyncHandler(async (req, res) => {
  assertUuid(req.params.id);
  if (!req.user) throw new HttpError(401, 'Sign in required.', 'UNAUTHORIZED');
  const existing = await prisma.user.findUnique({ where: { id: req.params.id } });
  if (!existing) throw new HttpError(404, 'User not found.', 'NOT_FOUND');
  const name = req.body?.name != null ? String(req.body.name).trim() : existing.name;
  const role = req.body?.role != null ? normalizeRole(req.body.role) : normalizeRole(existing.role);
  if (!name || !role) throw new HttpError(400, 'Name and role are required.', 'VALIDATION');
  let isActive = existing.isActive;
  if (typeof req.body?.isActive === 'boolean') isActive = req.body.isActive;
  if (existing.id === req.user.id && (!isActive || role !== 'ADMIN')) {
    throw new HttpError(400, 'You cannot deactivate or demote your own account.', 'VALIDATION');
  }
  let passwordHash: string | undefined;
  if (req.body?.password) {
    const password = String(req.body.password);
    if (password.length < 8) throw new HttpError(400, 'Password must be at least 8 characters.', 'VALIDATION');
    passwordHash = await bcrypt.hash(password, 12);
  }
  const user = await prisma.user.update({
    where: { id: existing.id },
    data: { name, role, isActive, ...(passwordHash ? { passwordHash } : {}) },
  });
  res.json({ user: present(user) });
}));

export default router;
