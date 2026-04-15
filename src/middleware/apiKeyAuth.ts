// Temporary MVP protection for closed testing.
// Validates a shared API key on every /api request.
// Replace with proper auth when user accounts are introduced.

import { Request, Response, NextFunction } from 'express';
import { logger } from '../lib/logger';

const API_KEY = process.env.API_KEY;

if (!API_KEY) {
  if (process.env.NODE_ENV === 'production') {
    logger.error(
      'API_KEY environment variable is not set. All /api requests will be rejected in production.'
    );
  } else {
    logger.warn(
      'API_KEY environment variable is not set. Requests will be allowed in non-production environments.'
    );
  }
}

export function apiKeyAuth(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  // No key configured: allow in dev, reject in production.
  if (!API_KEY) {
    if (process.env.NODE_ENV === 'production') {
      res.status(401).json({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Unauthorized', details: null },
      });
      return;
    }

    // Dev mode: allow but still attach actor if provided
    const devMemberId = req.header('x-member-id');
    if (devMemberId) {
      req.actor = { memberId: devMemberId };
    }

    next();
    return;
  }

  const provided = req.header('x-api-key');
  if (!provided || provided !== API_KEY) {
    res.status(401).json({
      success: false,
      error: { code: 'UNAUTHORIZED', message: 'Unauthorized', details: null },
    });
    return;
  }

  const memberId = req.header('x-member-id');

  if (memberId) {
    req.actor = { memberId };
  }

  next();
}
