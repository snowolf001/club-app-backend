import { Request, Response, NextFunction } from 'express';
import { AppError } from '../errors/AppError';
import { isValidUUID } from '../utils/validators';
import { getActorMemberId } from '../lib/auth';
import {
  getMyMembership,
  addCredits,
  getMembershipById,
  getMembershipByRecoveryCode,
  updateMemberRole,
} from '../services/membershipService';
import { isNonZeroInteger } from '../utils/validators';

// ─── GET /api/memberships/me?clubId=... ───────────────────────────────────────

export async function getMyMembershipHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const actorMemberId = getActorMemberId(req);
    const membership = await getMembershipById(actorMemberId);
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
    const actorMemberId = getActorMemberId(req);
    const membershipId = req.params['membershipId'] as string;

    if (!isValidUUID(membershipId)) {
      throw new AppError(
        400,
        'INVALID_MEMBERSHIP_ID',
        'membershipId must be a valid UUID.'
      );
    }

    const { amount, reason } = req.body ?? {};

    if (!isNonZeroInteger(amount)) {
      throw new AppError(
        400,
        'INVALID_REQUEST_BODY',
        'amount must be a non-zero integer (positive to add, negative to deduct).'
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
      actorMemberId,
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

// ─── PATCH /api/memberships/:membershipId/role ────────────────────────────────

export async function updateMemberRoleHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const actorMemberId = getActorMemberId(req);
    const membershipId = req.params['membershipId'] as string;

    if (!isValidUUID(membershipId)) {
      throw new AppError(
        400,
        'INVALID_MEMBERSHIP_ID',
        'membershipId must be a valid UUID.'
      );
    }

    const { role } = req.body ?? {};

    if (role !== 'member' && role !== 'host' && role !== 'admin') {
      throw new AppError(
        400,
        'INVALID_ROLE',
        'role must be one of: "member", "host", "admin".'
      );
    }

    const membership = await updateMemberRole(
      membershipId,
      actorMemberId,
      role as 'member' | 'host' | 'admin'
    );
    res.json({ success: true, data: membership });
  } catch (error) {
    next(error);
  }
}

// ─── POST /api/memberships/recover ───────────────────────────────────────────

export async function recoverMembershipHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { recoveryCode } = req.body ?? {};

    if (typeof recoveryCode !== 'string' || recoveryCode.trim() === '') {
      throw new AppError(
        400,
        'MISSING_RECOVERY_CODE',
        'recoveryCode is required.'
      );
    }

    const result = await getMembershipByRecoveryCode(recoveryCode.trim());
    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
}
