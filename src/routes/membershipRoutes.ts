import { Router } from 'express';
import {
  getMyMembershipHandler,
  addCreditsHandler,
  getMembershipByIdHandler,
  updateMemberRoleHandler,
  recoverMembershipHandler,
} from '../controllers/membershipController';
import { getMemberAttendanceHandler } from '../controllers/attendanceController';

const router = Router();

// Temporary auth stub — replace with real middleware before production.
router.use((req, _res, next) => {
  req.user = {
    id: '11111111-1111-1111-1111-111111111111',
    role: 'member',
  };
  next();
});

router.get('/memberships/me', getMyMembershipHandler);
router.post('/memberships/recover', recoverMembershipHandler);
router.get('/memberships/:membershipId', getMembershipByIdHandler);
router.post('/memberships/:membershipId/credits', addCreditsHandler);
router.patch('/memberships/:membershipId/role', updateMemberRoleHandler);
router.get('/memberships/:membershipId/attendance', getMemberAttendanceHandler);

export default router;
