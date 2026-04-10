import { Request, Response, NextFunction } from 'express';
import { AppError } from '../errors/AppError';
import { isValidUUID } from '../utils/validators';
import { getActorMemberId } from '../lib/auth';
import { pool } from '../db/pool';
import { createAuditLog } from '../services/auditLogService';
import {
  getClub,
  getClubSettings,
  updateClubSettings,
  getClubMembers,
  getClubLocations,
  addClubLocation,
  deleteClubLocation,
  joinClub,
  createClub,
  regenerateJoinCode,
  transferOwnership,
  removeMember,
  leaveClub,
  recoverMemberByDisplayName,
} from '../services/clubService';

// ─── GET /api/clubs/:clubId ───────────────────────────────────────────────────

export async function getClubHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const clubId = req.params['clubId'] as string;
    if (!isValidUUID(clubId)) {
      throw new AppError(
        400,
        'INVALID_CLUB_ID',
        'clubId must be a valid UUID.'
      );
    }
    const club = await getClub(clubId);
    res.json({ success: true, data: club });
  } catch (error) {
    next(error);
  }
}

// ─── GET /api/clubs/:clubId/settings ─────────────────────────────────────────

export async function getClubSettingsHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const clubId = req.params['clubId'] as string;
    if (!isValidUUID(clubId)) {
      throw new AppError(
        400,
        'INVALID_CLUB_ID',
        'clubId must be a valid UUID.'
      );
    }
    const settings = await getClubSettings(clubId);
    res.json({ success: true, data: settings });
  } catch (error) {
    next(error);
  }
}

// ─── PATCH /api/clubs/:clubId/settings ───────────────────────────────────────

export async function updateClubSettingsHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const clubId = req.params['clubId'] as string;
    if (!isValidUUID(clubId)) {
      throw new AppError(
        400,
        'INVALID_CLUB_ID',
        'clubId must be a valid UUID.'
      );
    }

    // Only admins and owners may update club settings
    const actorMemberId = getActorMemberId(req);
    const actorRow = await pool.query<{ role: string; user_id: string }>(
      `SELECT role, user_id FROM memberships WHERE id = $1 AND status = 'active' LIMIT 1`,
      [actorMemberId]
    );
    if (!['admin', 'owner'].includes(actorRow.rows[0]?.role ?? '')) {
      throw new AppError(
        403,
        'UNAUTHORIZED',
        'Only admins and owners can update club settings.'
      );
    }

    const { allowMemberBackfill, memberBackfillHours, hostBackfillHours } =
      req.body as Record<string, unknown>;
    const settings = await updateClubSettings(clubId, {
      allowMemberBackfill:
        typeof allowMemberBackfill === 'boolean'
          ? allowMemberBackfill
          : undefined,
      memberBackfillHours:
        typeof memberBackfillHours === 'number'
          ? memberBackfillHours
          : undefined,
      hostBackfillHours:
        typeof hostBackfillHours === 'number' ? hostBackfillHours : undefined,
    });

    void createAuditLog({
      clubId,
      actorUserId: actorRow.rows[0].user_id,
      entityType: 'club',
      entityId: clubId,
      action: 'club_settings_updated',
      metadata: { allowMemberBackfill, memberBackfillHours, hostBackfillHours },
    });

    res.json({ success: true, data: settings });
  } catch (error) {
    next(error);
  }
}

// ─── GET /api/clubs/:clubId/members ──────────────────────────────────────────

export async function getClubMembersHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const clubId = req.params['clubId'] as string;
    if (!isValidUUID(clubId)) {
      throw new AppError(
        400,
        'INVALID_CLUB_ID',
        'clubId must be a valid UUID.'
      );
    }
    const members = await getClubMembers(clubId);
    res.json({ success: true, data: members });
  } catch (error) {
    next(error);
  }
}

// ─── GET /api/clubs/:clubId/locations ────────────────────────────────────────

export async function getClubLocationsHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const clubId = req.params['clubId'] as string;
    if (!isValidUUID(clubId)) {
      throw new AppError(
        400,
        'INVALID_CLUB_ID',
        'clubId must be a valid UUID.'
      );
    }
    const locations = await getClubLocations(clubId);
    res.json({ success: true, data: locations });
  } catch (error) {
    next(error);
  }
}

