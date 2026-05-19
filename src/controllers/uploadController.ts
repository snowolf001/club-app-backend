// src/controllers/uploadController.ts
import type { Request, Response, NextFunction } from 'express';
import multer from 'multer';
import { AppError } from '../errors/AppError';
import { getActorMemberId } from '../lib/auth';
import { pool } from '../db/pool';
import { normalizeRole, isOwnerOrHost } from '../lib/permissions';
import {
  uploadImageToCloudinary,
  type UploadPurpose,
} from '../services/uploadService';

// Configure multer for memory storage (no disk writes)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 2 * 1024 * 1024, // 2MB
  },
  fileFilter: (req, file, cb) => {
    // Only allow image files
    const allowedMimeTypes = ['image/jpeg', 'image/png', 'image/webp'];
    if (allowedMimeTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(
        new AppError(
          400,
          'INVALID_FILE_TYPE',
          'Only JPEG, PNG, and WebP images are allowed.'
        )
      );
    }
  },
}).single('image');

/**
 * POST /api/uploads/image
 * Upload an image to Cloudinary for club logo or payment QR code.
 */
export async function uploadImageHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  // Parse multipart/form-data
  upload(req, res, async (err) => {
    try {
      // Handle multer errors
      if (err) {
        if (err instanceof multer.MulterError) {
          if (err.code === 'LIMIT_FILE_SIZE') {
            throw new AppError(
              413,
              'FILE_TOO_LARGE',
              'Image must be smaller than 2MB.'
            );
          }
          throw new AppError(400, 'UPLOAD_ERROR', err.message);
        }
        throw err;
      }

      // Validate file was uploaded
      if (!req.file) {
        throw new AppError(400, 'IMAGE_REQUIRED', 'Image file is required.');
      }

      // Validate clubId
      const clubId = req.body.clubId as string | undefined;
      if (!clubId || typeof clubId !== 'string') {
        throw new AppError(400, 'CLUB_ID_REQUIRED', 'clubId is required.');
      }

      // Validate purpose
      const purpose = req.body.purpose as string | undefined;
      if (!purpose || typeof purpose !== 'string') {
        throw new AppError(400, 'PURPOSE_REQUIRED', 'purpose is required.');
      }

      const allowedPurposes: UploadPurpose[] = ['club_logo', 'payment_qr'];
      if (!allowedPurposes.includes(purpose as UploadPurpose)) {
        throw new AppError(
          400,
          'INVALID_PURPOSE',
          `purpose must be one of: ${allowedPurposes.join(', ')}`
        );
      }

      // Verify actor is owner or host of the club
      const actorMemberId = getActorMemberId(req);
      const memberResult = await pool.query<{
        role: string;
        club_id: string;
      }>(
        `SELECT role, club_id FROM memberships WHERE id = $1 AND status = 'active' LIMIT 1`,
        [actorMemberId]
      );

      const member = memberResult.rows[0];
      if (!member || member.club_id !== clubId) {
        throw new AppError(
          403,
          'NOT_CLUB_MEMBER',
          'You are not a member of this club.'
        );
      }

      if (!isOwnerOrHost(normalizeRole(member.role))) {
        throw new AppError(
          403,
          'INSUFFICIENT_PERMISSIONS',
          'Only club owners and hosts can upload images.'
        );
      }

      // Upload to Cloudinary
      const url = await uploadImageToCloudinary({
        fileBuffer: req.file.buffer,
        clubId,
        purpose: purpose as UploadPurpose,
        filename: req.file.originalname,
      });

      res.json({
        success: true,
        data: { url },
      });
    } catch (error) {
      next(error);
    }
  });
}
