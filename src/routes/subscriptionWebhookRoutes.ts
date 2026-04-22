import { Router } from 'express';
import {
  appleWebhookHandler,
  googleWebhookHandler,
} from '../controllers/subscriptionController';

const router = Router();

// ─────────────────────────────────────────────────────────────────────────────
// Provider webhooks (public — no apiKeyAuth)
// ─────────────────────────────────────────────────────────────────────────────

// Apple: JWT signature verified inside appleWebhookHandler via appleJwtVerify.ts
// Google: PubSub JWT verified inside googlePlayWebhookHandler at /api/webhooks/google-play

router.post('/subscriptions/webhooks/apple', appleWebhookHandler);
router.post('/subscriptions/webhooks/google', googleWebhookHandler);

export default router;
