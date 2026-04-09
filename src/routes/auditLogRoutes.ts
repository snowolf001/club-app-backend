import { Router } from 'express';
import { getAuditLogsHandler } from '../controllers/auditLogController';
import { identifyUser } from '../middleware/identifyUser';

const router = Router();

router.use(identifyUser);

router.get('/audit-logs', getAuditLogsHandler);

export default router;
