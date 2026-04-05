import { Router } from 'express';
import { getAuditLogsHandler } from '../controllers/auditLogController';

const router = Router();

// Temporary auth stub — replace with real middleware before production.
router.use((req, _res, next) => {
  req.user = {
    id: '11111111-1111-1111-1111-111111111111',
    role: 'admin',
  };
  next();
});

router.get('/audit-logs', getAuditLogsHandler);

export default router;
