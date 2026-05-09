import OpenAI from 'openai';
import { buildMealPlanPrompt } from '../prompts/mealPlanPrompt';
import type { MealPlanStyle, WeeklyMealPlan } from '../types/mealPlan';
import { safeJsonParse } from '../utils/jsonUtils';
import {
  resolveMealPreferences,
  type ProteinScores,
} from '../utils/mealPreferences';

const REQUIRED_DAYS = [
  'Mon',
  'Tue',
  'Wed',
  'Thu',
  'Fri',
  'Sat',
  'Sun',
] as const;

const REQUIRED_GROCERY_KEYS = [
  'Produce 🥬',
  'Meat & Seafood 🥩',
  'Dairy & Eggs 🥚',
  'Pantry & Grains 🍞',
  'Frozen 🧊',
] as const;

const OPENAI_TIMEOUT_MS = 120_000;

// ─── Seeded PRNG ──────────────────────────────────────────────────────────────

function seededRng(seed: number): () => number {
  let s = seed >>> 0;
  return function () {
    s += 0x6d2b79f5;
    let z = s;
    z = Math.imul(z ^ (z >>> 15), z | 1);
    z ^= z + Math.imul(z ^ (z >>> 7), z | 61);
    return ((z ^ (z >>> 14)) >>> 0) / 0x100000000;
  };
}

// ─── Weighted protein pools ───────────────────────────────────────────────────

type WeightedProtein = { name: string; weight: number };

const BASE_PROTEIN_POOLS: Record<MealPlanStyle, WeightedProtein[]> = {
  balanced: [
    { name: 'chicken', weight: 10 },
    { name: 'beef', weight: 8 },
    { name: 'pork', weight: 7 },
    { name: 'fish', weight: 7 },
    { name: 'tofu', weight: 5 },
    { name: 'shrimp', weight: 5 },
    { name: 'turkey', weight: 4 },
    { name: 'eggs', weight: 3 },
    { name: 'lamb', weight: 3 },
  ],
  healthy: [
    { name: 'chicken breast', weight: 10 },
    { name: 'fish', weight: 9 },
    { name: 'tofu', weight: 8 },
    { name: 'turkey', weight: 7 },
    { name: 'eggs', weight: 6 },
    { name: 'lentils', weight: 5 },
    { name: 'chickpeas', weight: 4 },
    { name: 'shrimp', weight: 4 },
    { name: 'tempeh', weight: 3 },
  ],
  quick: [
    { name: 'chicken', weight: 9 },
    { name: 'shrimp', weight: 9 },
    { name: 'eggs', weight: 8 },
    { name: 'tofu', weight: 7 },
    { name: 'fish', weight: 6 },
    { name: 'ground beef', weight: 5 },
    { name: 'pork', weight: 5 },
    { name: 'beef strips', weight: 4 },
  ],
  budget: [
    { name: 'chicken thighs', weight: 10 },
    { name: 'eggs', weight: 10 },
    { name: 'ground beef', weight: 9 },
    { name: 'lentils', weight: 8 },
    { name: 'pork', weight: 7 },
    { name: 'beans', weight: 6 },
    { name: 'chicken', weight: 5 },
  ],
};

const ASIAN_WEIGHT_ADJUSTMENTS: Record<string, number> = {
  pork: 4,
  tofu: 5,
  fish: 4,
  shrimp: 3,
  beef: -3,
  turkey: -5,
};

const ASIAN_EXTRA_PROTEINS: WeightedProtein[] = [
  { name: 'ground pork', weight: 7 },
  { name: 'pork belly', weight: 5 },
];

function countryWeightAdjustments(country: string): Record<string, number> {
  const c = country.toUpperCase();
  if (c === 'US' || c === 'CANADA') return { beef: 2, chicken: 1 };
  if (c === 'UK') return { lamb: 4, chicken: 1, beef: 1 };
  if (c === 'AUSTRALIA') return { lamb: 5, chicken: 1, beef: 2 };
  return {};
}

