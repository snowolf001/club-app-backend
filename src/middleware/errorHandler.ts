import { Request, Response, NextFunction } from 'express';
import { AppError } from '../errors/AppError';
import { logger } from '../lib/logger';

export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  if (err instanceof AppError) {
    // 4xx errors are expected (bad input, not found, conflicts) — log as warn
    logger.warn('app error', {
      code: err.code,
      message: err.message,
      statusCode: err.statusCode,
      details: err.details ?? undefined,
      method: req.method,
      path: req.path,
    });

    res.status(err.statusCode).json({
      success: false,
      error: {
        code: err.code,
        message: err.message,
        details: err.details ?? null,
      },
    });
    return;
  }

  // Unexpected errors — log full stack so we can debug
  const message = err instanceof Error ? err.message : String(err);
  const stack = err instanceof Error ? err.stack : String(err);
  logger.error('unhandled error', {
    message,
    stack,
    method: req.method,
    path: req.path,
  });

  res.status(500).json({
    success: false,
    error: {
      code: 'INTERNAL_SERVER_ERROR',
      // Include the raw error message in non-production to aid debugging.
      message:
        process.env.NODE_ENV === 'production'
          ? 'An unexpected error occurred.'
          : message,
    },
  });
}
