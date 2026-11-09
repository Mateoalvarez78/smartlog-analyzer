import { InvalidAdapterOutputError } from "../validate-output.js";

// Models often wrap JSON in a markdown fence even when told not to.
const FENCED_JSON = /^```(?:json)?\s*([\s\S]*?)\s*```$/i;

/**
 * Turns the model's raw text into a JSON value. Tolerates exactly one known
 * quirk (a ```json fence around the whole answer) and nothing else: prose
 * around the JSON, truncated output or an empty answer are rejected, because
 * guessing which part of a free-form answer is "the JSON" hides real model
 * failures. The returned value is still unvalidated; the orchestrator runs
 * validateAnalysisOutput on it.
 */
export function parseLlmResponse(text: string): unknown {
  const trimmed = text.trim();
  if (trimmed === "") {
    throw new InvalidAdapterOutputError("LLM response is empty.");
  }

  const fenced = FENCED_JSON.exec(trimmed);
  const candidate = fenced?.[1] ?? trimmed;

  try {
    return JSON.parse(candidate);
  } catch {
    throw new InvalidAdapterOutputError("LLM response is not valid JSON.");
  }
}
