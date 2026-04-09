import { Request, Response, NextFunction } from 'express';

/**
 * Resolves the caller's identity from the x-user-id request header.
 * Must run after apiKeyAuth.
 */
export function identifyUser(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const userId = req.header('x-user-id');
  if (!userId) {
    res.status(401).json({
      success: false,
      error: {
        code: 'UNAUTHORIZED',
        message: 'Missing x-user-id header',
        details: null,
      },
    });
    return;
  }
  req.user = { id: userId };
  next();
}
