import type { Request, Response, NextFunction } from 'express';
import type { GenerateMealPlanRequest, MealPlanStyle } from '../types/mealPlan';
import type { UnitSystem } from '../prompts/mealPlanPrompt';
import { generateMealPlan } from '../services/mealPlanService';
import type { ProteinScores } from '../utils/mealPreferences';

const VALID_STYLES: MealPlanStyle[] = [
  'balanced',
  'healthy',
  'quick',
  'budget',
];
const VALID_UNIT_SYSTEMS: UnitSystem[] = ['imperial', 'metric'];
const VALID_APPETITE_LEVELS = ['light', 'normal', 'heavy'] as const;
type AppetiteLevel = (typeof VALID_APPETITE_LEVELS)[number];

export async function generateMealPlanController(
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

    // Validate unitSystem (optional, defaults to "imperial")
    const unitSystem: UnitSystem = body.unitSystem ?? 'imperial';
    if (!VALID_UNIT_SYSTEMS.includes(unitSystem)) {
      res.status(400).json({
        success: false,
        error: `Invalid 'unitSystem' value. Must be one of: ${VALID_UNIT_SYSTEMS.join(', ')}.`,
      });
      return;
    }

    // Validate locale (optional, defaults to "US")
    const rawLocale = body.locale;
    if (rawLocale !== undefined && typeof rawLocale !== 'string') {
      res.status(400).json({
        success: false,
        error: "Invalid 'locale' value. Must be a string.",
      });
      return;
    }
    const locale = rawLocale?.trim() || 'US';

    // Optional preference fields
    const preferredProteins = Array.isArray(body.preferredProteins)
      ? (body.preferredProteins as unknown[]).filter(
          (p): p is string => typeof p === 'string'
        )
      : [];

    const avoidedIngredients = Array.isArray(body.avoidedIngredients)
      ? (body.avoidedIngredients as unknown[]).filter(
          (p): p is string => typeof p === 'string'
        )
      : [];

    const rawProteinScores = body.proteinScores;
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

    // Optional appetiteLevel — default to 'normal'
    const rawAppetiteLevel = (body as Record<string, unknown>).appetiteLevel;
    const appetiteLevel: AppetiteLevel =
      typeof rawAppetiteLevel === 'string' &&
      VALID_APPETITE_LEVELS.includes(rawAppetiteLevel as AppetiteLevel)
        ? (rawAppetiteLevel as AppetiteLevel)
        : 'normal';

    // Optional cuisine preferences
    const cuisinePreferences = Array.isArray(body.cuisinePreferences)
      ? (body.cuisinePreferences as unknown[]).filter(
          (c): c is string => typeof c === 'string'
        )
      : [];

    const rawCuisineStrength = (body as Record<string, unknown>).cuisineStrength;
    const cuisineStrength =
      typeof rawCuisineStrength === 'string' &&
      ['light', 'moderate', 'strong'].includes(rawCuisineStrength)
        ? (rawCuisineStrength as 'light' | 'moderate' | 'strong')
        : 'moderate';

    // New optional fields
    const rawCountry = (body as Record<string, unknown>).country;
    const country =
      typeof rawCountry === 'string' ? rawCountry.trim() : undefined;

    const rawMeasurementUnits = (body as Record<string, unknown>).measurementUnits;
    const measurementUnits =
      typeof rawMeasurementUnits === 'string' &&
      ['auto', 'imperial', 'metric'].includes(rawMeasurementUnits)
        ? (rawMeasurementUnits as 'auto' | 'imperial' | 'metric')
        : undefined;

    const rawGroceryStyle = (body as Record<string, unknown>).groceryStyle;
    const groceryStyle =
      typeof rawGroceryStyle === 'string' &&
      ['regular', 'asian', 'mixed'].includes(rawGroceryStyle)
        ? (rawGroceryStyle as 'regular' | 'asian' | 'mixed')
        : undefined;

    const rawMealStyle = (body as Record<string, unknown>).mealStyle;
    const mealStyle =
      typeof rawMealStyle === 'string' &&
      ['Quick', 'Balanced', 'Comfort'].includes(rawMealStyle)
        ? (rawMealStyle as 'Quick' | 'Balanced' | 'Comfort')
        : undefined;

    const rawVarietyLevel = (body as Record<string, unknown>).varietyLevel;
    const varietyLevel =
      typeof rawVarietyLevel === 'string' &&
      ['Low', 'Medium', 'High'].includes(rawVarietyLevel)
        ? (rawVarietyLevel as 'Low' | 'Medium' | 'High')
        : undefined;

    const rawDietaryPreferences = (body as Record<string, unknown>).dietaryPreferences;
    const dietaryPreferences = Array.isArray(rawDietaryPreferences)
      ? (rawDietaryPreferences as unknown[]).filter(
          (p): p is string => typeof p === 'string'
        )
      : undefined;

    const rawPantryStaples = (body as Record<string, unknown>).pantryStaples;
    const pantryStaples = Array.isArray(rawPantryStaples)
      ? (rawPantryStaples as unknown[]).filter(
          (p): p is string => typeof p === 'string'
        )
      : undefined;

    const rawUserPreferences = (body as Record<string, unknown>).userPreferences;
    const userPreferences =
      rawUserPreferences !== null &&
      typeof rawUserPreferences === 'object' &&
      !Array.isArray(rawUserPreferences)
        ? (rawUserPreferences as {
            likedIngredients?: string[];
            dislikedIngredients?: string[];
            frequentlyReplaced?: string[];
            preferredCuisines?: string[];
          })
        : undefined;

    const rawSeed = (body as Record<string, unknown>).seed;
    const seed =
      typeof rawSeed === 'number' && Number.isInteger(rawSeed) && rawSeed >= 0
        ? rawSeed
        : undefined;

    const data = await generateMealPlan({
      people,
      style,
      unitSystem,
      locale,
      preferredProteins,
      avoidedIngredients,
      proteinScores,
      appetiteLevel,
      cuisinePreferences,
      cuisineStrength,
      country,
      measurementUnits,
      groceryStyle,
      mealStyle,
      varietyLevel,
      dietaryPreferences,
      pantryStaples,
      userPreferences,
      seed,
    });

    res.status(200).json({ success: true, data });
  } catch (err) {
    next(err);
  }
}
