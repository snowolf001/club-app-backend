import type { Request, Response, NextFunction } from 'express';
import type { GenerateMealPlanRequest, MealPlanStyle } from '../types/mealPlan';
import { generateSimpleMealPlan } from '../services/simpleMealPlanService';

const VALID_STYLES: MealPlanStyle[] = [
  'balanced',
  'healthy',
  'quick',
  'budget',
];

export async function generateSimpleMealPlanController(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const body = req.body as Partial<GenerateMealPlanRequest>;

    // Validate people
    const people = body.people;
    if (
      people === undefined ||
      typeof people !== 'number' ||
      !Number.isInteger(people) ||
      people < 1 ||
      people > 6
    ) {
      res.status(400).json({
        success: false,
        error: "Invalid 'people' value. Must be an integer between 1 and 6.",
      });
      return;
    }

    // Validate style
    const style = body.style;
    if (!style || !VALID_STYLES.includes(style)) {
      res.status(400).json({
        success: false,
        error: `Invalid 'style' value. Must be one of: ${VALID_STYLES.join(', ')}.`,
      });
      return;
    }

    const data = await generateSimpleMealPlan({ people, style });

    res.status(200).json({ success: true, data });
  } catch (err) {
    next(err);
  }
}
