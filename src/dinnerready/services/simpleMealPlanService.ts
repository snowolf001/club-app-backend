import OpenAI from 'openai';
import { buildSimpleMealPlanPrompt } from '../prompts/simpleMealPlanPrompt';
import type { MealPlanStyle } from '../types/mealPlan';
import type { SimpleMealPlan } from '../types/simpleMealPlan';
import { safeJsonParse } from '../utils/jsonUtils';

const REQUIRED_GROCERY_KEYS = [
  'protein',
  'vegetables',
  'pantry',
  'others',
] as const;

function validateSimpleMealPlan(plan: unknown): plan is SimpleMealPlan {
  if (!plan || typeof plan !== 'object') return false;

  const p = plan as Record<string, unknown>;

  if (!Array.isArray(p.days) || p.days.length !== 7) return false;

  const dayNumbers = (p.days as Array<Record<string, unknown>>).map(
    (d) => d.day
  );
  for (let i = 1; i <= 7; i++) {
    if (!dayNumbers.includes(i)) return false;
  }

  if (!p.groceryList || typeof p.groceryList !== 'object') return false;
  const gl = p.groceryList as Record<string, unknown>;
  for (const key of REQUIRED_GROCERY_KEYS) {
    if (!Array.isArray(gl[key])) return false;
  }

  return true;
}

export async function generateSimpleMealPlan(params: {
  people: number;
  style: MealPlanStyle;
}): Promise<SimpleMealPlan> {
  console.log('[DinnerReady] generateSimpleMealPlan start', params);

  const client = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });

  const model = process.env.OPENAI_MODEL ?? 'gpt-4o-mini';
  const prompt = buildSimpleMealPlanPrompt(params);

  const response = await client.chat.completions.create({
    model,
    temperature: 0.4,
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

  const raw = response.choices[0]?.message?.content ?? '';

  const parsed = safeJsonParse<SimpleMealPlan>(raw);

  if (!parsed) {
    throw new Error(
      'Failed to parse simple meal plan JSON from OpenAI response.'
    );
  }

  if (!validateSimpleMealPlan(parsed)) {
    throw new Error(
      'OpenAI response did not pass validation: missing required days or grocery categories.'
    );
  }

  console.log('[DinnerReady] generateSimpleMealPlan success');
  return parsed;
}
