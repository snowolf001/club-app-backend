/**
 * mealPlanPrompt.ts
 *
 * Builds the system prompt sent to OpenAI for weekly meal plan generation.
 */

import type { AppetiteLevel, MealPlanStyle } from '../types/mealPlan';

// ─── Types ────────────────────────────────────────────────────────────────────

export type UnitSystem = 'imperial' | 'metric';
export type MealStyle = 'Quick' | 'Balanced' | 'Comfort';
export type VarietyLevel = 'Low' | 'Medium' | 'High';

/** Where the user shops. Drives the vegetable and ingredient pool. */
export type GroceryStyle = 'regular' | 'asian' | 'mixed';

/** Where the user lives. Controls unit defaults and broad cost assumptions. */
export type Country = 'US' | 'Canada' | 'UK' | 'Australia' | 'Other';

/** Measurement unit system for the grocery list output. */
export type MeasurementUnits = 'auto' | 'imperial' | 'metric';

export interface UserPreferences {
  likedIngredients?: string[];
  dislikedIngredients?: string[];
  frequentlyReplaced?: string[];
  preferredCuisines?: string[];
}

export interface MealPlanPromptInput {
  people: number;
  style: MealPlanStyle;
  country: string;
  cuisinePreferences?: string[];
  cuisineStrength?: 'light' | 'moderate' | 'strong';
  mealStyle?: MealStyle;
  varietyLevel?: VarietyLevel;
  groceryStyle?: GroceryStyle;
  measurementUnits?: MeasurementUnits;
  preferredProteins?: string[];
  avoidedIngredients?: string[];
  userPreferences?: UserPreferences;
  dietaryPreferences?: string[];
  pantryStaples?: string[];
  /** @deprecated Use measurementUnits + country instead */
  unitSystem?: UnitSystem;
  /** @deprecated Use country instead */
  locale?: string;
  appetiteLevel?: AppetiteLevel;
  proteinSchedule?: Record<string, string>;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function resolveUnits(
  measurementUnits: MeasurementUnits | undefined,
  country: string
): 'imperial' | 'metric' {
  if (measurementUnits === 'imperial') return 'imperial';
  if (measurementUnits === 'metric') return 'metric';
  return country.toUpperCase() === 'US' ? 'imperial' : 'metric';
}

export function proteinAmountForSize(
  householdSize: number,
  units: 'imperial' | 'metric'
): string {
  if (units === 'metric') {
    if (householdSize <= 2) return '280-360 g';
    if (householdSize === 3) return '400-550 g';
    return '550-720 g';
  }
  if (householdSize <= 2) return '0.6-0.8 lb';
  if (householdSize === 3) return '0.9-1.2 lb';
  return '1.2-1.6 lb';
}

function vegRequirement(level: VarietyLevel): { label: string; min: number } {
  switch (level) {
    case 'Low':
      return { label: 'at least 4 distinct vegetables', min: 4 };
    case 'High':
      return { label: 'between 7 and 10 distinct vegetables', min: 7 };
    case 'Medium':
    default:
      return { label: 'between 5 and 7 distinct vegetables', min: 5 };
  }
}

const REGULAR_VEGS: Record<string, string> = {
  US: 'broccoli, bell pepper, zucchini, asparagus, kale, spinach, carrots, onions, mushrooms, tomatoes, green beans, potatoes, sweet potato, corn, cauliflower, celery, peas, cucumber',
  Canada:
    'broccoli, carrots, potatoes, sweet potato, cabbage, spinach, mushrooms, onions, zucchini, bell pepper, green beans, tomatoes, cauliflower, kale, peas, corn, celery, cucumber',
  UK: 'potatoes, carrots, peas, cabbage, leeks, broccoli, cauliflower, mushrooms, onions, spinach, sweet potato, tomatoes, zucchini, cucumber, parsnip, celery',
  Australia:
    'zucchini, pumpkin, sweet potato, potatoes, spinach, carrots, broccoli, mushrooms, tomatoes, green beans, capsicum, onions, cauliflower, peas, corn, kale, cucumber, celery',
  Other:
    'spinach, carrots, onions, mushrooms, tomatoes, potatoes, sweet potato, green beans, cabbage, zucchini, eggplant, cucumber, broccoli, bell pepper, cauliflower, peas, corn, celery',
};

const ASIAN_MARKET_VEGS =
  'bok choy, napa cabbage, choy sum, gai lan (Chinese broccoli), Chinese eggplant, water spinach, green beans, long beans, snow peas, bean sprouts, daikon radish, shiitake mushrooms, enoki mushrooms, king oyster mushrooms, lotus root, cucumber, tomato, potato, carrot, spinach, corn';

export function vegSelectionClause(
  groceryStyle: GroceryStyle | undefined,
  country: string
): string {
  const style = groceryStyle ?? 'regular';
  const countryKey = country in REGULAR_VEGS ? country : 'Other';
  const regularPool = REGULAR_VEGS[countryKey];

  switch (style) {
    case 'asian':
      return `Shopping location is an Asian market - use Asian-market vegetables.
  Preferred vegetables: ${ASIAN_MARKET_VEGS}
  STRICT RULES for Asian market:
  Do NOT use broccoli, bell pepper, or cauliflower as default filler vegetables.
  Broccoli + bell pepper + cauliflower combined may appear at most ONCE across the whole week.
  Use leafy greens and Asian vegetables naturally across every day.
  Do not fall back to Western supermarket staples.`;

    case 'mixed':
      return `Shopping location is a mix of regular supermarket and Asian market.
  Regular supermarket pool (${countryKey}): ${regularPool}
  Asian market pool: ${ASIAN_MARKET_VEGS}
  MIXED RULES:
  At least 40% of the distinct vegetables used each week must come from the Asian market pool.
  Do not let broccoli or bell pepper dominate the week.
  Vary vegetables across days - no single vegetable more than twice.`;

    case 'regular':
    default:
      return `Shopping location is a regular supermarket in ${countryKey}.
  Available vegetables: ${regularPool}
  Use vegetables from this list as the primary pool.
  Asian vegetables are welcome when they clearly suit the dish but should not dominate.`;
  }
}

export function cuisineAdjustmentClause(cuisine: string): string {
  const c = cuisine.toLowerCase();
  if (c.includes('mixed') || c.includes('fusion')) {
    return `- Mix cooking styles: some Western (roast, pan-sear, bake) and some Asian (stir-fry, braise, steam).
- Cuisine preference affects COOKING STYLE only - vegetables are determined by grocery style, not cuisine.`;
  }
  if (
    c.includes('chinese') ||
    c.includes('japanese') ||
    c.includes('korean') ||
    c.includes('thai') ||
    c.includes('vietnamese') ||
    c.includes('asian')
  ) {
    return `- Use mostly Asian cooking methods: stir-fry, braise, steam, simple home-style dishes.
- Minimise Western techniques (baking, grilling) unless they clearly suit the ingredient.
- Cuisine preference affects COOKING STYLE only - vegetables are determined by grocery style, not cuisine.`;
  }
  return '- Adapt cooking techniques to match the cuisine style.';
}

export function unitClause(units: 'imperial' | 'metric'): string {
  if (units === 'imperial') {
    return `Use imperial units throughout:
  Proteins: lb
  Vegetables: lb, count, bunch, or cloves where appropriate
  All grocery list amount values must use imperial units consistently.`;
  }
  return `Use metric units throughout:
  Proteins: g or kg (prefer kg when quantity >= 500 g)
  Vegetables: g, kg, count, bunch, or cloves where appropriate
  All grocery list amount values must use metric units consistently.`;
}

function userPreferencesClause(prefs: UserPreferences | undefined): string {
  if (!prefs) return '';

  const {
    likedIngredients = [],
    dislikedIngredients = [],
    frequentlyReplaced = [],
    preferredCuisines = [],
  } = prefs;

  const hasAny =
    likedIngredients.length ||
    dislikedIngredients.length ||
    frequentlyReplaced.length ||
    preferredCuisines.length;

  if (!hasAny) return '';

  const lines: string[] = [
    '────────────────────────────────────────────────',
    'USER PREFERENCE LEARNING (ADAPTIVE - CRITICAL)',
    '────────────────────────────────────────────────',
    'Apply the following hidden scoring model when selecting every ingredient and dish:',
    '  likedIngredients      => score +3 - feature naturally, reuse across the week (but not excessively)',
    '  neutral               => score  0 - no special treatment',
    '  frequentlyReplaced    => score -2 - treat as semi-disliked; avoid unless no better option exists',
    '  dislikedIngredients   => score -5 - EXCLUDE COMPLETELY from every meal and the grocery list',
    '',
    'Generate meals that maximise total ingredient score while still maintaining variety.',
  ];

  if (dislikedIngredients.length) {
    lines.push(
      '',
      `DISLIKED - never include: ${dislikedIngredients.join(', ')}`
    );
  }

  if (frequentlyReplaced.length) {
    lines.push(
      '',
      `FREQUENTLY REPLACED (semi-disliked) - avoid prominently: ${frequentlyReplaced.join(', ')}`
    );
  }

  if (likedIngredients.length) {
    lines.push(
      '',
      `LIKED - prioritize and reuse naturally: ${likedIngredients.join(', ')}`
    );
  }

  if (preferredCuisines.length) {
    lines.push(
      '',
      `PREFERRED CUISINES - bias toward these styles while still allowing some diversity: ${preferredCuisines.join(', ')}`
    );
  }

  return lines.join('\n');
}

export function dietaryClause(prefs: string[] | undefined): string {
  if (!prefs || prefs.length === 0) return '';
  const rules = prefs.map((p) => {
    switch (p) {
      case 'Vegetarian':
        return `  - VEGETARIAN (STRICT): Every meal is 100% vegetarian. No meat, poultry, fish, seafood, or meat-based broths/sauces — not even as garnish. Allowed proteins: tofu, tempeh, eggs, beans, lentils, chickpeas, edamame, paneer.`;
      case 'Dairy Free':
        return `  - DAIRY FREE (STRICT):
    Avoid ALL dairy: milk, cheese (all types), yogurt, cream, butter, ghee,
    sour cream, cream cheese, whey, casein.
    Use oil, coconut milk, or plant-based alternatives instead.
    Do NOT include any dairy in any meal or grocery item.`;
      case 'Gluten Free':
        return `  - GLUTEN FREE (STRICT):
    Avoid ALL gluten sources: wheat, barley, rye, spelt, regular pasta,
    bread, flour tortillas, regular soy sauce, regular flour, panko breadcrumbs.
    ALWAYS use tamari or coconut aminos instead of soy sauce.
    Use rice, rice noodles, quinoa, potatoes, or corn tortillas instead.
    Do NOT include any wheat-based ingredient in any meal or grocery item.`;
      case 'Low Carb':
        return `  - LOW CARB:
    Reduce or eliminate: rice, pasta, bread, flour tortillas, potatoes,
    corn, sugar-heavy sauces, sweet condiments.
    Prioritise protein and non-starchy vegetables in every meal.
    If a starch is needed, use small quantities of sweet potato or legumes only.`;
      case 'High Protein':
        return `  - HIGH PROTEIN:
    Every meal must include a substantial protein source.
    Increase protein quantities. Use lean proteins where possible.
    Prioritise protein-dense ingredients within any other active constraints.`;
      default:
        return `  - ${p}: Apply this dietary restriction strictly to all meals.`;
    }
  });
  return `DIETARY REQUIREMENTS — STRICT HARD CONSTRAINTS:\nApply every rule below to every single meal and every grocery list item.\n${rules.join('\n')}`;
}

export function pantryStaplesClause(staples: string[] | undefined): string {
  if (!staples || staples.length === 0) return '';
  return `PANTRY STAPLES - DO NOT LIST IN GROCERY LIST:
The user always has these items stocked at home: ${staples.join(', ')}
Do NOT include any of these in the groceryList under any category.
They are already available — the user does not need to buy them.`;
}

function mealStyleDescription(style: MealStyle | MealPlanStyle): string {
  const s = style as string;
  if (s === 'Quick' || s === 'quick')
    return 'Keep every meal simple with fewer steps - weeknight convenience is the priority.';
  if (s === 'Comfort')
    return 'Use richer, more traditional techniques: braises, slow simmers, and hearty flavours.';
  return 'Mix straightforward preparations with occasional more interesting techniques.';
}

// ─── Prompt builder ───────────────────────────────────────────────────────────

export function buildMealPlanPrompt(input: MealPlanPromptInput): string {
  const {
    people,
    style,
    country: rawCountry,
    cuisinePreferences = [],
    cuisineStrength = 'moderate',
    mealStyle = 'Balanced',
    varietyLevel = 'Medium',
    groceryStyle,
    measurementUnits,
    preferredProteins = [],
    avoidedIngredients = [],
    userPreferences,
    dietaryPreferences,
    pantryStaples,
    unitSystem,
    locale,
    appetiteLevel = 'normal',
    proteinSchedule,
  } = input;

  const country = rawCountry || locale || 'US';

  const resolvedUnits = measurementUnits
    ? resolveUnits(measurementUnits, country)
    : (unitSystem ?? 'imperial');

  const peopleLabel = people === 1 ? 'person' : 'people';
  const proteinAmount = proteinAmountForSize(people, resolvedUnits);
  const vegReq = vegRequirement(varietyLevel);
  const vegSelection = vegSelectionClause(groceryStyle, country);
  const userPrefSection = userPreferencesClause(userPreferences);
  const dietarySection = dietaryClause(dietaryPreferences);
  const pantrySection = pantryStaplesClause(pantryStaples);

  const cuisineDisplay =
    cuisinePreferences.length > 0
      ? cuisinePreferences.join(', ')
      : 'home cooking';

  const allAvoided = [
    ...avoidedIngredients,
    ...(userPreferences?.dislikedIngredients ?? []),
  ].filter((v, i, arr) => arr.indexOf(v) === i);

  const avoidClause =
    allAvoided.length > 0
      ? `NEVER include these ingredients in any meal or grocery item: ${allAvoided.join(', ')}.`
      : '';

  const isVegetarianActive = (dietaryPreferences ?? []).includes('Vegetarian');

  const vegetarianProteinNote = isVegetarianActive
    ? `⛔ VEGETARIAN HARD CONSTRAINT: All proteins must be 100% plant-based.\n` +
      `If any protein listed below is non-vegetarian, replace it with tofu, tempeh, eggs, beans, chickpeas, or lentils.\n\n`
    : '';

  const baseProteinGuide = proteinSchedule
    ? `PROTEIN ASSIGNMENT FOR THIS WEEK - MANDATORY, DO NOT CHANGE:\n${Object.entries(
        proteinSchedule
      )
        .map(([day, protein]) => `  ${day}: ${protein}`)
        .join(
          '\n'
        )}\n\nFor each day you MUST use EXACTLY the protein listed above.\nEach day's main.protein field MUST match this assignment exactly.\nDo NOT substitute, swap, or change any protein for any day, under any circumstances.`
    : preferredProteins.length > 0 && !isVegetarianActive
      ? `Prioritize these proteins: ${preferredProteins.join(', ')}.`
      : isVegetarianActive
        ? `This plan is VEGETARIAN. Use ONLY plant-based proteins: tofu, tempeh, eggs, beans, chickpeas, lentils, edamame, paneer.${
            preferredProteins.length > 0
              ? ` Preferred plant-based proteins: ${preferredProteins.join(', ')}.`
              : ' Choose 2-3 of these.'
          } NO MEAT OR SEAFOOD under any circumstances.`
        : 'Choose 2-3 practical proteins appropriate for the cuisine (e.g. chicken, beef, pork, tofu, or shrimp).';

  const proteinGuide = vegetarianProteinNote + baseProteinGuide;

  const cuisineGuide =
    cuisinePreferences.length > 0
      ? `Cuisine influence (${cuisineStrength}): incorporate ${cuisinePreferences.join(', ')}-inspired meals. ` +
        (cuisineStrength === 'light'
          ? 'At most 1 meal out of 7 should reflect these cuisines.'
          : cuisineStrength === 'strong'
            ? 'At least 3-4 meals should clearly reflect these cuisines.'
            : 'Include 2-3 meals inspired by these cuisines; the rest remain familiar.')
      : '';

  const cuisineAdjustment =
    cuisinePreferences.length > 0
      ? cuisineAdjustmentClause(cuisinePreferences.join(', '))
      : '- Adapt cooking techniques to match the local home cooking style.';

  const appetiteMap: Record<string, string> = {
    light: `light appetite - SCALE DOWN all quantities by ~20%.`,
    normal: `normal appetite - standard portions: proteins ${proteinAmount} per meal.`,
    heavy: `heavy appetite - SCALE UP all quantities by ~20%.`,
  };
  const portionGuide = appetiteMap[appetiteLevel] ?? appetiteMap['normal'];

  return `
You are DinnerReady, a practical weekly dinner planning assistant.

Return VALID JSON only.
Do not use markdown.
Do not add explanations.
Do not use code fences.

====================
USER SETTINGS
====================
People: ${people}
Style: ${style}
Country: ${country}
Cuisine: ${cuisineDisplay}
Grocery shopping: ${groceryStyle ?? 'regular'} market
Units: ${resolvedUnits}
${avoidClause ? avoidClause + '\n' : ''}${dietarySection ? dietarySection + '\n' : ''}${cuisineGuide}

====================
MEAL RULES
====================
Generate dinner for exactly: Mon, Tue, Wed, Thu, Fri, Sat, Sun
${mealStyleDescription(mealStyle)}

PROTEIN:
${proteinGuide}

PRODUCE: Choose 3-4 core produce items to reuse across the week.

- No more than 3 proteins total. No rare ingredients.
- Meals common in ${country}, under 30 min.
- Each day's "main" fields ONLY: name, servings=${people}, protein, ingredients [{name, quantity, unit}].
- steps array at top level of day. No extra fields.

====================
INGREDIENT FORMAT (VERY IMPORTANT)
====================
Every ingredient MUST use this exact format:
  {"name": "Chicken Breast", "quantity": 1, "unit": "lb"}
  {"name": "Bell Pepper", "quantity": 2, "unit": "count"}
  {"name": "Olive Oil", "quantity": 1, "unit": "tbsp"}

Rules:
- "quantity" is ALWAYS a number (never a string, never a range)
- "unit" is ALWAYS a string from: lb, oz, cup, tbsp, tsp, count, can, clove
- 10 ingredients or fewer per meal
- Small-quantity items (olive oil, salt, spices) MUST still have a real quantity

====================
PORTION SIZING - scale all quantities to ${people} ${peopleLabel}
====================
Appetite level: ${portionGuide}
Protein per meal: ${proteinAmount}
${people >= 3 ? `With ${people} people, every meal MUST include at least 2 dishes.` : ''}
Countable vegetables: ~0.5-1 per meal for every 2 people
servings for every main MUST equal ${people}.

====================
VEGETABLES
====================
Use ${vegReq.label} across the week. No vegetable more than 2× total. No same veg on back-to-back days.
Include leafy greens, root vegetables, and others.
${vegSelection}

====================
UNIT RULES
====================
${unitClause(resolvedUnits)}

Meal ingredients may use cooking measurement units: lb, oz, cup, tbsp, tsp, count, can, clove
GroceryList amounts must use shopping purchase units ONLY.

====================
GROCERY LIST RULES
====================
Use EXACTLY these grocery categories:
- "Produce 🥬"
- "Meat & Seafood 🥩"
- "Dairy & Eggs 🥚"
- "Pantry & Grains 🍞"
- "Frozen 🧊"

Each grocery item MUST include ONLY: name, amount, usedIn
usedIn must be an array of day abbreviations.
Combine duplicates: never list same ingredient twice.
Pantry staples go under "Pantry & Grains 🍞".
${pantrySection ? pantrySection + '\n' : ''}
Shop once per week — combine duplicates into one realistic weekly amount.
Meat: lb or oz. Leafy greens: oz or bag. Veg by weight: lb. Countable veg: count.
Never use "cup" in grocery amounts. Rice/pasta: "1 bag". Sauces: "1 bottle".
Raw ingredient names only (e.g. "Rice" not "Cooked Rice"). Max 15 items total.
${userPrefSection ? '\n' + userPrefSection : ''}

====================
COOKING STEPS
====================
Each day: 2-3 concise steps. Use prefixes: "Prep: ...", "Cook: ..." (include time/temp), "Finish: ..."

====================
REQUIRED JSON FORMAT
====================
{
  "days": [
    {
      "day": "Mon",
      "main": {
        "name": "Garlic Chicken Stir-Fry",
        "servings": ${people},
        "protein": "chicken",
        "ingredients": [
          { "name": "Chicken Breast", "quantity": 0.7, "unit": "lb" },
          { "name": "Bok Choy", "quantity": 2, "unit": "count" },
          { "name": "Garlic", "quantity": 3, "unit": "clove" }
        ]
      },
      "steps": [
        "Prep: Mince garlic and cut bok choy.",
        "Cook: Stir-fry chicken over high heat 4-5 min. Add garlic and bok choy, cook 2 min.",
        "Finish: Season with soy sauce and serve over rice."
      ]
    }
  ],
  "groceryList": {
    "Produce 🥬": [{ "name": "Bok Choy", "amount": "4 count", "usedIn": ["Mon", "Wed"] }],
    "Meat & Seafood 🥩": [{ "name": "Chicken Breast", "amount": "1.4 lbs", "usedIn": ["Mon", "Thu"] }],
    "Dairy & Eggs 🥚": [],
    "Pantry & Grains 🍞": [{ "name": "Soy Sauce", "amount": "1 bottle", "usedIn": ["Mon", "Wed"] }],
    "Frozen 🧊": []
  },
  "meta": {
    "style": "${style}",
    "people": ${people},
    "coreProteins": ["chicken", "tofu"],
    "coreProduce": ["bok choy", "carrot", "onion"],
    "totalUniqueIngredients": 12,
    "estimatedCost": "medium",
    "notes": []
  }
}
`;
}
