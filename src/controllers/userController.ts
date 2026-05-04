import { Request, Response, NextFunction } from 'express';
import { getActorMemberId } from '../lib/auth';
import { deleteUserAccount } from '../services/userService';

// ─── DELETE /api/users/me ──────────────────────────────────────────────────────

export async function deleteMyAccountHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const actorMembershipId = getActorMemberId(req);
    await deleteUserAccount(actorMembershipId);
    res.json({ success: true, message: 'Account deleted' });
  } catch (error) {
    next(error);
  }
}
