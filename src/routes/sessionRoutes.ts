import { Router } from 'express';
import {
  getSessionsHandler,
  getSessionHandler,
  postSessionCheckIn,
  getCheckedInHandler,
  createSessionHandler,
  updateSessionHandler,
  postManualCheckIn,
  deleteSessionHandler,
} from '../controllers/sessionController';
import {
  getSessionIntentsHandler,
  putSessionIntentHandler,
} from '../controllers/intentController';
import { identifyUser } from '../middleware/identifyUser';

const router = Router();

router.get('/sessions', identifyUser, getSessionsHandler);
router.get('/sessions/:sessionId', identifyUser, getSessionHandler);
router.post('/sessions', identifyUser, createSessionHandler);
router.patch('/sessions/:sessionId', identifyUser, updateSessionHandler);
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
router.get(
  '/sessions/:sessionId/intents',
  identifyUser,
  getSessionIntentsHandler
);
router.put(
  '/sessions/:sessionId/intent',
  identifyUser,
  putSessionIntentHandler
);

export default router;
