import { Router } from 'express';
import { postTrackEvent } from '../controllers/analyticsController';

const router = Router();

// POST /api/track — requires x-api-key (applied by app.ts), no identifyUser needed.
router.post('/track', postTrackEvent);

export default router;
