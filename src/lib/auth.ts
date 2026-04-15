import { Request } from 'express';
import { AppError } from '../errors/AppError';

export function getActorMemberId(req: Request): string {
  const memberId = req.actor?.memberId;

  if (!memberId) {
    throw new AppError(
      401,
      'UNAUTHORIZED',
      'Missing member identity (x-member-id)'
    );
  }

  return memberId;
}

export function getCurrentUserId(req: Request): string {
  const userId = req.user?.id;

  if (!userId) {
    throw new AppError(401, 'UNAUTHORIZED', 'Missing current user identity');
  }

  return userId;
}
