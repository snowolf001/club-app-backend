import { Request } from 'express';
import { AppError } from '../errors/AppError';

/** @deprecated Use getActorMemberId instead */
export function getCurrentUserId(req: Request): string {
  const userId = req.user?.id;
  if (!userId) {
    throw new AppError(401, 'UNAUTHORIZED', 'User is not authenticated.');
  }
  return userId;
}

/**
 * Returns the actor's membershipId from the x-member-id header (set by identifyUser middleware).
 * Use this instead of getCurrentUserId for all authenticated write operations.
 */
export function getActorMemberId(req: Request): string {
  const memberId = req.actor?.memberId;
  if (!memberId) {
    throw new AppError(401, 'MISSING_MEMBER_ID', 'Actor identity is missing.');
  }
  return memberId;
}
