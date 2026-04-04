import express from 'express';
import sessionRoutes from './routes/sessionRoutes';
import { errorHandler } from './middleware/errorHandler';

const app = express();

app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ success: true });
});

app.use('/api', sessionRoutes);

app.use(errorHandler);

export default app;