function countryExtraProteins(country: string): WeightedProtein[] {
  const c = country.toUpperCase();
  if (c === 'UK' || c === 'AUSTRALIA') return [{ name: 'lamb', weight: 4 }];
  return [];
}

function buildDefaultProteinPool(
  style: MealPlanStyle,
  country: string,
  groceryStyle: string | undefined
): WeightedProtein[] {
  const merged = new Map<string, WeightedProtein>(
    (BASE_PROTEIN_POOLS[style] ?? BASE_PROTEIN_POOLS.balanced).map((p) => [
      p.name.toLowerCase(),
      { ...p },
    ])
  );

  const adjustmentSets: Record<string, number>[] = [
    countryWeightAdjustments(country),
  ];
  const extras: WeightedProtein[] = [...countryExtraProteins(country)];

  if (groceryStyle === 'asian' || groceryStyle === 'mixed') {
    adjustmentSets.push(ASIAN_WEIGHT_ADJUSTMENTS);
    extras.push(...ASIAN_EXTRA_PROTEINS);
  }

  for (const adj of adjustmentSets) {
    for (const [name, delta] of Object.entries(adj)) {
      const entry = merged.get(name.toLowerCase());
      if (entry) entry.weight = Math.max(0, entry.weight + delta);
    }
  }

  for (const extra of extras) {
    const key = extra.name.toLowerCase();
    if (!merged.has(key)) merged.set(key, { ...extra });
  }

  return Array.from(merged.values()).filter((p) => p.weight > 0);
}

function weightedPickUnique(
  pool: WeightedProtein[],
  n: number,
  rng: () => number
): string[] {
  if (pool.length === 0) return [];
  if (pool.length <= n) return pool.map((p) => p.name);

  const result: string[] = [];
  const remaining = pool.map((p) => ({ ...p }));

  while (result.length < n && remaining.length > 0) {
    const total = remaining.reduce((sum, p) => sum + p.weight, 0);
    let r = rng() * total;
    let selectedIdx = remaining.length - 1;
    for (let i = 0; i < remaining.length; i++) {
      r -= remaining[i].weight;
      if (r < 0) {
        selectedIdx = i;
        break;
      }
    }
    result.push(remaining[selectedIdx].name);
    remaining.splice(selectedIdx, 1);
  }

  return result;
}

function shuffleArray<T>(arr: T[], rng: () => number): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

const VEGETARIAN_PROTEIN_POOL: WeightedProtein[] = [
  { name: 'tofu', weight: 10 },
  { name: 'eggs', weight: 9 },
  { name: 'beans', weight: 8 },
  { name: 'chickpeas', weight: 7 },
  { name: 'lentils', weight: 6 },
  { name: 'mushrooms', weight: 5 },
  { name: 'tempeh', weight: 4 },
  { name: 'paneer', weight: 3 },
];

function buildProteinSchedule(
  preferredProteins: string[],
  style: MealPlanStyle,
  country: string,
  groceryStyle: string | undefined,
  seed?: number,
  vegetarian?: boolean
): Record<string, string> {
  const rng = seededRng(seed ?? Math.floor(Math.random() * 0x100000000));
  const preferred = preferredProteins.map((p) => p.trim()).filter(Boolean);

  const effectivePool: WeightedProtein[] = vegetarian
    ? VEGETARIAN_PROTEIN_POOL
    : buildDefaultProteinPool(style, country, groceryStyle);

  let coreProteins: string[];

  if (preferred.length >= 3) {
    coreProteins = weightedPickUnique(
      preferred.map((name) => ({ name, weight: 1 })),
      3,
      rng
    );
  } else if (preferred.length > 0) {
    const preferredLower = new Set(preferred.map((p) => p.toLowerCase()));
    const filteredPool = effectivePool.filter(
      (p) => !preferredLower.has(p.name.toLowerCase())
    );
    const fillers = weightedPickUnique(filteredPool, 3 - preferred.length, rng);
    coreProteins = [...preferred, ...fillers];
  } else {
    coreProteins = weightedPickUnique(effectivePool, 3, rng);
  }

  shuffleArray(coreProteins, rng);

  const [a, b, c] = coreProteins;
  return { Mon: a, Tue: b, Wed: c, Thu: a, Fri: b, Sat: c, Sun: a };
}

