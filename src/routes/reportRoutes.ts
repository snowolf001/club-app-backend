import { Router } from 'express';
import {
  getSessionAttendeesHandler,
  getMemberHistoryHandler,
  getAttendanceReportHandler,
  getSessionsBreakdownHandler,
} from '../controllers/reportController';

const router = Router();

// Temporary auth stub — replace with real middleware before production.
router.use((req, _res, next) => {
  req.user = {
    id: '11111111-1111-1111-1111-111111111111',
    role: 'admin',
  };
  next();
});

// GET /api/reports/sessions/:sessionId/attendees
router.get(
  '/reports/sessions/:sessionId/attendees',
  getSessionAttendeesHandler
);

// GET /api/reports/members/:membershipId/history
router.get('/reports/members/:membershipId/history', getMemberHistoryHandler);

// GET /api/reports/attendance?clubId=&startDate=&endDate=
router.get('/reports/attendance', getAttendanceReportHandler);

// GET /api/reports/sessions/breakdown?clubId=&startDate=&endDate=&last=true
router.get('/reports/sessions/breakdown', getSessionsBreakdownHandler);

export default router;
