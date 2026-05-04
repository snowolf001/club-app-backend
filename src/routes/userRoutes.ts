import { Router } from 'express';
import { deleteMyAccountHandler } from '../controllers/userController';
import { identifyUser } from '../middleware/identifyUser';

const router = Router();

// DELETE /api/users/me — account deletion (requires x-member-id)
router.delete('/users/me', identifyUser, deleteMyAccountHandler);

export default router;