// ─── Vegetarian validation ─────────────────────────────────────────────────

const NON_VEGETARIAN_PROTEINS_SET = new Set([
  'chicken',
  'chicken breast',
  'chicken thighs',
  'chicken strips',
  'beef',
  'ground beef',
  'beef strips',
  'steak',
  'pork',
  'pork belly',
  'ground pork',
  'turkey',
  'fish',
  'salmon',
  'tuna',
  'cod',
  'tilapia',
  'halibut',
  'trout',
  'bass',
  'shrimp',
  'prawn',
  'seafood',
  'crab',
  'lobster',
  'scallop',
  'lamb',
  'duck',
  'bacon',
  'sausage',
  'ham',
]);

const NON_VEGETARIAN_INGREDIENTS = [
  'chicken',
  'beef',
  'pork',
  'lamb',
  'turkey',
  'duck',
  'rabbit',
  'venison',
  'fish',
  'salmon',
  'tuna',
  'cod',
  'tilapia',
  'halibut',
  'bass',
  'trout',
  'shrimp',
  'prawn',
  'crab',
  'lobster',
  'scallop',
  'mussel',
  'clam',
  'squid',
  'octopus',
  'bacon',
  'sausage',
  'ham',
  'pepperoni',
  'salami',
  'chorizo',
  'lard',
  'suet',
  'gelatin',
  'anchovies',
  'anchovy',
  'fish sauce',
  'oyster sauce',
  'worcestershire',
  'meat broth',
  'chicken broth',
  'beef broth',
  'bone broth',
  'chicken stock',
  'beef stock',
];

function findVegetarianViolation(plan: WeeklyMealPlan): string | null {
  const check = (text: string): string | null => {
    const lower = text.toLowerCase();
    for (const kw of NON_VEGETARIAN_INGREDIENTS) {
      if (lower.includes(kw)) return text;
    }
    return null;
  };

  for (const day of plan.days) {
    const proteinHit = check(day.main.protein);
    if (proteinHit) return `day ${day.day} protein: ${proteinHit}`;

    for (const ing of day.main.ingredients) {
      const ingHit = check(ing.name);
      if (ingHit) return `day ${day.day} ingredient: ${ingHit}`;
    }

    const nameHit = check(day.main.name);
    if (nameHit) return `day ${day.day} meal name: ${nameHit}`;

    for (const step of day.steps) {
      const stepHit = check(step);
      if (stepHit) return `day ${day.day} step: ${stepHit}`;
    }
  }

  for (const items of Object.values(plan.groceryList)) {
    for (const item of items as Array<{ name: string }>) {
      const groceryHit = check(item.name);
      if (groceryHit) return `grocery item: ${groceryHit}`;
    }
  }

  return null;
}

function validateMealPlan(plan: unknown): plan is WeeklyMealPlan {
  if (!plan || typeof plan !== 'object') return false;

  const p = plan as Record<string, unknown>;

  if (!Array.isArray(p.days) || p.days.length !== 7) return false;

  const dayNames = (p.days as Array<Record<string, unknown>>).map((d) => d.day);
  for (const required of REQUIRED_DAYS) {
    if (!dayNames.includes(required)) return false;
  }

  for (const day of p.days as Array<Record<string, unknown>>) {
    const main = day.main as Record<string, unknown> | undefined;
    if (!main || typeof main !== 'object') return false;
    if (typeof main.name !== 'string' || !main.name) return false;
    if (!Array.isArray(main.ingredients)) return false;
    if (!Array.isArray(day.steps)) return false;
  }

  if (!p.groceryList || typeof p.groceryList !== 'object') return false;

  const gl = p.groceryList as Record<string, unknown>;
  for (const key of REQUIRED_GROCERY_KEYS) {
    if (!Array.isArray(gl[key])) return false;
  }

  return true;
}

