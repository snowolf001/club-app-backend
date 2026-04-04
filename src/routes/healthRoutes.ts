import { Router } from 'express';
import { getRoot, getHealth } from '../controllers/healthController';

const router = Router();

router.get('/', getRoot);
router.get('/health', getHealth);

export default router;
