import type { AnalysisOutput } from "./types.js";

export class InvalidAdapterOutputError extends Error {}

const MAX_SUMMARY_LENGTH = 2000;
const MAX_ITEMS = 50;
const MAX_MESSAGE_LENGTH = 500;

function fail(reason: string): never {
  throw new InvalidAdapterOutputError(reason);
}

function isNonEmptyString(value: unknown, maxLength: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maxLength;
}

/**
 * The adapter boundary is untrusted, whether it's today's mock or tomorrow's
 * real LLM call (ARCHITECTURE.md §4): wrong types, a missing field, or an
 * evidence id the model invented outside the batch it was given must never
 * reach persistence. Anything that fails here becomes a 502
 * INVALID_ADAPTER_OUTPUT instead of corrupting an `analyses` row.
 */
export function validateAnalysisOutput(output: unknown, batchLogIds: ReadonlySet<string>): asserts output is AnalysisOutput {
  if (typeof output !== "object" || output === null) fail("Adapter output must be an object.");
  const candidate = output as Record<string, unknown>;

  if (!isNonEmptyString(candidate.summary, MAX_SUMMARY_LENGTH)) {
    fail("Adapter output must include a non-empty 'summary' string.");
  }

  if (!Array.isArray(candidate.categories) || candidate.categories.length > MAX_ITEMS) {
    fail(`Adapter output 'categories' must be an array of at most ${MAX_ITEMS} items.`);
  }
  for (const category of candidate.categories) {
    if (typeof category !== "object" || category === null) fail("Each category must be an object.");
    const c = category as Record<string, unknown>;
    if (!isNonEmptyString(c.name, 100)) fail("Each category needs a non-empty 'name'.");
    if (c.severity !== "WARN" && c.severity !== "ERROR") fail("Each category 'severity' must be WARN or ERROR.");
    if (!Number.isInteger(c.count) || (c.count as number) <= 0) fail("Each category 'count' must be a positive integer.");
    if (!Array.isArray(c.evidenceLogIds) || c.evidenceLogIds.length === 0) {
      fail("Each category needs a non-empty 'evidenceLogIds' array.");
    }
    for (const id of c.evidenceLogIds) {
      if (typeof id !== "string" || !batchLogIds.has(id)) {
        fail("Each evidenceLogIds entry must be an id from the analyzed batch.");
      }
    }
  }

  if (!Array.isArray(candidate.suggestions) || candidate.suggestions.length > MAX_ITEMS) {
    fail(`Adapter output 'suggestions' must be an array of at most ${MAX_ITEMS} items.`);
  }
  for (const suggestion of candidate.suggestions) {
    if (typeof suggestion !== "object" || suggestion === null) fail("Each suggestion must be an object.");
    const s = suggestion as Record<string, unknown>;
    if (!isNonEmptyString(s.category, 100)) fail("Each suggestion needs a non-empty 'category'.");
    if (!isNonEmptyString(s.message, MAX_MESSAGE_LENGTH)) fail("Each suggestion needs a non-empty 'message'.");
  }
}
