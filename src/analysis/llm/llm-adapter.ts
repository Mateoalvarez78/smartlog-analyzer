import type { AnalysisAdapter, AnalysisInput, AnalysisOutput } from "../types.js";
import { parseLlmResponse } from "./parse-response.js";
import { buildPrompt } from "./prompt.js";
import type { LlmClient } from "./types.js";

/**
 * AnalysisAdapter backed by a language model: builds the prompt, delegates
 * the call to an LlmClient (mock or real provider) and parses the raw text.
 *
 * The parsed value is returned as-is; the orchestrator validates it against
 * the batch before persisting (validate-output.ts), so a well-formed JSON
 * with the wrong shape or invented evidence ids is still rejected.
 */
export class LlmAnalysisAdapter implements AnalysisAdapter {
  readonly name: string;

  constructor(private readonly client: LlmClient) {
    this.name = `llm:${client.name}`;
  }

  async analyze(input: AnalysisInput, signal: AbortSignal): Promise<AnalysisOutput> {
    const prompt = buildPrompt(input.logs);
    const text = await this.client.complete(prompt, signal);
    return parseLlmResponse(text) as AnalysisOutput;
  }
}
