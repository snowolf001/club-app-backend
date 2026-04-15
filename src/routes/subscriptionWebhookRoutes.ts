import { Router } from 'express';
import {
  appleWebhookHandler,
  googleWebhookHandler,
} from '../controllers/subscriptionController';

const router = Router();

// ─────────────────────────────────────────────────────────────────────────────
// Provider webhooks (public — no apiKeyAuth)
// ─────────────────────────────────────────────────────────────────────────────

// ⚠️ TODO (MUST before production):
// - Apple: verify App Store Server Notification JWT signature
// - Google: verify Pub/Sub message authenticity / source

router.post('/subscriptions/webhooks/apple', appleWebhookHandler);
router.post('/subscriptions/webhooks/google', googleWebhookHandler);

export default router;
