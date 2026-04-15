import { Router } from 'express';
import { googlePlayWebhookHandler } from '../controllers/googleRtdnController';

const router = Router();

router.post('/google-play', googlePlayWebhookHandler);

export default router;
