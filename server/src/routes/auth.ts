import { Router } from 'express';
import type { Request, Response } from 'express';
import { prisma } from '../lib/prisma.ts';
import { asyncHandler, HttpError } from '../lib/http.ts';
import { clearSession, sessionIsSecure, setSession, type AuthUser } from '../middleware/auth.ts';
import { normalizeRole, type Role } from '../../../shared/permissions.ts';
import { PRESET_USERS } from '../../../shared/presets.ts';

const router = Router();

function publicUser(user: AuthUser) {
  return { id: user.id, email: user.email, name: user.name, role: user.role };
}

async function openWorkspace(req: Request, res: Response): Promise<void> {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const requested = normalizeRole(req.body?.role);
  const preset = PRESET_USERS.find((item) => item.email === email || item.role === requested);
  const address = preset?.email || email;
  const role = (preset?.role || requested) as Role | '';
  if (!address || !role) throw new HttpError(400, 'Choose Admin, Manager, Validator, or Service.', 'VALIDATION');
  const name = preset?.name || address.split('@')[0] || 'User';
  const user = await prisma.user.upsert({
    where: { email: address },
    update: { name, role, isActive: true },
    create: { email: address, name, role, isActive: true, passwordHash: '' },
  });
  await prisma.$executeRaw`UPDATE users SET is_active = active WHERE email = ${address}`;
  const auth: AuthUser = { id: user.id, email: user.email, name: user.name, role };
  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  setSession(res, auth, sessionIsSecure(req));
  res.json({ user: publicUser(auth) });
}

router.post('/login', asyncHandler(openWorkspace));
router.post('/enter', asyncHandler(openWorkspace));

router.post('/logout', (req, res) => {
  clearSession(res, sessionIsSecure(req));
  res.json({ ok: true });
});

router.get('/me', (req, res) => {
  if (!req.user) {
    res.status(401).json({ user: null });
    return;
  }
  res.json({ user: publicUser(req.user) });
});

router.post('/password', (_req, res) => {
  res.status(400).json({ error: 'Password sign-in is not enabled.', code: 'VALIDATION' });
});

export default router;
