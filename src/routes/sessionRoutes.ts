import { Router } from 'express';
import { postSessionCheckIn } from '../controllers/sessionController';

const router = Router();

// Replace this later with real auth middleware.
router.use((req, _res, next) => {
  req.user = {
    id: '11111111-1111-1111-1111-111111111111',
    role: 'member',
  };
  next();
});

router.post('/sessions/:sessionId/checkin', postSessionCheckIn);

export default router;
