import { Request, Response, NextFunction } from 'express';
import { logger } from '../lib/logger';

/**
 * Logs every HTTP request on completion with method, path, status, and duration.
 * Attach before all route handlers in app.ts.
 */
export function requestLogger(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const start = Date.now();

  res.on('finish', () => {
    const durationMs = Date.now() - start;
    const level =
      res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';

    logger[level]('http request', {
      method: req.method,
      path: req.path,
      query: Object.keys(req.query).length > 0 ? req.query : undefined,
      status: res.statusCode,
      durationMs,
      ip: req.ip,
    });
  });

  next();
}
