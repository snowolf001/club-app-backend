import express from 'express';
import cors from 'cors';
import sessionRoutes from './routes/sessionRoutes';
import membershipRoutes from './routes/membershipRoutes';
import attendanceRoutes from './routes/attendanceRoutes';
import auditLogRoutes from './routes/auditLogRoutes';
import clubRoutes from './routes/clubRoutes';
import reportRoutes from './routes/reportRoutes';
import analyticsRoutes from './routes/analyticsRoutes';
import subscriptionRoutes from './routes/subscriptionRoutes';
import subscriptionWebhookRoutes from './routes/subscriptionWebhookRoutes';
import { requestLogger } from './middleware/requestLogger';
import { errorHandler } from './middleware/errorHandler';
import { apiKeyAuth } from './middleware/apiKeyAuth';
import googleWebhookRoutes from './routes/googleWebhookRoutes';

const app = express();

app.use(cors());
app.use(express.json());
app.use(requestLogger);

app.get('/health', (_req, res) => {
  res.json({ success: true });
});

// Public webhook endpoints (no apiKeyAuth)
app.use('/api', subscriptionWebhookRoutes);
// new webhook routes
app.use('/api/webhooks', googleWebhookRoutes);

// Protected APIs
app.use('/api', apiKeyAuth, sessionRoutes);
app.use('/api', apiKeyAuth, membershipRoutes);
app.use('/api', apiKeyAuth, attendanceRoutes);
app.use('/api', apiKeyAuth, auditLogRoutes);
app.use('/api', apiKeyAuth, clubRoutes);
app.use('/api', apiKeyAuth, reportRoutes);
app.use('/api', apiKeyAuth, analyticsRoutes);
app.use('/api', apiKeyAuth, subscriptionRoutes);

app.use(errorHandler);

export default app;
