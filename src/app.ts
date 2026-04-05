import express from 'express';
import sessionRoutes from './routes/sessionRoutes';
import membershipRoutes from './routes/membershipRoutes';
import attendanceRoutes from './routes/attendanceRoutes';
import auditLogRoutes from './routes/auditLogRoutes';
import clubRoutes from './routes/clubRoutes';
import reportRoutes from './routes/reportRoutes';
import { requestLogger } from './middleware/requestLogger';
import { errorHandler } from './middleware/errorHandler';

const app = express();

app.use(express.json());
app.use(requestLogger);

app.get('/health', (_req, res) => {
  res.json({ success: true });
});

app.use('/api', sessionRoutes);
app.use('/api', membershipRoutes);
app.use('/api', attendanceRoutes);
app.use('/api', auditLogRoutes);
app.use('/api', clubRoutes);
app.use('/api', reportRoutes);

app.use(errorHandler);

export default app;
