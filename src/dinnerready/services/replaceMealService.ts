import OpenAI from 'openai';
import {
  buildReplaceMealPrompt,
  type BuildReplaceMealPromptParams,
  type ReplaceMealContext,
} from '../prompts/replaceMealPrompt';
import { safeJsonParse } from '../utils/jsonUtils';
import {
  resolveMealPreferences,
  type ProteinScores,
} from '../utils/mealPreferences';

const OPENAI_TIMEOUT_MS = 90_000;

const REQUIRED_GROCERY_KEYS = [
  'Produce 🥬',
  'Meat & Seafood 🥩',
  'Dairy & Eggs 🥚',
  'Pantry & Grains 🍞',
  'Frozen 🧊',
] as const;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ReplacedMealIngredient {
  name: string;
  quantity: number;
  unit: string;
}

export interface ReplacedMealMain {
  name: string;
  servings: number;
  protein: string;
  ingredients: ReplacedMealIngredient[];
}

export interface ReplacedMealSide {
  name: string;
  optional: boolean;
}

export interface ReplacedMealDay {
  day: string;
  main: ReplacedMealMain;
  side?: ReplacedMealSide;
  steps: string[];
}

export type GroceryItem = {
  name: string;
  amount: string;
  usedIn: string[];
};

export type GroceryList = {
  'Produce 🥬': GroceryItem[];
  'Meat & Seafood 🥩': GroceryItem[];
  'Dairy & Eggs 🥚': GroceryItem[];
  'Pantry & Grains 🍞': GroceryItem[];
  'Frozen 🧊': GroceryItem[];
};

export interface ReplaceMealMeta {
  mealStyle: string;
  people: number;
  coreProteins: string[];
  coreProduce: string[];
  totalUniqueIngredients: number;
  estimatedCost: string;
  notes: string[];
}

export interface ReplaceMealResult {
  day: ReplacedMealDay;
  groceryList: GroceryList;
  meta: ReplaceMealMeta;
}

interface RawReplaceResponse {
  newDay?: unknown;
  groceryList?: unknown;
  meta?: unknown;
}

// ─── Validation ───────────────────────────────────────────────────────────────

function isValidNewDay(v: unknown): v is ReplacedMealDay {
  if (!v || typeof v !== 'object') return false;
  const d = v as Record<string, unknown>;
  if (typeof d.day !== 'string') return false;
  const main = d.main as Record<string, unknown> | undefined;
  if (!main || typeof main !== 'object') return false;
  if (typeof main.name !== 'string' || !main.name) return false;
  if (!Array.isArray(main.ingredients)) return false;
  if (!Array.isArray(d.steps)) return false;
  return true;
}

function isValidGroceryList(v: unknown): v is GroceryList {
  if (!v || typeof v !== 'object') return false;
  const gl = v as Record<string, unknown>;
  return REQUIRED_GROCERY_KEYS.every((k) => Array.isArray(gl[k]));
}

// ─── Service ──────────────────────────────────────────────────────────────────

export interface ReplaceMealParams extends Omit<BuildReplaceMealPromptParams, never> {
  day: string;
  originalMeal: ReplaceMealContext;
  otherMeals: ReplaceMealContext[];
  people: number;
  mealStyle: string;
  locale: string;
  preferredProteins?: string[];
  avoidedIngredients?: string[];
  proteinScores?: ProteinScores;
  cuisinePreferences?: string[];
  cuisineStrength?: 'light' | 'moderate' | 'strong';
  country?: string;
  groceryStyle?: 'regular' | 'asian' | 'mixed';
  measurementUnits?: 'auto' | 'imperial' | 'metric';
  dietaryPreferences?: string[];
  pantryStaples?: string[];
}

