import { Router } from 'express';
import {
  getSessionsHandler,
  getSessionHandler,
  postSessionCheckIn,
  getCheckedInHandler,
  createSessionHandler,
  postManualCheckIn,
} from '../controllers/sessionController';

const router = Router();

// Temporary auth stub — replace with real middleware before production.
router.use((req, _res, next) => {
  req.user = {
    id: '11111111-1111-1111-1111-111111111111',
    role: 'member',
  };
  next();
});

router.get('/sessions', getSessionsHandler);
router.get('/sessions/:sessionId', getSessionHandler);
router.post('/sessions', createSessionHandler);
router.post('/sessions/:sessionId/checkin', postSessionCheckIn);
router.post('/sessions/:sessionId/checkin-manual', postManualCheckIn);
router.get('/sessions/:sessionId/checked-in', getCheckedInHandler);

export default router;
