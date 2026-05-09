/**
 * replaceMealPrompt.ts
 *
 * Builds the prompt for replacing ONE meal in an existing weekly plan and
 * recomputing the grocery list for the entire updated week.
 */

import {
  type GroceryStyle,
  type MeasurementUnits,
  resolveUnits,
  vegSelectionClause,
  unitClause,
  cuisineAdjustmentClause,
  dietaryClause,
  pantryStaplesClause,
} from './mealPlanPrompt';

export interface ReplaceMealIngredient {
  name: string;
  quantity: number;
  unit: string;
}

export interface ReplaceMealContext {
  day: string;
  dishName: string;
  protein?: string;
  ingredients?: ReplaceMealIngredient[];
}

export interface BuildReplaceMealPromptParams {
  day: string;
  originalMeal: ReplaceMealContext;
  otherMeals: ReplaceMealContext[];
  people: number;
  mealStyle: string;
  locale: string;
  preferredProteins?: string[];
  avoidedIngredients?: string[];
  cuisinePreferences?: string[];
  cuisineStrength?: 'light' | 'moderate' | 'strong';
  country?: string;
  groceryStyle?: GroceryStyle;
  measurementUnits?: MeasurementUnits;
  dietaryPreferences?: string[];
  pantryStaples?: string[];
}

