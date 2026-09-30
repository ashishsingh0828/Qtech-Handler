import type { NextFunction, Request, Response } from 'express';
import { Prisma } from '@prisma/client';

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

export function errorMiddleware(error: unknown, req: Request, res: Response, _next: NextFunction): void {
  const pathName = req.originalUrl.split('?')[0];
  if (pathName === '/api/auth/me') {
    res.status(401).json({ user: null });
    return;
  }
  if (pathName === '/api/auth/enter' || pathName === '/api/auth/login') {
    const message = error instanceof Error ? error.message : 'Sign in failed';
    const status = error instanceof HttpError ? error.status : 503;
    res.status(status).json({ error: message, code: error instanceof HttpError ? error.code : 'UNAVAILABLE' });
    return;
  }
  if (error instanceof HttpError) {
    res.status(error.status).json({ error: error.message, code: error.code, ...error.details });
    return;
  }
  console.error(error);
  const raw = error instanceof Error ? error.message.split('\n').map((line) => line.trim()).find(Boolean) || 'Unexpected error' : 'Unexpected error';
  const prismaError = error instanceof Prisma.PrismaClientValidationError || error instanceof Prisma.PrismaClientKnownRequestError;
  const message = prismaError || raw.startsWith('Invalid `') || raw.length > 180 ? 'That change could not be saved.' : raw;
  res.status(500).json({ error: message, code: 'INTERNAL' });
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function assertUuid(value: string): void {
  if (!UUID.test(value)) throw new HttpError(400, 'Invalid identifier.', 'VALIDATION');
}
