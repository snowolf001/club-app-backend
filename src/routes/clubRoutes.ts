import { Router } from 'express';
import {
  getClubHandler,
  getClubSettingsHandler,
  updateClubSettingsHandler,
  getClubMembersHandler,
  getClubLocationsHandler,
  addClubLocationHandler,
  deleteClubLocationHandler,
  joinClubHandler,
  createClubHandler,
  regenerateJoinCodeHandler,
  transferOwnershipHandler,
  removeMemberHandler,
  leaveClubHandler,
  recoverClubMembershipHandler,
  getClubInfoHandler,
  updateClubInfoHandler,
} from '../controllers/clubController';

import { identifyUser } from '../middleware/identifyUser';

const router = Router();

// No auth required — clubs are looked up by ID during onboarding/bootstrap.
router.get('/clubs/:clubId', getClubHandler);

// Auth required routes
router.get('/clubs/:clubId/settings', identifyUser, getClubSettingsHandler);
router.patch(
  '/clubs/:clubId/settings',
  identifyUser,
  updateClubSettingsHandler
);
router.get('/clubs/:clubId/members', identifyUser, getClubMembersHandler);
router.delete(
  '/clubs/:clubId/members/:membershipId',
  identifyUser,
  removeMemberHandler
);
router.post('/clubs/:clubId/leave', identifyUser, leaveClubHandler);
router.get('/clubs/:clubId/locations', identifyUser, getClubLocationsHandler);
router.post('/clubs/:clubId/locations', identifyUser, addClubLocationHandler);
router.delete(
  '/clubs/:clubId/locations/:locationId',
  identifyUser,
  deleteClubLocationHandler
);
router.post(
  '/clubs/:clubId/regenerate-join-code',
  identifyUser,
  regenerateJoinCodeHandler
);
router.post(
  '/clubs/:clubId/transfer-ownership',
  identifyUser,
  transferOwnershipHandler
);
router.post('/clubs/:clubId/recover', recoverClubMembershipHandler);
router.post('/clubs/join', joinClubHandler);
router.post('/clubs', createClubHandler);

// Club info endpoints
router.get('/clubs/:clubId/info', identifyUser, getClubInfoHandler);
router.patch('/clubs/:clubId/info', identifyUser, updateClubInfoHandler);

export default router;
