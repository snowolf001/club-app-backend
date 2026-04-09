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

router.use(identifyUser);

router.get('/memberships/me', getMyMembershipHandler);
router.post('/memberships/recover', recoverMembershipHandler);
router.get('/memberships/:membershipId', getMembershipByIdHandler);
router.post('/memberships/:membershipId/credits', addCreditsHandler);
router.patch('/memberships/:membershipId/role', updateMemberRoleHandler);
router.get('/memberships/:membershipId/attendance', getMemberAttendanceHandler);
router.get(
  '/memberships/:membershipId/credits',
  getMemberCreditTransactionsHandler
);

export default router;