export function buildReplaceMealPrompt(
  params: BuildReplaceMealPromptParams
): string {
  const {
    day,
    originalMeal,
    otherMeals,
    people,
    mealStyle,
    locale,
    preferredProteins = [],
    avoidedIngredients = [],
    cuisinePreferences = [],
    cuisineStrength = 'moderate',
    country: rawCountry,
    groceryStyle,
    measurementUnits,
    dietaryPreferences,
    pantryStaples,
  } = params;

  const country = rawCountry || locale || 'US';
  const resolvedUnits = resolveUnits(measurementUnits, country);
  const vegPool = vegSelectionClause(groceryStyle, country);
  const unitRules = unitClause(resolvedUnits);
  const dietaryNote = dietaryClause(dietaryPreferences);
  const pantryNote = pantryStaplesClause(pantryStaples);

  const cuisineGuide =
    cuisinePreferences.length > 0
      ? `Cuisine influence (${cuisineStrength}): incorporate ${cuisinePreferences.join(', ')}-inspired meals. ` +
        (cuisineStrength === 'light'
          ? 'Subtle flavour nods only — do not force a full cuisine theme.'
          : cuisineStrength === 'strong'
            ? 'The replacement meal should clearly reflect one of these cuisines.'
            : '1-2 meals across the week should reflect one of these cuisines.')
      : '';

  const cuisineAdjustment =
    cuisinePreferences.length > 0
      ? cuisineAdjustmentClause(cuisinePreferences.join(', '))
      : '';

  const mealStyleInstruction: Record<string, string> = {
    Balanced:
      'Choose a nutritionally balanced meal with a mix of protein, vegetables, and grains.',
    Healthy:
      'Prioritise lean proteins and plenty of vegetables. Minimise oil, butter, and heavy sauces.',
    Quick:
      'The meal must be ready in 20 minutes or less. Use simple, fast techniques (stir-fry, pan-sear, microwave-assist).',
    Budget:
      'Use affordable pantry staples and budget-friendly cuts. Avoid expensive, premium, or specialty items.',
  };
  const mealStyleGuide =
    mealStyleInstruction[mealStyle] ??
    'Choose a well-rounded, home-cook-friendly meal.';

  const otherMealsBlock = otherMeals
    .map((m) => {
      const ingLines =
        m.ingredients
          ?.map((i) => `    - ${i.name}: ${i.quantity} ${i.unit}`)
          .join('\n') ?? '    (no ingredient data)';
      const proteinTag = m.protein ? ` [protein: ${m.protein}]` : '';
      return `  ${m.day} — ${m.dishName}${proteinTag}:\n${ingLines}`;
    })
    .join('\n');

  const proteinCounts = new Map<string, number>();
  for (const m of otherMeals) {
    if (m.protein) {
      const key = m.protein.toLowerCase().trim();
      proteinCounts.set(key, (proteinCounts.get(key) ?? 0) + 1);
    }
  }
  const maxedProteins = [...proteinCounts.entries()]
    .filter(([, count]) => count >= 3)
    .map(([p]) => p);
  const sortedByUse = [...proteinCounts.entries()].sort((a, b) => a[1] - b[1]);
  const leastUsedProteins = sortedByUse.slice(0, 2).map(([p]) => p);

  const proteinDistributionClause =
    proteinCounts.size > 0
      ? [
          'PROTEIN DISTRIBUTION FOR THIS WEEK (unchanged days):',
          ...[...proteinCounts.entries()].map(([p, n]) => `  ${p}: used ${n}x`),
          '',
          maxedProteins.length > 0
            ? `⛔ DO NOT use these proteins — already at 3 days: ${maxedProteins.join(', ')}.`
            : '',
          leastUsedProteins.length > 0
            ? `✅ Prefer a protein used fewer times this week: ${leastUsedProteins.join(', ')}.`
            : '',
          'No single protein may appear more than 3 times across the full 7-day week.',
        ]
          .filter(Boolean)
          .join('\n')
      : 'No protein used more than 3 times — keep the week balanced.';

  const avoidClause =
    avoidedIngredients.length > 0
      ? `⛔ NEVER include these ingredients anywhere: ${avoidedIngredients.join(', ')}.`
      : '';

  const isVegetarianActive =
    dietaryPreferences?.includes('Vegetarian') ?? false;

  const proteinGuide = isVegetarianActive
    ? 'This plan is VEGETARIAN. The replacement meal MUST use only plant-based proteins: tofu, tempeh, eggs, beans, chickpeas, lentils, edamame, paneer. NO MEAT OR SEAFOOD, regardless of preferred proteins.' +
      (preferredProteins.length > 0
        ? ` Preferred plant-based proteins: ${preferredProteins.join(', ')}.`
        : '')
    : preferredProteins.length > 0
      ? `Preferred proteins: ${preferredProteins.join(', ')}. Strongly prefer one of these proteins for the replacement meal where compatible with the meal style.`
      : '';

  return `
You are DinnerReady, a practical weekly dinner planning assistant.

Return VALID JSON only.
Do not use markdown.
Do not add explanations.
Do not use code fences.

====================
TASK
====================
Replace the meal currently planned for ${day}.
Original meal being replaced: "${originalMeal.dishName}"
Do NOT generate this dish or anything very similar to it.

====================
USER SETTINGS
====================
People: ${people}
Meal Style: ${mealStyle} — ${mealStyleGuide}
Country: ${country}
Grocery shopping: ${groceryStyle ?? 'regular'} market
Units: ${resolvedUnits}
${avoidClause}
${proteinGuide}
${cuisineGuide}
${dietaryNote ? dietaryNote + '\n' : ''}

====================
VEGETABLE SELECTION
====================
${vegPool}
${cuisineAdjustment ? cuisineAdjustment + '\n' : ''}
====================
MEAL STYLE RULES
====================
Apply the rules for "${mealStyle}" STRICTLY.
The replacement meal must clearly reflect these constraints.

BALANCED:
- Include a mix of protein, carbs, and vegetables
- Use standard home-cook pantry ingredients
- No restrictions on fat or sauce — normal weeknight cooking

HEALTHY:
- Lean proteins ONLY: chicken breast, turkey, fish, legumes, tofu, or eggs
- FORBIDDEN proteins: ground beef, sausage, bacon, or any fatty / processed cut
- At least 2 distinct vegetables in the meal
- NO deep-fried dishes, heavy cream sauces, or butter-based sauces
- Cooking methods: grilling, steaming, roasting, or light stir-fry
- Limit added fat to 1 tbsp of oil
- Use broth, citrus, herbs, or light vinaigrettes instead of rich sauces

QUICK:
- Meal MUST be completable in 20 minutes or less — no exceptions
- Cooking methods only: stir-fry, pan-sear, broil, or microwave-assist
- NO slow-roasting, braising, marinating steps, or dishes needing resting time
- Prefer pre-cut, canned, or frozen-friendly ingredients
- Target 6 total steps (2 Prep + 3 Cook + 1 Finish) — stay close to the minimum
- NO dough, pastry, or any component requiring more than 20 minutes

BUDGET:
- Use ONLY affordable, widely available ingredients: ground beef or pork, canned beans, eggs, rice, pasta, potatoes, cabbage, lentils, canned tomatoes, chicken thighs
- STRICTLY FORBIDDEN: salmon, shrimp, steak, lamb, duck, specialty cheeses (brie, goat cheese, gruyère), truffle, or exotic/specialty produce
- Pantry staples (rice, pasta, canned beans, canned tomatoes) must feature prominently
- Prioritise ingredients already present in the unchanged days to maximise reuse
- estimatedCost MUST be "low"

====================
WEEKLY CONTEXT (days that stay unchanged)
====================
${otherMealsBlock}

====================
PROTEIN CONSTRAINT (CRITICAL)
====================
${proteinDistributionClause}

====================
REPLACEMENT MEAL RULES
====================
- Generate exactly ONE replacement meal for ${day}
- Do not repeat "${originalMeal.dishName}" or anything very similar
- Choose a protein that respects the PROTEIN CONSTRAINT above — do NOT exceed 3 uses of any protein across the full week
- Also avoid the same protein as the day immediately before or after ${day}
- Reuse at least 1–2 ingredients from the unchanged days above to minimise waste
- You may introduce at most 1 completely new ingredient
- Meal must be ≤ 35 minutes, home-cook friendly (sauté, stir-fry, bake, simmer, roast)
- Must be a complete, filling dinner for ${people} people
- Include ONLY these fields for the new day: day, main (with name/servings/protein/ingredients), steps
- Follow COOKING FLOW RULES for steps: Prep (2–4), Cook (3–5), Finish (1–2)
- 10 ingredients or fewer inside main.ingredients
- Every ingredient MUST use the format: {"name": "...", "quantity": number, "unit": "..."}
  Good: {"name": "Bell Pepper", "quantity": 2, "unit": "count"}
  Good: {"name": "Chicken Breast", "quantity": 1, "unit": "lb"}
  Good: {"name": "Salt", "quantity": 0.5, "unit": "tsp"}
  Bad: {"name": "Salt", "amount": "to taste"} — use quantity + unit, never amount
- Do NOT include: dishName, prepNotice, amount, or any extra fields

INGREDIENT QUANTITY RULES — scale to ${people} people:
- Vegetables (e.g. broccoli, zucchini): 0.2–0.3 lb per person per meal
- Proteins: 0.3–0.5 lb per person per meal
- Countable vegetables (e.g. bell peppers): ~0.5–1 per meal for every 2 people
- Do NOT default every vegetable to 1 lb regardless of people count

VEGETABLE DISTRIBUTION:
- Consider the vegetables already used in the unchanged days (listed above)
- Do NOT repeat a vegetable that already appears on the day immediately before or after ${day}
- Prefer a vegetable NOT heavily used in the rest of the week
- If a vegetable already appears 2× in the unchanged days, avoid using it again

====================
COOKING FLOW RULES
====================
Structure the replacement meal's steps into exactly 3 phases, in this order:
  1. Prep
  2. Cook
  3. Finish

Prefix EVERY step with its phase label and a colon:
  "Prep: ..."
  "Cook: ..."
  "Finish: ..."

PHASE REQUIREMENTS:

Prep (2–4 steps):
- Chopping, measuring, marinating, preheating, boiling water
- Good examples:
  "Prep: Mince 3 garlic cloves and thinly slice the bell pepper and onion."
  "Prep: Pat the protein dry and season both sides with salt, pepper, and your chosen spice."
  "Prep: Preheat the oven to 400 °F (200 °C) and line a baking sheet with foil."

Cook (3–5 steps):
- The main cooking sequence — EVERY Cook step MUST include time and/or temperature
- Good examples:
  "Cook: Heat 1 tbsp olive oil in a large skillet over medium-high heat until shimmering, about 1 minute."
  "Cook: Add the protein and cook for 5–6 minutes per side until golden and cooked through."
  "Cook: Add the vegetables and garlic; stir-fry over medium heat for 2–3 minutes until softened and fragrant."
  "Cook: Pour in the sauce, reduce to medium-low heat, and simmer for 3–4 minutes stirring occasionally."

Finish (1–2 steps):
- Plating, garnishing, resting, final seasoning
- Good examples:
  "Finish: Taste and adjust seasoning with salt and pepper; serve immediately over rice or as desired."
  "Finish: Let the meat rest for 3 minutes before slicing, then plate with vegetables and sauce."

BANNED STEP PATTERNS — never output a step matching these:
- Any step without its "Prep:", "Cook:", or "Finish:" prefix
- "Cook: Cook the [protein]." — must include time or temperature
- "Finish: Serve." — too vague, always add plating context
- Any step body under 8 words (not counting the prefix label itself)

TOTALS:
- Minimum 6 steps total (2 Prep + 3 Cook + 1 Finish)
- Maximum 11 steps total (4 Prep + 5 Cook + 2 Finish)
- Phases MUST appear in order: all Prep steps first, then all Cook steps, then all Finish steps

====================
GROCERY LIST RULES (FULL WEEK)
====================
After finalising the new meal for ${day}, generate a complete grocery list for the ENTIRE week
by aggregating ingredients from all 7 days:
  - The other 6 unchanged days listed above
  - The new replacement meal for ${day}

Use EXACTLY these category keys:
- "Produce 🥬"
- "Meat & Seafood 🥩"
- "Dairy & Eggs 🥚"
- "Pantry & Grains 🍞"
- "Frozen 🧊"

Each grocery item MUST include ONLY:
- name
- amount
- usedIn (array of day abbreviations)

${unitRules}

Grocery amount rules:
- Assume user shops ONCE for the whole week
- List each ingredient ONCE — deduplicate across all days
- Use realistic purchase quantities (not summed cooking amounts)
- Meat & Seafood: MUST use lb or oz (or g/kg if metric)
- Vegetables by weight: use lb or g/kg
- Countable vegetables (bell peppers, onions): use count
- Eggs: "12 count" unless people = 1
- Condiments/oils: "1 bottle"
- Keep grocery list under 20 total items
- Use raw ingredient names (not "Cooked Rice")
${pantryNote ? '\n' + pantryNote + '\n' : ''}
====================
REQUIRED JSON FORMAT
====================
{
  "newDay": {
    "day": "${day}",
    "main": {
      "name": "...",
      "servings": ${people},
      "protein": "...",
      "ingredients": [
        { "name": "...", "quantity": 1, "unit": "lb" }
      ]
    },
    "steps": [
      "Prep: Slice the vegetables thinly and mince the garlic; set aside.",
      "Prep: Pat the protein dry and season both sides with salt, pepper, and your chosen spice.",
      "Cook: Heat 1 tbsp olive oil in a large skillet over medium-high heat until shimmering, about 1 minute.",
      "Cook: Add the protein and cook for 5–6 minutes per side until browned and cooked through.",
      "Cook: Add the vegetables and garlic; stir-fry over medium heat for 3–4 minutes until tender-crisp.",
      "Finish: Taste and adjust seasoning with salt and pepper; serve immediately over rice or as desired."
    ]
  },
  "groceryList": {
    "Produce 🥬": [
      { "name": "Broccoli", "amount": "1.5 lbs", "usedIn": ["Mon", "${day}"] }
    ],
    "Meat & Seafood 🥩": [],
    "Dairy & Eggs 🥚": [],
    "Pantry & Grains 🍞": [],
    "Frozen 🧊": []
  },
  "meta": {
    "mealStyle": "${mealStyle}",
    "people": ${people},
    "coreProteins": [],
    "coreProduce": [],
    "totalUniqueIngredients": 0,
    "estimatedCost": "medium",
    "notes": []
  }
}

====================
SELF-CHECK (run before returning)
====================
For "newDay":
  ✅ steps contain at least 2 "Prep: " steps, at least 3 "Cook: " steps, and at least 1 "Finish: " step
  ✅ phases appear in order: all Prep steps first, then all Cook steps, then all Finish steps
  ✅ every "Cook: " step contains a time or temperature detail
  ✅ no step body is fewer than 8 words (not counting the "Prep: " / "Cook: " / "Finish: " prefix)
  ✅ no step is missing its phase prefix
  ✅ ingredients count is 10 or fewer
  ✅ no extra fields beyond: day, main (name/servings/protein/ingredients), steps
  ✅ every ingredient uses {name, quantity, unit} — no amount field
  ✅ meal clearly reflects the selected style "${mealStyle}" — verified against MEAL STYLE RULES above
  ✅ vegetable amounts are realistic for ${people} ${people === 1 ? 'person' : 'people'} (0.2–0.3 lb per person, never a flat 1 lb)
  ✅ the chosen vegetable does not already appear on the day before or after ${day} in the unchanged days

If any check fails, fix the output before returning.

Return the JSON now.
`.trim();
}
