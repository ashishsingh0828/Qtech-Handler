import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { prisma } from '../lib/prisma.ts';
import { asyncHandler, HttpError } from '../lib/http.ts';
import { clearSession, requireUser, setSession, type AuthUser } from '../middleware/auth.ts';
import { normalizeRole } from '../../../shared/permissions.ts';

const router = Router();

function publicUser(user: AuthUser) {
  return { id: user.id, email: user.email, name: user.name, role: user.role };
}

router.post('/login', asyncHandler(async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  if (!email || !password) throw new HttpError(400, 'Email and password are required.', 'VALIDATION');
  const user = await prisma.user.findUnique({ where: { email } });
  const role = user ? normalizeRole(user.role) : '';
  const matches = user ? await bcrypt.compare(password, user.passwordHash) : false;
  if (!user || !role || !user.isActive || !matches) {
    throw new HttpError(401, 'Invalid email or password.', 'INVALID_CREDENTIALS');
  }
  const auth: AuthUser = { id: user.id, email: user.email, name: user.name, role };
  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  setSession(res, auth);
  res.json({ user: publicUser(auth) });
}));

router.post('/logout', (_req, res) => {
  clearSession(res);
  res.json({ ok: true });
});

router.get('/me', requireUser, (req, res) => {
  res.json({ user: publicUser(req.user as AuthUser) });
});

router.post('/password', requireUser, asyncHandler(async (req, res) => {
  const currentPassword = String(req.body?.currentPassword || '');
  const nextPassword = String(req.body?.nextPassword || '');
  if (nextPassword.length < 8) throw new HttpError(400, 'Password must be at least 8 characters.', 'VALIDATION');
  const user = await prisma.user.findUnique({ where: { id: req.user?.id } });
  if (!user) throw new HttpError(401, 'Sign in required.', 'UNAUTHORIZED');
  const matches = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!matches) throw new HttpError(400, 'Current password is incorrect.', 'VALIDATION');
  const passwordHash = await bcrypt.hash(nextPassword, 12);
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash } });
  res.json({ ok: true });
}));

export default router;
