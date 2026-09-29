import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { pool } from '../db.js';
import { assertUuid, asyncHandler, HttpError } from '../lib/http.js';
import { publicUser } from '../lib/present.js';
import { requirePermission, requireUser } from '../middleware/auth.js';
import { ROLES } from '../config/roles.js';

const router = Router();

router.use(requireUser, requirePermission('manageUsers'));
router.param('id', (req, res, next, value) => {
  try {
    assertUuid(value);
    next();
  } catch (error) {
    next(error);
  }
});

router.get('/', asyncHandler(async (req, res) => {
  const result = await pool.query(
    `SELECT id, email, name, role, active, created_at
     FROM users
     ORDER BY created_at ASC`,
  );
  res.json({
    users: result.rows.map((user) => ({
      ...publicUser(user),
      createdAt: user.created_at,
    })),
  });
}));

router.post('/', asyncHandler(async (req, res) => {
  const name = String(req.body?.name || '').trim();
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  const role = String(req.body?.role || '');
  if (name.length < 2) throw new HttpError(400, 'Name is required.', 'VALIDATION');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new HttpError(400, 'A valid email is required.', 'VALIDATION');
  }
  if (password.length < 8) throw new HttpError(400, 'Password must be at least 8 characters.', 'VALIDATION');
  if (!ROLES.includes(role)) throw new HttpError(400, 'Unknown role.', 'VALIDATION');
  const passwordHash = await bcrypt.hash(password, 12);
  try {
    const result = await pool.query(
      `INSERT INTO users (name, email, password_hash, role)
       VALUES ($1, $2, $3, $4)
       RETURNING id, email, name, role, active, created_at`,
      [name, email, passwordHash, role],
    );
    const user = result.rows[0];
    res.status(201).json({ user: { ...publicUser(user), createdAt: user.created_at } });
  } catch (error) {
    if (error.code === '23505') throw new HttpError(409, 'That email is already in use.', 'CONFLICT');
    throw error;
  }
}));

router.patch('/:id', asyncHandler(async (req, res) => {
  const result = await pool.query(
    'SELECT id, email, name, role, active FROM users WHERE id = $1',
    [req.params.id],
  );
  const user = result.rows[0];
  if (!user) throw new HttpError(404, 'User not found.', 'NOT_FOUND');

  const name = req.body?.name != null ? String(req.body.name).trim() : user.name;
  const role = req.body?.role != null ? String(req.body.role) : user.role;
  const active = req.body?.active != null ? Boolean(req.body.active) : user.active;
  if (name.length < 2) throw new HttpError(400, 'Name is required.', 'VALIDATION');
  if (!ROLES.includes(role)) throw new HttpError(400, 'Unknown role.', 'VALIDATION');
  if (user.id === req.user.id && (!active || role !== 'admin')) {
    throw new HttpError(400, 'You cannot deactivate or demote your own account.', 'VALIDATION');
  }

  let passwordHash = null;
  if (req.body?.password) {
    const password = String(req.body.password);
    if (password.length < 8) throw new HttpError(400, 'Password must be at least 8 characters.', 'VALIDATION');
    passwordHash = await bcrypt.hash(password, 12);
  }

  const updated = await pool.query(
    `UPDATE users
     SET name = $2,
         role = $3,
         active = $4,
         password_hash = COALESCE($5, password_hash)
     WHERE id = $1
     RETURNING id, email, name, role, active, created_at`,
    [user.id, name, role, active, passwordHash],
  );
  const next = updated.rows[0];
  res.json({ user: { ...publicUser(next), createdAt: next.created_at } });
}));

export default router;
