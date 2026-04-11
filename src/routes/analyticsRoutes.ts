import { Router } from 'express';
import { postTrackEvent, getAnalyticsSummary } from '../controllers/analyticsController';

const router = Router();

// POST /api/track — requires x-api-key (applied by app.ts), no identifyUser needed.
router.post('/track', postTrackEvent);

// GET /api/analytics — simple dashboard summary.
router.get('/analytics', getAnalyticsSummary);

export default router;
