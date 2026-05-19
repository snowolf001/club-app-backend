// src/services/uploadService.ts
import { cloudinary } from '../config/cloudinary';
import { AppError } from '../errors/AppError';
import { logger } from '../lib/logger';
import type { UploadApiResponse } from 'cloudinary';

export type UploadPurpose = 'club_logo' | 'payment_qr';

export type UploadImageParams = {
  fileBuffer: Buffer;
  clubId: string;
  purpose: UploadPurpose;
  filename: string;
};

/**
 * Upload an image to Cloudinary with appropriate folder structure.
 * Folder structure: passeo/clubs/{clubId}/logos or passeo/clubs/{clubId}/payment_qr
 * Filename format: {purpose}_{timestamp}_{random}
 * Returns the secure HTTPS URL of the uploaded image.
 */
export async function uploadImageToCloudinary(
  params: UploadImageParams
): Promise<string> {
  const { fileBuffer, clubId, purpose, filename } = params;

  // Determine folder based on purpose (club-scoped, not user-scoped)
  const folder =
    purpose === 'club_logo'
      ? `passeo/clubs/${clubId}/logos`
      : `passeo/clubs/${clubId}/payment_qr`;

  // Do not delete old logos during upload. If a user cancels their edit,
  // deleting here would break their existing logo.
  // Instead, orphaned logos should be cleaned up safely during the 'save'
  // process or via an async cron job.

  // Generate unique public_id: purpose_timestamp_random
  const timestamp = Date.now();
  const randomSuffix = Math.random().toString(36).substring(2, 8); // 6-char random string
  const purposePrefix = purpose === 'club_logo' ? 'logo' : 'qr';
  const publicId = `${purposePrefix}_${timestamp}_${randomSuffix}`;

  try {
    // Upload to Cloudinary using upload_stream
    const result = await new Promise<UploadApiResponse>((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          folder,
          resource_type: 'image',
          allowed_formats: ['jpg', 'jpeg', 'png', 'webp'],
          max_file_size: 2 * 1024 * 1024, // 2MB in bytes
          public_id: publicId,
        },
        (error, result) => {
          if (error) {
            reject(error);
          } else if (result) {
            resolve(result);
          } else {
            reject(new Error('Upload failed: No result returned'));
          }
        }
      );

      uploadStream.end(fileBuffer);
    });

    logger.info(`Image uploaded to Cloudinary: ${result.secure_url}`);
    return result.secure_url;
  } catch (error) {
    logger.error('Cloudinary upload error:', {
      error: error instanceof Error ? error.message : String(error),
    });
    throw new AppError(
      500,
      'UPLOAD_FAILED',
      'Failed to upload image. Please try again.'
    );
  }
}

export async function cleanupCloudinaryFolder(
  folder: string,
  keepPublicIds: string[]
): Promise<void> {
  try {
    const prefix = folder.endsWith('/') ? folder : `${folder}/`;

    let nextCursor: string | undefined;
    do {
      const result = await cloudinary.api.resources({
        type: 'upload',
        prefix,
        max_results: 100,
        next_cursor: nextCursor,
      });

      for (const res of result.resources) {
        if (!keepPublicIds.includes(res.public_id)) {
          try {
            await cloudinary.uploader.destroy(res.public_id);
            logger.info(`Cleaned up orphaned image: ${res.public_id}`);
          } catch (err) {
            logger.warn(`Failed to destroy image ${res.public_id}:`, {
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }
      }
      nextCursor = result.next_cursor;
    } while (nextCursor);
  } catch (error) {
    logger.warn(`Failed to cleanup Cloudinary folder ${folder}:`, {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Delete an image from Cloudinary by public_id.
 * This is optional - Cloudinary URLs are immutable, so we typically just
 * replace the URL in the database and leave old images in Cloudinary.
 */
export async function deleteImageFromCloudinary(
  publicId: string
): Promise<void> {
  try {
    await cloudinary.uploader.destroy(publicId);
    logger.info(`Image deleted from Cloudinary: ${publicId}`);
  } catch (error) {
    logger.warn('Failed to delete image from Cloudinary:', {
      error: error instanceof Error ? error.message : String(error),
    });
    // Don't throw - this is a cleanup operation
  }
}

/**
 * Extracts the Cloudinary public_id (including folder path) from a secure URL.
 */
export function extractPublicIdFromUrl(
  url: string | null | undefined
): string | null {
  if (!url) return null;
  const match = url.match(/\/upload\/(?:v\d+\/)?(.+?)(?:\.[a-zA-Z0-9]+)?$/);
  return match ? match[1] : null;
}