export async function generateMealPlan(params: {
  people: number;
  style: MealPlanStyle;
  unitSystem: 'imperial' | 'metric';
  locale: string;
  preferredProteins?: string[];
  avoidedIngredients?: string[];
  proteinScores?: ProteinScores;
  appetiteLevel?: 'light' | 'normal' | 'heavy';
  cuisinePreferences?: string[];
  cuisineStrength?: 'light' | 'moderate' | 'strong';
  country?: string;
  measurementUnits?: 'auto' | 'imperial' | 'metric';
  groceryStyle?: 'regular' | 'asian' | 'mixed';
  mealStyle?: 'Quick' | 'Balanced' | 'Comfort';
  varietyLevel?: 'Low' | 'Medium' | 'High';
  dietaryPreferences?: string[];
  pantryStaples?: string[];
  userPreferences?: {
    likedIngredients?: string[];
    dislikedIngredients?: string[];
    frequentlyReplaced?: string[];
    preferredCuisines?: string[];
  };
  seed?: number;
}): Promise<WeeklyMealPlan> {
  const {
    people,
    style,
    unitSystem,
    locale,
    preferredProteins = [],
    avoidedIngredients = [],
    proteinScores = {},
    appetiteLevel = 'normal',
    cuisinePreferences = [],
    cuisineStrength = 'moderate',
    country,
    measurementUnits,
    groceryStyle,
    mealStyle,
    varietyLevel,
    dietaryPreferences,
    pantryStaples,
    userPreferences,
    seed,
  } = params;

  const isVegetarian = (dietaryPreferences ?? []).includes('Vegetarian');

  let effectivePreferredProteins = preferredProteins;
  if (isVegetarian && preferredProteins.length > 0) {
    const removed = preferredProteins.filter((p) =>
      NON_VEGETARIAN_PROTEINS_SET.has(p.toLowerCase())
    );
    if (removed.length > 0) {
      console.warn(
        '[DinnerReady] Sanitized non-vegetarian preferred proteins because Vegetarian is selected',
        { removed }
      );
      effectivePreferredProteins = preferredProteins.filter(
        (p) => !NON_VEGETARIAN_PROTEINS_SET.has(p.toLowerCase())
      );
    }
  }

  const resolved = resolveMealPreferences(
    { preferredProteins: effectivePreferredProteins, avoidedIngredients },
    proteinScores
  );

  const resolvedCountry = country || locale || 'US';

  const proteinSchedule = buildProteinSchedule(
    resolved.preferredProteins,
    style,
    resolvedCountry,
    groceryStyle,
    seed,
    isVegetarian
  );

  const model = process.env.OPENAI_MODEL ?? 'gpt-4o-mini';

  const generationStart = Date.now();
  console.log('[DinnerReady] generateMealPlan start', {
    people,
    style,
    mealStyle: mealStyle ?? '(default: Balanced)',
    country: country ?? `(default from locale: ${locale})`,
    groceryStyle: groceryStyle ?? '(default: regular)',
    measurementUnits: measurementUnits ?? '(default: auto)',
    cuisinePreferences,
    cuisineStrength,
    avoidedIngredients,
    preferredProteins,
    dietaryPreferences: dietaryPreferences ?? [],
    pantryStaples: pantryStaples ?? [],
    isVegetarian,
    effectivePreferredProteins: resolved.preferredProteins,
    resolvedAvoidedIngredients: resolved.avoidedIngredients,
    varietyLevel: varietyLevel ?? '(default: Medium)',
    seed: seed ?? '(none — fresh random)',
    proteinSchedule,
    model,
    hasApiKey: Boolean(process.env.OPENAI_API_KEY),
  });

  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is missing');
  }

  const client = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    timeout: OPENAI_TIMEOUT_MS,
    maxRetries: 1,
  });

  const prompt = buildMealPlanPrompt({
    people,
    style,
    unitSystem,
    locale,
    preferredProteins: resolved.preferredProteins,
    avoidedIngredients: resolved.avoidedIngredients,
    appetiteLevel,
    cuisinePreferences,
    cuisineStrength,
    proteinSchedule,
    country: country || locale,
    measurementUnits,
    groceryStyle,
    mealStyle,
    varietyLevel,
    dietaryPreferences,
    pantryStaples,
    userPreferences,
  });

  const callOpenAI = async () => {
    const res = await client.chat.completions.create({
      model,
      messages: [
        {
          role: 'system',
          content:
            'You are DinnerReady, a meal planning assistant. You always return valid JSON only — no markdown, no explanations, no code fences.',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
    });
    return res;
  };

  console.log('[DinnerReady] generateMealPlan calling OpenAI...', {
    promptLength: prompt.length,
    timeoutMs: OPENAI_TIMEOUT_MS,
  });

  const openaiStart = Date.now();
  let response;

  try {
    response = await callOpenAI();
  } catch (error) {
    const openaiDurationMs = Date.now() - openaiStart;
    console.error(
      '[DinnerReady] generateMealPlan OpenAI request failed',
      { openaiDurationMs },
      error
    );
    throw error;
  }

  const openaiDurationMs = Date.now() - openaiStart;
  console.log('[DinnerReady] generateMealPlan OpenAI returned', {
    openaiDurationMs,
    choices: response.choices.length,
    finishReason: response.choices[0]?.finish_reason,
  });

  const raw = response.choices[0]?.message?.content ?? '';

  if (!raw.trim()) {
    throw new Error('OpenAI returned empty content');
  }

  const parsed = safeJsonParse<WeeklyMealPlan>(raw);

  if (!parsed) {
    console.error('[DinnerReady] generateMealPlan JSON parse returned null. Raw response:', raw);
    throw new Error('Failed to parse meal plan JSON from OpenAI response.');
  }

  if (!validateMealPlan(parsed)) {
    console.error(
      '[DinnerReady] generateMealPlan validation failed',
      JSON.stringify(parsed, null, 2)
    );
    throw new Error(
      'OpenAI response did not pass validation: missing required days or grocery categories.'
    );
  }

  // Server-side protein distribution check
  const proteinCounts: Record<string, number> = {};
  for (const day of parsed.days) {
    const p = (day.main.protein ?? '').toLowerCase();
    proteinCounts[p] = (proteinCounts[p] ?? 0) + 1;
  }
  const violatingProteins = Object.entries(proteinCounts).filter(
    ([, count]) => count > 3
  );
  if (violatingProteins.length > 0) {
    console.warn(
      '[DinnerReady] protein distribution violation detected — correcting plan',
      { proteinCounts, proteinSchedule }
    );
    for (const day of parsed.days) {
      const intendedProtein = proteinSchedule[day.day];
      if (
        intendedProtein &&
        day.main.protein.toLowerCase() !== intendedProtein.toLowerCase()
      ) {
        console.warn(
          `[DinnerReady] correcting ${day.day}: was "${day.main.protein}", setting to "${intendedProtein}"`
        );
        day.main.protein = intendedProtein;
      }
    }
  }

  console.log('[DinnerReady] protein distribution', proteinCounts);

  // ─── Vegetarian validation ─────────────────────────────────────────────────
  if (dietaryPreferences?.includes('Vegetarian')) {
    const violation = findVegetarianViolation(parsed);
    if (violation) {
      console.error(
        '[DinnerReady] Vegetarian constraint violated in generated plan',
        { violation }
      );
      throw new Error(
        `Vegetarian constraint violated in generated meal plan: ${violation}`
      );
    }
  }

  const totalDurationMs = Date.now() - generationStart;
  console.log('[DinnerReady] generateMealPlan complete', {
    totalDurationMs,
    openaiDurationMs,
  });

  return parsed;
}
