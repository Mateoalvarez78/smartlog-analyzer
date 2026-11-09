import type { LlmClient, LlmPrompt } from "../../../src/analysis/llm/types.js";
import type { AnalysisAdapter, AnalysisInput, AnalysisOutput } from "../../../src/analysis/types.js";

/** An LLM client that answers every prompt with a fixed raw text, like a real model might. */
export class FixedTextLlmClient implements LlmClient {
  readonly name = "test-fixed-text";
  constructor(private readonly text: string) {}
  async complete(_prompt: LlmPrompt): Promise<string> {
    return this.text;
  }
}

/** An LLM client that ignores the AbortSignal and answers late. */
export class SlowLlmClient implements LlmClient {
  readonly name = "test-slow-llm";
  constructor(private readonly answerAfterMs: number) {}
  async complete(_prompt: LlmPrompt): Promise<string> {
    await delay(this.answerAfterMs);
    return '{"summary":"too late","categories":[],"suggestions":[]}';
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Always returns a valid, minimal output. */
export class ValidTestAdapter implements AnalysisAdapter {
  readonly name = "test-valid";
  async analyze(_input: AnalysisInput): Promise<AnalysisOutput> {
    return { summary: "ok", categories: [], suggestions: [] };
  }
}

/** Simulates a provider-side failure (network error, 5xx, etc). */
export class ThrowingTestAdapter implements AnalysisAdapter {
  readonly name = "test-throwing";
  async analyze(): Promise<AnalysisOutput> {
    throw new Error("simulated adapter failure");
  }
}

/** Resolves, but with output that fails schema/evidence validation. */
export class MalformedTestAdapter implements AnalysisAdapter {
  readonly name = "test-malformed";
  async analyze(_input: AnalysisInput): Promise<AnalysisOutput> {
    return {
      summary: "x",
      // References an id that doesn't belong to the analyzed batch.
      categories: [{ name: "x", severity: "ERROR", count: 1, evidenceLogIds: ["00000000-0000-0000-0000-000000000000"] }],
      suggestions: [],
    };
  }
}

/**
 * Ignores the AbortSignal entirely and resolves well after any reasonable
 * timeout. Used to prove runWithTimeout's hard timer (not cooperative
 * cancellation) is what bounds the request, and that the late resolution
 * never overwrites the already-persisted timeout outcome.
 */
export class NeverRespondingInTimeTestAdapter implements AnalysisAdapter {
  readonly name = "test-slow";
  constructor(private readonly resolveAfterMs: number) {}
  async analyze(_input: AnalysisInput): Promise<AnalysisOutput> {
    await delay(this.resolveAfterMs);
    return { summary: "arrived too late", categories: [], suggestions: [] };
  }
}

/**
 * Resolves with a valid AnalysisOutput, but its own `name` violates the
 * `analyses.adapter` CHECK constraint (1-100 chars). Used to trigger a real
 * PostgreSQL write failure on the terminal INSERT without mocking the
 * database (ARCHITECTURE.md §5 rules that out): this is a genuine
 * constraint violation, just engineered via the adapter's identity instead
 * of its output.
 */
export class OversizedAdapterNameTestAdapter implements AnalysisAdapter {
  readonly name = "x".repeat(101);
  async analyze(_input: AnalysisInput): Promise<AnalysisOutput> {
    return { summary: "ok", categories: [], suggestions: [] };
  }
}
