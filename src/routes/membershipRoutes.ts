import { Router } from 'express';
import {
  getMyMembershipHandler,
  addCreditsHandler,
  getMembershipByIdHandler,
  updateMemberRoleHandler,
  recoverMembershipHandler,
} from '../controllers/membershipController';
import {
  getMemberAttendanceHandler,
  getMemberCreditTransactionsHandler,
} from '../controllers/attendanceController';
import { identifyUser } from '../middleware/identifyUser';

const router = Router();

// Bootstrap endpoint — no membershipId yet, must come before identifyUser
router.post('/memberships/recover', recoverMembershipHandler);

router.get('/memberships/me', identifyUser, getMyMembershipHandler);
router.get(
  '/memberships/:membershipId',
  identifyUser,
  getMembershipByIdHandler
);
router.post(
  '/memberships/:membershipId/credits',
  identifyUser,
  addCreditsHandler
);
router.patch(
  '/memberships/:membershipId/role',
  identifyUser,
  updateMemberRoleHandler
);
router.get(
  '/memberships/:membershipId/attendance',
  identifyUser,
  getMemberAttendanceHandler
);
router.get(
  '/memberships/:membershipId/credits',
  identifyUser,
  getMemberCreditTransactionsHandler
);

export default router;
