/**
 * Strips markdown code fences from a string and attempts to parse it as JSON.
 * Returns the parsed value on success, or null on failure.
 */
export function safeJsonParse<T>(raw: string): T | null {
  try {
    // Remove markdown code fences (```json ... ``` or ``` ... ```)
    let cleaned = raw.trim();

    if (cleaned.startsWith('```')) {
      // Remove opening fence line (e.g. ```json or ```)
      cleaned = cleaned.replace(/^```[a-zA-Z]*\n?/, '');
      // Remove closing fence
      cleaned = cleaned.replace(/```\s*$/, '');
      cleaned = cleaned.trim();
    }

    return JSON.parse(cleaned) as T;
  } catch {
    return null;
  }
}
