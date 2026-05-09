import { Request, Response, NextFunction } from 'express';
import { replaceMeal } from '../services/replaceMealService';
import type { ProteinScores } from '../utils/mealPreferences';

const VALID_MEAL_STYLES = ['Balanced', 'Healthy', 'Quick', 'Budget'] as const;

export async function replaceMealController(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const {
      day,
      originalMeal,
      otherMeals,
      people,
      mealStyle,
      preferredProteins,
      avoidedIngredients,
      proteinScores: rawProteinScores,
      cuisinePreferences: rawCuisinePreferences,
      cuisineStrength: rawCuisineStrength,
      country: rawCountry,
      groceryStyle: rawGroceryStyle,
      measurementUnits: rawMeasurementUnits,
      dietaryPreferences: rawDietaryPreferences,
      pantryStaples: rawPantryStaples,
    } = req.body;

    // ─── Validate required fields ───────────────────────────────────────────

    if (!day || typeof day !== 'string') {
      res.status(400).json({
        success: false,
        error: '`day` is required and must be a string.',
      });
      return;
    }

    if (
      !originalMeal ||
      typeof originalMeal !== 'object' ||
      !originalMeal.dishName
    ) {
      res.status(400).json({
        success: false,
        error: '`originalMeal` is required and must include `dishName`.',
      });
      return;
    }

    if (!people || typeof people !== 'number' || people < 1 || people > 10) {
      res.status(400).json({
        success: false,
        error: '`people` is required and must be an integer between 1 and 10.',
      });
      return;
    }

    if (
      !mealStyle ||
      !VALID_MEAL_STYLES.includes(
        mealStyle as (typeof VALID_MEAL_STYLES)[number]
      )
    ) {
      res.status(400).json({
        success: false,
        error: `\`mealStyle\` must be one of: ${VALID_MEAL_STYLES.join(', ')}.`,
      });
      return;
    }

    // ─── Build params with safe defaults ───────────────────────────────────

    const proteinScores: ProteinScores =
      rawProteinScores !== null &&
      typeof rawProteinScores === 'object' &&
      !Array.isArray(rawProteinScores)
        ? Object.fromEntries(
            Object.entries(rawProteinScores as Record<string, unknown>).filter(
              ([, v]) => typeof v === 'number'
            ) as [string, number][]
          )
        : {};

    const params = {
      day,
      originalMeal: {
        day: originalMeal.day ?? day,
        dishName: originalMeal.dishName,
        ingredients: Array.isArray(originalMeal.ingredients)
          ? originalMeal.ingredients
          : [],
      },
      otherMeals: Array.isArray(otherMeals)
        ? otherMeals.map((m: Record<string, unknown>) => ({
            day: String(m.day ?? ''),
            dishName: String(m.dishName ?? ''),
            protein: typeof m.protein === 'string' ? m.protein : undefined,
            ingredients: Array.isArray(m.ingredients) ? m.ingredients : [],
          }))
        : [],
      people,
      mealStyle,
      locale: 'US',
      preferredProteins: Array.isArray(preferredProteins)
        ? preferredProteins
        : [],
      avoidedIngredients: Array.isArray(avoidedIngredients)
        ? avoidedIngredients
        : [],
      proteinScores,
      cuisinePreferences: Array.isArray(rawCuisinePreferences)
        ? (rawCuisinePreferences as unknown[]).filter(
            (v): v is string => typeof v === 'string'
          )
        : [],
      cuisineStrength: (['light', 'moderate', 'strong'] as const).includes(
        rawCuisineStrength
      )
        ? (rawCuisineStrength as 'light' | 'moderate' | 'strong')
        : 'moderate',
      country: typeof rawCountry === 'string' ? rawCountry : undefined,
      groceryStyle:
        typeof rawGroceryStyle === 'string' &&
        ['regular', 'asian', 'mixed'].includes(rawGroceryStyle)
          ? (rawGroceryStyle as 'regular' | 'asian' | 'mixed')
          : undefined,
      measurementUnits:
        typeof rawMeasurementUnits === 'string' &&
        ['auto', 'imperial', 'metric'].includes(rawMeasurementUnits)
          ? (rawMeasurementUnits as 'auto' | 'imperial' | 'metric')
          : undefined,
      dietaryPreferences: Array.isArray(rawDietaryPreferences)
        ? (rawDietaryPreferences as unknown[]).filter(
            (v): v is string => typeof v === 'string'
          )
        : undefined,
      pantryStaples: Array.isArray(rawPantryStaples)
        ? (rawPantryStaples as unknown[]).filter(
            (v): v is string => typeof v === 'string'
          )
        : undefined,
    };

    console.log('[DinnerReady] replaceMealController start', {
      day,
      originalDish: originalMeal.dishName,
      mealStyle,
    });

    const data = await replaceMeal(params);

    res.status(200).json({ success: true, data });
  } catch (error) {
    next(error);
  }
}
