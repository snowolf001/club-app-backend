import { Router } from 'express';
import { getAuditLogsHandler } from '../controllers/auditLogController';
import { identifyUser } from '../middleware/identifyUser';

const router = Router();

router.get('/audit-logs', identifyUser, getAuditLogsHandler);

export default router;
