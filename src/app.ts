import express from 'express';
import sessionRoutes from './routes/sessionRoutes';
import membershipRoutes from './routes/membershipRoutes';
import attendanceRoutes from './routes/attendanceRoutes';
import auditLogRoutes from './routes/auditLogRoutes';
import clubRoutes from './routes/clubRoutes';
import reportRoutes from './routes/reportRoutes';
import analyticsRoutes from './routes/analyticsRoutes';
import { requestLogger } from './middleware/requestLogger';
import { errorHandler } from './middleware/errorHandler';
import { apiKeyAuth } from './middleware/apiKeyAuth';

const app = express();

app.use(express.json());
app.use(requestLogger);

app.get('/health', (_req, res) => {
  res.json({ success: true });
});

app.use('/api', apiKeyAuth, sessionRoutes);
app.use('/api', apiKeyAuth, membershipRoutes);
app.use('/api', apiKeyAuth, attendanceRoutes);
app.use('/api', apiKeyAuth, auditLogRoutes);
app.use('/api', apiKeyAuth, clubRoutes);
app.use('/api', apiKeyAuth, reportRoutes);
app.use('/api', apiKeyAuth, analyticsRoutes);

app.use(errorHandler);

export default app;
