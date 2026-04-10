import { Router } from 'express';
import {
  getSessionAttendeesHandler,
  getMemberHistoryHandler,
  getAttendanceReportHandler,
  getSessionsBreakdownHandler,
} from '../controllers/reportController';
import { identifyUser } from '../middleware/identifyUser';

const router = Router();

// GET /api/reports/sessions/:sessionId/attendees
router.get(
  '/reports/sessions/:sessionId/attendees',
  identifyUser,
  getSessionAttendeesHandler
);

// GET /api/reports/members/:membershipId/history
router.get(
  '/reports/members/:membershipId/history',
  identifyUser,
  getMemberHistoryHandler
);

// GET /api/reports/attendance?clubId=&startDate=&endDate=
router.get('/reports/attendance', identifyUser, getAttendanceReportHandler);

// GET /api/reports/sessions/breakdown?clubId=&startDate=&endDate=&last=true
router.get(
  '/reports/sessions/breakdown',
  identifyUser,
  getSessionsBreakdownHandler
);

export default router;
