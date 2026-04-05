import { Request, Response, NextFunction } from 'express';
import { AppError } from '../errors/AppError';
import { isValidUUID, isPositiveInteger } from '../utils/validators';
import { getCurrentUserId } from '../lib/auth';
import {
  getMyMembership,
  addCredits,
  getMembershipById,
} from '../services/membershipService';

// ─── GET /api/memberships/me?clubId=... ───────────────────────────────────────

export async function getMyMembershipHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const userId = getCurrentUserId(req);
    const clubId = req.query['clubId'];

    if (typeof clubId !== 'string' || clubId.trim() === '') {
      throw new AppError(
        400,
        'MISSING_CLUB_ID',
        'clubId query parameter is required.'
      );
    }

    if (!isValidUUID(clubId)) {
      throw new AppError(
        400,
        'INVALID_CLUB_ID',
        'clubId must be a valid UUID.'
      );
    }

    const membership = await getMyMembership(clubId, userId);

    res.json({ success: true, data: membership });
  } catch (error) {
    next(error);
  }
}

// ─── POST /api/memberships/:membershipId/credits ──────────────────────────────

export async function addCreditsHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const actorUserId = getCurrentUserId(req);
    const membershipId = req.params['membershipId'] as string;

    if (!isValidUUID(membershipId)) {
      throw new AppError(
        400,
        'INVALID_MEMBERSHIP_ID',
        'membershipId must be a valid UUID.'
      );
    }

    const { amount, reason } = req.body ?? {};

    if (!isPositiveInteger(amount)) {
      throw new AppError(
        400,
        'INVALID_REQUEST_BODY',
        'amount must be a positive integer.'
      );
    }

    if (typeof reason !== 'string' || reason.trim() === '') {
      throw new AppError(
        400,
        'INVALID_REQUEST_BODY',
        'reason is required and must be a non-empty string.'
      );
    }

    const membership = await addCredits(
      membershipId,
      actorUserId,
      amount,
      reason.trim()
    );

    res.json({ success: true, data: membership });
  } catch (error) {
    next(error);
  }
}

// ─── GET /api/memberships/:membershipId ───────────────────────────────────────

export async function getMembershipByIdHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const membershipId = req.params['membershipId'] as string;

    if (!isValidUUID(membershipId)) {
      throw new AppError(
        400,
        'INVALID_MEMBERSHIP_ID',
        'membershipId must be a valid UUID.'
      );
    }

    const result = await getMembershipById(membershipId);
    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
}
