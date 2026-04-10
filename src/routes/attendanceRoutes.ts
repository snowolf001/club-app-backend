import { Router } from 'express';
import {
  getMyAttendanceHandler,
  getMyCreditTransactionsHandler,
} from '../controllers/attendanceController';
import { identifyUser } from '../middleware/identifyUser';

const router = Router();

router.get('/attendance/me', identifyUser, getMyAttendanceHandler);
router.get('/credits/me', identifyUser, getMyCreditTransactionsHandler);

export default router;
