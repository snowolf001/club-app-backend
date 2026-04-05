import { Router } from 'express';
import {
  getClubHandler,
  getClubSettingsHandler,
  updateClubSettingsHandler,
  getClubMembersHandler,
  getClubLocationsHandler,
  addClubLocationHandler,
  joinClubHandler,
  createClubHandler,
} from '../controllers/clubController';

const router = Router();

// No auth required — clubs are looked up by ID during onboarding/bootstrap.
router.get('/clubs/:clubId', getClubHandler);

// Auth required routes
router.get('/clubs/:clubId/settings', getClubSettingsHandler);
router.patch('/clubs/:clubId/settings', updateClubSettingsHandler);
router.get('/clubs/:clubId/members', getClubMembersHandler);
router.get('/clubs/:clubId/locations', getClubLocationsHandler);
router.post('/clubs/:clubId/locations', addClubLocationHandler);
router.post('/clubs/join', joinClubHandler);
router.post('/clubs', createClubHandler);

export default router;
