import { Request, Response, NextFunction } from 'express';
import { AppError } from '../errors/AppError';
import { isValidUUID } from '../utils/validators';
import {
  getClub,
  getClubSettings,
  updateClubSettings,
  getClubMembers,
  getClubLocations,
  addClubLocation,
  joinClub,
  createClub,
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
    const { name, address } = req.body as { name?: unknown; address?: unknown };
    if (typeof name !== 'string' || !name.trim()) {
      throw new AppError(400, 'INVALID_LOCATION', 'Location name is required.');
    }
    const location = await addClubLocation(
      clubId,
      name.trim(),
      typeof address === 'string' ? address.trim() : ''
    );
    res.status(201).json({ success: true, data: location });
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
    const userId = (req as Request & { user?: { id: string } }).user?.id;
    if (!userId) throw new AppError(401, 'UNAUTHORIZED', 'Not authenticated.');
    const { joinCode } = req.body as { joinCode?: unknown };
    if (typeof joinCode !== 'string' || !joinCode.trim()) {
      throw new AppError(400, 'INVALID_JOIN_CODE', 'joinCode is required.');
    }
    const result = await joinClub(joinCode.trim(), userId);
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
    const userId = (req as Request & { user?: { id: string } }).user?.id;
    if (!userId) throw new AppError(401, 'UNAUTHORIZED', 'Not authenticated.');
    const { name } = req.body as { name?: unknown };
    if (typeof name !== 'string' || !name.trim()) {
      throw new AppError(400, 'INVALID_NAME', 'Club name is required.');
    }
    const result = await createClub(name.trim(), userId);
    res.status(201).json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
}
