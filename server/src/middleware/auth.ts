import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.ts';
import { prisma } from '../lib/prisma.ts';
import { HttpError } from '../lib/http.ts';
import { hasPermission, normalizeRole, type PermissionFlag, type Role } from '../../../shared/permissions.ts';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: Role;
}

declare global {
  namespace Express {
    interface Request {
      user: AuthUser | null;
    }
  }
}

const COOKIE = 'qtech_session';

export function signSession(user: AuthUser): string {
  return jwt.sign({ sub: user.id, role: user.role }, env.jwtSecret, { expiresIn: '8h' });
}

export function setSession(res: Response, user: AuthUser): void {
  res.cookie(COOKIE, signSession(user), {
    httpOnly: true,
    sameSite: 'lax',
    secure: env.cookieSecure,
    maxAge: 8 * 60 * 60 * 1000,
  });
}

export function clearSession(res: Response): void {
  res.clearCookie(COOKIE, { httpOnly: true, sameSite: 'lax', secure: env.cookieSecure });
}

export async function attachUser(req: Request, res: Response, next: NextFunction): Promise<void> {
  req.user = null;
  const token = req.cookies?.[COOKIE];
  if (!token || typeof token !== 'string') {
    next();
    return;
  }
  try {
    const payload = jwt.verify(token, env.jwtSecret) as { sub?: string };
    if (!payload.sub) {
      next();
      return;
    }
    const user = await prisma.user.findUnique({ where: { id: payload.sub } });
    const role = user && user.isActive ? normalizeRole(user.role) : '';
    if (user && role) {
      req.user = { id: user.id, email: user.email, name: user.name, role };
    }
    next();
  } catch (error) {
    if (error instanceof jwt.JsonWebTokenError) {
      next();
      return;
    }
    next(error);
  }
}

export function requireUser(req: Request, _res: Response, next: NextFunction): void {
  if (!req.user) {
    next(new HttpError(401, 'Sign in required.', 'UNAUTHORIZED'));
    return;
  }
  next();
}

export function requirePermission(permission: PermissionFlag) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) {
      next(new HttpError(401, 'Sign in required.', 'UNAUTHORIZED'));
      return;
    }
    if (!hasPermission(req.user.role, permission)) {
      next(new HttpError(403, 'You do not have permission for this action.', 'FORBIDDEN', {
        requiredPermission: permission,
        blockedFields: [],
      }));
      return;
    }
    next();
  };
}
