// src/config/cloudinary.ts
import { v2 as cloudinary } from 'cloudinary';
import { logger } from '../lib/logger';

// Configure Cloudinary on module load
const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
const apiKey = process.env.CLOUDINARY_API_KEY;
const apiSecret = process.env.CLOUDINARY_API_SECRET;

if (!cloudName || !apiKey || !apiSecret) {
  logger.warn(
    'Cloudinary credentials not configured. Image upload will not work.'
  );
} else {
  cloudinary.config({
    cloud_name: cloudName,
    api_key: apiKey,
    api_secret: apiSecret,
    secure: true,
  });
  logger.info('Cloudinary configured successfully');
}

export { cloudinary };
