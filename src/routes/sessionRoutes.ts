import { Router } from 'express';
import {
  getSessionsHandler,
  getSessionHandler,
  postSessionCheckIn,
  getCheckedInHandler,
  createSessionHandler,
  postManualCheckIn,
  deleteSessionHandler,
} from '../controllers/sessionController';
import { identifyUser } from '../middleware/identifyUser';

const router = Router();

router.use(identifyUser);

router.get('/sessions', getSessionsHandler);
router.get('/sessions/:sessionId', getSessionHandler);
router.post('/sessions', createSessionHandler);
router.delete('/sessions/:sessionId', deleteSessionHandler);
router.post('/sessions/:sessionId/checkin', postSessionCheckIn);
router.post('/sessions/:sessionId/checkin-manual', postManualCheckIn);
router.get('/sessions/:sessionId/checked-in', getCheckedInHandler);

export default router;
