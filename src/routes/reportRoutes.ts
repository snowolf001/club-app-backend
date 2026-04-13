import { Router } from 'express';
import {
  getSessionAttendeesHandler,
  getMemberHistoryHandler,
  getAttendanceReportHandler,
  getSessionsBreakdownHandler,
  getReportSummaryHandler,
  getReportSessionHandler,
  getReportAuditHandler,
} from '../controllers/reportController';
import { identifyUser } from '../middleware/identifyUser';

const router = Router();

// ── Existing report routes ────────────────────────────────────────────────────

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

// ── New report routes ─────────────────────────────────────────────────────────

// GET /api/reports/summary?clubId=&from=&to=
router.get('/reports/summary', identifyUser, getReportSummaryHandler);

// GET /api/reports/session?clubId=&from=&to=
router.get('/reports/session', identifyUser, getReportSessionHandler);

// GET /api/reports/audit?clubId=&from=&to=  (Pro-only)
router.get('/reports/audit', identifyUser, getReportAuditHandler);

export default router;
