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

router.get('/sessions', identifyUser, getSessionsHandler);
router.get('/sessions/:sessionId', identifyUser, getSessionHandler);
router.post('/sessions', identifyUser, createSessionHandler);
router.delete('/sessions/:sessionId', identifyUser, deleteSessionHandler);
router.post('/sessions/:sessionId/checkin', identifyUser, postSessionCheckIn);
router.post(
  '/sessions/:sessionId/checkin-manual',
  identifyUser,
  postManualCheckIn
);
router.get(
  '/sessions/:sessionId/checked-in',
  identifyUser,
  getCheckedInHandler
);

export default router;