export async function replaceMeal(
  params: ReplaceMealParams
): Promise<ReplaceMealResult> {
  const {
    preferredProteins = [],
    avoidedIngredients = [],
    proteinScores = {},
    cuisinePreferences = [],
    cuisineStrength = 'moderate',
    ...rest
  } = params;

  const resolved = resolveMealPreferences(
    { preferredProteins, avoidedIngredients },
    proteinScores
  );

  const model = process.env.OPENAI_MODEL ?? 'gpt-4o-mini';

  console.log('[DinnerReady] replaceMeal start', {
    day: params.day,
    originalDish: params.originalMeal.dishName,
    preferredProteins: resolved.preferredProteins,
    avoidedIngredients: resolved.avoidedIngredients,
    cuisinePreferences,
    cuisineStrength,
    model,
  });

  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is missing');
  }

  const client = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    timeout: OPENAI_TIMEOUT_MS,
    maxRetries: 1,
  });

  const prompt = buildReplaceMealPrompt({
    ...rest,
    preferredProteins: resolved.preferredProteins,
    avoidedIngredients: resolved.avoidedIngredients,
    cuisinePreferences,
    cuisineStrength,
  });

  console.log('[DinnerReady] replaceMeal calling OpenAI...', {
    promptLength: prompt.length,
    timeoutMs: OPENAI_TIMEOUT_MS,
  });

  const openaiStart = Date.now();
  let response;
  try {
    response = await client.chat.completions.create({
      model,
      messages: [
        {
          role: 'system',
          content:
            'You are DinnerReady, a meal planning assistant. You always return valid JSON only — no markdown, no explanations, no code fences.',
        },
        { role: 'user', content: prompt },
      ],
    });
  } catch (error) {
    const openaiDurationMs = Date.now() - openaiStart;
    console.error(
      '[DinnerReady] replaceMeal OpenAI request failed',
      { openaiDurationMs },
      error
    );
    throw error;
  }

  const openaiDurationMs = Date.now() - openaiStart;
  console.log('[DinnerReady] replaceMeal OpenAI returned', {
    openaiDurationMs,
    choices: response.choices.length,
    finishReason: response.choices[0]?.finish_reason,
  });

  const raw = response.choices[0]?.message?.content ?? '';
  if (!raw.trim()) {
    throw new Error('OpenAI returned empty content');
  }

  const parsed = safeJsonParse<RawReplaceResponse>(raw);

  if (!parsed) {
    console.error('[DinnerReady] replaceMeal JSON parse failed. Raw:', raw);
    throw new Error('Failed to parse replace-meal JSON from OpenAI response.');
  }

  const newDayRaw = parsed.newDay;
  if (!isValidNewDay(newDayRaw)) {
    console.error(
      '[DinnerReady] replaceMeal newDay validation failed',
      JSON.stringify(newDayRaw)
    );
    throw new Error('OpenAI response is missing a valid newDay object.');
  }

  const groceryListRaw = parsed.groceryList;
  if (!isValidGroceryList(groceryListRaw)) {
    console.warn(
      '[DinnerReady] replaceMeal groceryList missing or invalid — client will use existing list'
    );
  }

  const groceryList = isValidGroceryList(groceryListRaw)
    ? groceryListRaw
    : {
        'Produce 🥬': [],
        'Meat & Seafood 🥩': [],
        'Dairy & Eggs 🥚': [],
        'Pantry & Grains 🍞': [],
        'Frozen 🧊': [],
      };

  const metaRaw = (parsed.meta ?? {}) as Partial<ReplaceMealMeta>;
  const meta: ReplaceMealMeta = {
    mealStyle: metaRaw.mealStyle ?? params.mealStyle,
    people: metaRaw.people ?? params.people,
    coreProteins: metaRaw.coreProteins ?? [],
    coreProduce: metaRaw.coreProduce ?? [],
    totalUniqueIngredients: metaRaw.totalUniqueIngredients ?? 0,
    estimatedCost: metaRaw.estimatedCost ?? 'medium',
    notes: metaRaw.notes ?? [],
  };

  console.log('[DinnerReady] replaceMeal success', {
    newDishName: (newDayRaw as ReplacedMealDay).main?.name,
    groceryItemCount: Object.values(groceryList).flat().length,
  });

  return { day: newDayRaw, groceryList, meta };
}
