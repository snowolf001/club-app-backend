/**
 * mealPreferences.ts
 *
 * Unified preference resolution: merges explicit user settings with learned
 * behaviour (protein scores) and enforces priority rules so that explicit
 * preferences always win over learned avoidance.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface UserPreferenceSettings {
  preferredProteins: string[];
  avoidedIngredients: string[];
}

/**
 * A map of ingredient/protein name → learned score.
 * Negative scores indicate the user has repeatedly skipped or disliked
 * that ingredient; positive scores indicate preference.
 */
export type ProteinScores = Record<string, number>;

export interface ResolvedMealPreferences {
  preferredProteins: string[];
  avoidedIngredients: string[];
}

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * Ingredients with a score at or below this threshold are treated as
 * "learned avoided" by the system.
 */
const AVOID_SCORE_THRESHOLD = -1;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Derives a list of ingredient names that the system has learned the user
 * dislikes, based on their accumulated protein scores.
 */
export function getAvoidedIngredients(proteinScores: ProteinScores): string[] {
  return Object.entries(proteinScores)
    .filter(([, score]) => score <= AVOID_SCORE_THRESHOLD)
    .map(([name]) => name);
}

/**
 * Resolves the final preference arrays used when building a meal prompt.
 *
 * Priority rules:
 *  1. Explicit user settings always take precedence over learned behaviour.
 *  2. If an ingredient appears in `preferredProteins`, it is NEVER added to
 *     `avoidedIngredients`, regardless of what the learned scores say.
 *  3. `preferredProteins` is returned unchanged — learned scores never reduce it.
 */
export function resolveMealPreferences(
  settings: UserPreferenceSettings,
  proteinScores: ProteinScores
): ResolvedMealPreferences {
  const learnedAvoided = getAvoidedIngredients(proteinScores);

  // Merge explicit avoided + learned avoided, deduplicated (case-insensitive key)
  const merged = Array.from(
    new Set([
      ...settings.avoidedIngredients.map((s) => s.trim()),
      ...learnedAvoided.map((s) => s.trim()),
    ])
  );

  // Explicit preferred proteins win: strip them from the avoided list
  const preferredLower = new Set(
    settings.preferredProteins.map((p) => p.toLowerCase())
  );
  const avoidedIngredients = merged.filter(
    (ing) => !preferredLower.has(ing.toLowerCase())
  );

  return {
    preferredProteins: settings.preferredProteins,
    avoidedIngredients,
  };
}
