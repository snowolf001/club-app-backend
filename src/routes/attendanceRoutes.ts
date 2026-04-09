import { Router } from 'express';
import {
  getMyAttendanceHandler,
  getMyCreditTransactionsHandler,
} from '../controllers/attendanceController';
import { identifyUser } from '../middleware/identifyUser';

const router = Router();

router.use(identifyUser);

router.get('/attendance/me', getMyAttendanceHandler);
router.get('/credits/me', getMyCreditTransactionsHandler);

export default router;
