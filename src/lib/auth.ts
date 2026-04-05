import { Request } from 'express';
import { AppError } from '../errors/AppError';

export function getCurrentUserId(req: Request): string {
  const userId = req.user?.id;
  if (!userId) {
    throw new AppError(401, 'UNAUTHORIZED', 'User is not authenticated.');
  }
  return userId;
}
