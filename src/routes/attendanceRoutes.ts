import { Router } from 'express';
import { getMyAttendanceHandler } from '../controllers/attendanceController';

const router = Router();

// Temporary auth stub — replace with real middleware before production.
router.use((req, _res, next) => {
  req.user = {
    id: '11111111-1111-1111-1111-111111111111',
    role: 'member',
  };
  next();
});

router.get('/attendance/me', getMyAttendanceHandler);

export default router;