// ─── POST /api/clubs/:clubId/locations ───────────────────────────────────────

export async function addClubLocationHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const clubId = req.params['clubId'] as string;
    if (!isValidUUID(clubId)) {
      throw new AppError(
        400,
        'INVALID_CLUB_ID',
        'clubId must be a valid UUID.'
      );
    }

    // Only admin or owner may add locations
    const actorMemberId = getActorMemberId(req);
    const memberRow = await pool.query<{ role: string; user_id: string }>(
      `SELECT role, user_id FROM memberships WHERE id = $1 AND status = 'active' LIMIT 1`,
      [actorMemberId]
    );
    const row = memberRow.rows[0];
    if (!row || !['admin', 'owner'].includes(row.role)) {
      throw new AppError(
        403,
        'FORBIDDEN',
        'Only admins or owners can add locations.'
      );
    }
    const { name, address } = req.body as {
      name?: unknown;
      address?: unknown;
    };
    if (typeof name !== 'string' || !name.trim()) {
      throw new AppError(400, 'INVALID_LOCATION', 'Location name is required.');
    }
    const location = await addClubLocation(
      clubId,
      name.trim(),
      typeof address === 'string' ? address.trim() : ''
    );

    void createAuditLog({
      clubId,
      actorUserId: row.user_id,
      entityType: 'location',
      entityId: location.id,
      action: 'location_created',
      metadata: { name: location.name, address: location.address },
    });

    res.status(201).json({ success: true, data: location });
  } catch (error) {
    next(error);
  }
}

// ─── DELETE /api/clubs/:clubId/locations/:locationId ─────────────────────────

export async function deleteClubLocationHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const clubId = req.params['clubId'] as string;
    const locationId = req.params['locationId'] as string;

    if (!isValidUUID(clubId)) {
      throw new AppError(
        400,
        'INVALID_CLUB_ID',
        'clubId must be a valid UUID.'
      );
    }
    if (!isValidUUID(locationId)) {
      throw new AppError(
        400,
        'INVALID_LOCATION_ID',
        'locationId must be a valid UUID.'
      );
    }

    const actorMemberId = getActorMemberId(req);
    const memberRow = await pool.query<{ role: string; user_id: string }>(
      `SELECT role, user_id FROM memberships WHERE id = $1 AND status = 'active' LIMIT 1`,
      [actorMemberId]
    );
    const role = memberRow.rows[0]?.role;
    if (!role || !['admin', 'owner'].includes(role)) {
      throw new AppError(
        403,
        'FORBIDDEN',
        'Only owners and admins can delete locations.'
      );
    }

    await deleteClubLocation(clubId, locationId);

    void createAuditLog({
      clubId,
      actorUserId: memberRow.rows[0].user_id,
      entityType: 'location',
      entityId: locationId,
      action: 'location_deleted',
      metadata: {},
    });

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
}

// ─── POST /api/clubs/join ─────────────────────────────────────────────────────

export async function joinClubHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { joinCode, firstName, lastName } = req.body as {
      joinCode?: unknown;
      firstName?: unknown;
      lastName?: unknown;
    };
    if (typeof joinCode !== 'string' || !joinCode.trim()) {
      throw new AppError(400, 'INVALID_JOIN_CODE', 'joinCode is required.');
    }
    if (typeof firstName !== 'string' || !firstName.trim()) {
      throw new AppError(400, 'INVALID_NAME', 'First name is required.');
    }
    if (typeof lastName !== 'string' || !lastName.trim()) {
      throw new AppError(400, 'INVALID_NAME', 'Last name is required.');
    }
    const result = await joinClub(
      joinCode.trim(),
      firstName.trim(),
      lastName.trim()
    );
    res.status(201).json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
}

// ─── POST /api/clubs ──────────────────────────────────────────────────────────

