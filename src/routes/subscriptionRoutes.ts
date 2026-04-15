import { Router } from 'express';
import {
  verifyPurchaseHandler,
  getProStatusHandler,
  refreshStatusHandler,
} from '../controllers/subscriptionController';

const router = Router();

// ─────────────────────────────────────────────────────────────────────────────
// Subscription APIs (require auth — handled globally in app.ts)
// ─────────────────────────────────────────────────────────────────────────────

// Verify IAP receipt / purchase token and grant/schedule Pro
router.post('/subscriptions/verify', verifyPurchaseHandler);

// Get current Pro status for a club
router.get('/subscriptions/status', getProStatusHandler);

// ─────────────────────────────────────────────────────────────────────────────
// Debug endpoint (DO NOT expose in production)
// ─────────────────────────────────────────────────────────────────────────────

if (process.env.NODE_ENV !== 'production') {
  router.post('/subscriptions/refresh', refreshStatusHandler);
}

export default router;
