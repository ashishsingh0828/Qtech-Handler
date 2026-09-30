import { randomUUID } from 'crypto';
import type { NextFunction, Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { ensureSchema } from './ensureSchema.ts';

export class HttpError extends Error {
  status: number;
  code: string;
  details: Record<string, unknown>;

  constructor(status: number, message: string, code: string, details: Record<string, unknown> = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function asyncHandler(
  handler: (req: Request, res: Response, next: NextFunction) => Promise<void>,
) {
  return (req: Request, res: Response, next: NextFunction) => {
    handler(req, res, next).catch(next);
  };
}

export function requestContext(req: Request, res: Response, next: NextFunction): void {
  req.requestId = randomUUID();
  res.setHeader('X-Request-Id', req.requestId);
  next();
}

function firstLine(error: unknown): string {
  if (!(error instanceof Error)) return 'Unexpected error';
  return error.message.split('\n').map((line) => line.trim()).find(Boolean) || 'Unexpected error';
}

function carriedStatus(error: unknown): number | null {
  if (!error || typeof error !== 'object') return null;
  const record = error as { status?: unknown; statusCode?: unknown };
  const status = typeof record.status === 'number' ? record.status : typeof record.statusCode === 'number' ? record.statusCode : null;
  if (status == null || status < 400 || status > 599) return null;
  return status;
}

export function errorMiddleware(error: unknown, req: Request, res: Response, _next: NextFunction): void {
  const requestId = req.requestId || '';
  const pathName = req.originalUrl.split('?')[0];
  console.error(requestId, req.method, pathName, error);
  if (pathName === '/api/auth/me') {
    res.status(401).json({ user: null, error: 'Sign in required.', code: 'UNAUTHORIZED', requestId });
    return;
  }
  if (error instanceof HttpError) {
    const status = pathName === '/api/auth/enter' || pathName === '/api/auth/login' ? (error.status >= 500 ? 503 : error.status) : error.status;
    res.status(status).json({ error: error.message, code: error.code, requestId, ...error.details });
    return;
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2022') {
    const column = typeof error.meta?.column === 'string' ? error.meta.column : 'a required column';
    ensureSchema().catch((schemaError: unknown) => console.error(requestId, schemaError));
    if (pathName === '/api/auth/enter' || pathName === '/api/auth/login') {
      res.status(503).json({ error: `Database is missing ${column}.`, code: 'SCHEMA', requestId });
      return;
    }
    res.status(503).json({ error: `Database is missing ${column}. Retry.`, code: 'SCHEMA', requestId });
    return;
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
    res.status(404).json({ error: 'Not found.', code: 'NOT_FOUND', requestId });
    return;
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    res.status(409).json({ error: 'That value is already in use.', code: 'CONFLICT', requestId });
    return;
  }
  if (error instanceof Prisma.PrismaClientValidationError) {
    res.status(400).json({ error: 'The request could not be saved.', code: 'VALIDATION', requestId });
    return;
  }
  const status = carriedStatus(error);
  if (status != null && status < 500) {
    res.status(status).json({ error: firstLine(error), code: status === 400 ? 'VALIDATION' : 'ERROR', requestId });
    return;
  }
  if (pathName === '/api/auth/enter' || pathName === '/api/auth/login') {
    res.status(503).json({ error: firstLine(error), code: 'UNAVAILABLE', requestId });
    return;
  }
  res.status(500).json({ error: firstLine(error), code: 'INTERNAL', requestId });
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function assertUuid(value: string): void {
  if (!UUID.test(value)) throw new HttpError(400, 'Invalid identifier.', 'VALIDATION');
}
