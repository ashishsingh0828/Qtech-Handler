import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { pool } from '../db.js';
import { asyncHandler, HttpError } from '../lib/http.js';
import { publicUser } from '../lib/present.js';
import { clearSessionCookie, requireUser, setSessionCookie } from '../middleware/auth.js';

const router = Router();

router.post('/login', asyncHandler(async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  if (!email || !password) {
    throw new HttpError(400, 'Email and password are required.', 'VALIDATION');
  }
  const result = await pool.query(
    'SELECT id, email, name, role, active, password_hash FROM users WHERE email = $1',
    [email],
  );
  const user = result.rows[0];
  const matches = user ? await bcrypt.compare(password, user.password_hash) : false;
  if (!user || !user.active || !matches) {
    throw new HttpError(401, 'Invalid email or password.', 'INVALID_CREDENTIALS');
  }
  setSessionCookie(res, user);
  res.json({ user: publicUser(user) });
}));

router.post('/logout', (req, res) => {
  clearSessionCookie(res);
  res.json({ ok: true });
});

router.get('/me', requireUser, (req, res) => {
  res.json({ user: publicUser(req.user) });
});

export default router;
