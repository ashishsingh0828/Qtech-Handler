const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function assertUuid(value) {
  if (!UUID_RE.test(String(value || ''))) {
    throw new HttpError(404, 'Not found.', 'NOT_FOUND');
  }
}

export class HttpError extends Error {
  constructor(status, message, code, extra = {}) {
    super(message);
    this.status = status;
    this.code = code;
    Object.assign(this, extra);
  }
}

export function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

export function errorMiddleware(err, req, res, next) {
  if (res.headersSent) {
    next(err);
    return;
  }
  const status = err.status || 500;
  if (status >= 500) console.error(err);
  const body = {
    error: status >= 500 ? 'Internal error' : err.message,
    code: err.code || (status >= 500 ? 'INTERNAL' : 'ERROR'),
  };
  if (err.blockedFields) body.blockedFields = err.blockedFields;
  if (err.field) body.field = err.field;
  res.status(status).json(body);
}
