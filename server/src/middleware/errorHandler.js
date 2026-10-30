import { ZodError } from 'zod';
import { ApiError } from '../utils/ApiError.js';
import { logger } from '../utils/logger.js';

export function notFound(req, res, next) {
  next(ApiError.notFound(`Route ${req.method} ${req.originalUrl} not found`));
}

export function errorHandler(err, req, res, _next) {
  let status = 500;
  let message = 'Internal server error';
  let errors = null;

  if (err instanceof ApiError) {
    status = err.status;
    message = err.message;
    errors = err.errors;
    if (err.retryAfterSec) res.set('Retry-After', String(err.retryAfterSec));
  } else if (err instanceof ZodError) {
    status = 400;
    message = 'Validation failed';
    errors = err.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
  } else if (err?.code === 11000) {
    status = 409;
    message = 'Duplicate value';
  } else if (err?.name === 'CastError') {
    status = 400;
    message = 'Invalid identifier';
  }

  if (status >= 500) logger.error({ err }, 'Unhandled error');
  res.status(status).json({ success: false, data: null, message, errors });
}
