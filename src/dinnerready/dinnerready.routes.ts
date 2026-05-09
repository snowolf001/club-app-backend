import { Router, Request, Response } from 'express';
import { generateMealPlanController } from './controllers/mealPlanController';
import { generateSimpleMealPlanController } from './controllers/simpleMealPlanController';
import { replaceMealController } from './controllers/replaceMealController';

const router = Router();

// Health check
router.get('/health', (_req: Request, res: Response) => {
  res.json({ ok: true, app: 'dinnerready' });
});

// Meal plan generation
router.post('/generate-meal-plan', generateMealPlanController);
router.post('/simple', generateSimpleMealPlanController);
router.post('/replace-meal', replaceMealController);

export default router;