export async function createClubHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { name, firstName, lastName } = req.body as {
      name?: unknown;
      firstName?: unknown;
      lastName?: unknown;
    };
    if (typeof name !== 'string' || !name.trim()) {
      throw new AppError(400, 'INVALID_NAME', 'Club name is required.');
    }
    if (typeof firstName !== 'string' || !firstName.trim()) {
      throw new AppError(400, 'INVALID_NAME', 'First name is required.');
    }
    if (typeof lastName !== 'string' || !lastName.trim()) {
      throw new AppError(400, 'INVALID_NAME', 'Last name is required.');
    }
    const result = await createClub(
      name.trim(),
      firstName.trim(),
      lastName.trim()
    );
    res.status(201).json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
}

// ─── POST /api/clubs/:clubId/regenerate-join-code ─────────────────────────────

export async function regenerateJoinCodeHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const clubId = req.params['clubId'] as string;
    if (!isValidUUID(clubId)) {
      throw new AppError(
        400,
        'INVALID_CLUB_ID',
        'clubId must be a valid UUID.'
      );
    }
    const actorMemberId = getActorMemberId(req);
    const result = await regenerateJoinCode(clubId, actorMemberId);
    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
}

// ─── POST /api/clubs/:clubId/transfer-ownership ───────────────────────────────

export async function transferOwnershipHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const clubId = req.params['clubId'] as string;
    if (!isValidUUID(clubId)) {
      throw new AppError(
        400,
        'INVALID_CLUB_ID',
        'clubId must be a valid UUID.'
      );
    }
    const actorMemberId = getActorMemberId(req);
    const { targetMembershipId } = req.body as { targetMembershipId?: unknown };
    if (
      typeof targetMembershipId !== 'string' ||
      !isValidUUID(targetMembershipId)
    ) {
      throw new AppError(
        400,
        'INVALID_TARGET',
        'targetMembershipId must be a valid UUID.'
      );
    }
    await transferOwnership(clubId, actorMemberId, targetMembershipId);
    res.json({ success: true, data: null });
  } catch (error) {
    next(error);
  }
}

// ─── DELETE /api/clubs/:clubId/members/:membershipId ─────────────────────────

export async function removeMemberHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const clubId = req.params['clubId'] as string;
    const membershipId = req.params['membershipId'] as string;
    if (!isValidUUID(clubId)) {
      throw new AppError(
        400,
        'INVALID_CLUB_ID',
        'clubId must be a valid UUID.'
      );
    }
    if (!isValidUUID(membershipId)) {
      throw new AppError(
        400,
        'INVALID_MEMBERSHIP_ID',
        'membershipId must be a valid UUID.'
      );
    }
    const actorMemberId = getActorMemberId(req);
    await removeMember(clubId, membershipId, actorMemberId);
    res.json({ success: true, data: null });
  } catch (error) {
    next(error);
  }
}

// ─── POST /api/clubs/:clubId/leave ────────────────────────────────────────────

export async function leaveClubHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const clubId = req.params['clubId'] as string;
    if (!isValidUUID(clubId)) {
      throw new AppError(
        400,
        'INVALID_CLUB_ID',
        'clubId must be a valid UUID.'
      );
    }
    const actorMemberId = getActorMemberId(req);
    await leaveClub(actorMemberId);
    res.json({ success: true, data: null });
  } catch (error) {
    next(error);
  }
}

// ─── POST /api/clubs/:clubId/recover ─────────────────────────────────────────

export async function recoverClubMembershipHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const clubId = req.params['clubId'] as string;
    if (!isValidUUID(clubId)) {
      throw new AppError(
        400,
        'INVALID_CLUB_ID',
        'clubId must be a valid UUID.'
      );
    }
    const { displayName, recoveryCode } = req.body as {
      displayName?: unknown;
      recoveryCode?: unknown;
    };
    if (typeof displayName !== 'string' || !displayName.trim()) {
      throw new AppError(
        400,
        'INVALID_REQUEST_BODY',
        'displayName is required.'
      );
    }
    if (typeof recoveryCode !== 'string' || !recoveryCode.trim()) {
      throw new AppError(
        400,
        'INVALID_REQUEST_BODY',
        'recoveryCode is required.'
      );
    }
    const result = await recoverMemberByDisplayName(
      clubId,
      displayName.trim(),
      recoveryCode.trim()
    );
    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
}
