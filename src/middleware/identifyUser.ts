import { Request, Response, NextFunction } from 'express';

/**
 * Resolves the caller's membership identity from the x-member-id request header.
 * Must run after apiKeyAuth.
 * Sets req.actor = { memberId } — controllers use this for DB-based authorization.
 */
export function identifyUser(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const memberId = req.header('x-member-id');
  if (!memberId) {
    res.status(401).json({
      success: false,
      error: {
        code: 'MISSING_MEMBER_ID',
        message: 'Missing x-member-id header.',
        details: null,
      },
    });
    return;
  }
  req.actor = { memberId };
  next();
}
