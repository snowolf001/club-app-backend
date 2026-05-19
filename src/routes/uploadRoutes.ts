// src/routes/uploadRoutes.ts
import { Router } from 'express';
import { uploadImageHandler } from '../controllers/uploadController';

const router = Router();

// POST /api/uploads/image - Upload image to Cloudinary
router.post('/image', uploadImageHandler);

export default router;
