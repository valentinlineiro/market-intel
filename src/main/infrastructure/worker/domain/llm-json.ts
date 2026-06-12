/**
 * domain/llm-json.ts
 *
 * Utilities for extracting JSON from raw LLM responses that may contain
 * markdown fences, prose preamble, or bare objects instead of arrays.
 */

function stripMarkdown(raw: string): string {
  return raw.replace(/^```[\w]*\n?/, '').replace(/\n?```$/, '').trim();
}

/**
 * Extracts the first JSON array from a (possibly markdown-wrapped) LLM response.
 * Falls back to wrapping a bare object in an array when the LLM returns one item
 * without brackets.
 */
export function extractJsonArray(raw: string): unknown[] | null {
  const cleaned = stripMarkdown(raw);

  const arrStart = cleaned.indexOf('[');
  const arrEnd   = cleaned.lastIndexOf(']');
  if (arrStart !== -1 && arrEnd !== -1) {
    try {
      const parsed = JSON.parse(cleaned.slice(arrStart, arrEnd + 1));
      if (Array.isArray(parsed)) return parsed;
    } catch {
      // fall through to object fallback
    }
  }

  // LLM returned a bare object instead of a single-element array
  const objStart = cleaned.indexOf('{');
  const objEnd   = cleaned.lastIndexOf('}');
  if (objStart === -1 || objEnd === -1) return null;
  try {
    const parsed = JSON.parse(cleaned.slice(objStart, objEnd + 1));
    return parsed != null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? [parsed]
      : null;
  } catch {
    return null;
  }
}

/**
 * Extracts the first JSON object from a (possibly markdown-wrapped) LLM response.
 */
export function extractJsonObject(raw: string): Record<string, unknown> | null {
  const cleaned = stripMarkdown(raw);
  const start = cleaned.indexOf('{');
  const end   = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1) return null;
  try {
    const parsed = JSON.parse(cleaned.slice(start, end + 1));
    return parsed != null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}
