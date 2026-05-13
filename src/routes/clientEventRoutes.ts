import { Router } from 'express';
import { postClientEvent } from '../controllers/clientEventController';

const router = Router();

// POST /api/client-events
// Protected by apiKeyAuth (registered globally in app.ts)
router.post('/client-events', postClientEvent);

export default router;
