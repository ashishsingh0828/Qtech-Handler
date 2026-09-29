import jwt from 'jsonwebtoken';
import { pool } from '../db.js';
import { env } from '../config/env.js';
import { HttpError } from '../lib/http.js';
import { hasPermission } from '../config/roles.js';

const COOKIE = 'qtech_session';
const EIGHT_HOURS = 8 * 60 * 60 * 1000;

export function cookieOptions() {
  return {
    httpOnly: true,
    secure: env.cookieSecure,
    sameSite: 'lax',
    maxAge: EIGHT_HOURS,
    path: '/',
  };
}

export function signSession(user) {
  return jwt.sign(
    { sub: user.id, role: user.role, name: user.name, email: user.email },
    env.jwtSecret,
    { expiresIn: '8h' },
  );
}

export function setSessionCookie(res, user) {
  res.cookie(COOKIE, signSession(user), cookieOptions());
}

export function clearSessionCookie(res) {
  res.clearCookie(COOKIE, { ...cookieOptions(), maxAge: 0 });
}

export async function attachUser(req, res, next) {
  const token = req.cookies?.[COOKIE];
  if (!token) {
    req.user = null;
    next();
    return;
  }
  try {
    const payload = jwt.verify(token, env.jwtSecret);
    const result = await pool.query(
      `SELECT id, email, name, role, active
       FROM users
       WHERE id = $1`,
      [payload.sub],
    );
    const user = result.rows[0];
    req.user = user && user.active ? user : null;
    next();
  } catch (error) {
    if (error?.name === 'JsonWebTokenError' || error?.name === 'TokenExpiredError') {
      req.user = null;
      next();
      return;
    }
    next(error);
  }
}

export function requireUser(req, res, next) {
  if (!req.user) {
    next(new HttpError(401, 'Unauthorized', 'UNAUTHORIZED'));
    return;
  }
  next();
}

export function requirePermission(permission) {
  return (req, res, next) => {
    if (!req.user) {
      next(new HttpError(401, 'Unauthorized', 'UNAUTHORIZED'));
      return;
    }
    if (!hasPermission(req.user.role, permission)) {
      next(new HttpError(403, 'Forbidden', 'FORBIDDEN'));
      return;
    }
    next();
  };
}
