import { analyzeWithHeuristics } from "../heuristics.js";
import type { PromptPayload } from "./prompt.js";
import type { LlmClient, LlmPrompt } from "./types.js";

/**
 * Stands in for a real model with no network and no API key: it reads the
 * logs back from the user message (the same JSON a real model receives),
 * answers with the deterministic heuristics, and returns the answer as raw
 * text, like a provider would. That keeps the parsing path identical for
 * mock and real clients.
 */
export class MockLlmClient implements LlmClient {
  readonly name = "mock-v1";

  async complete(prompt: LlmPrompt): Promise<string> {
    const payload = JSON.parse(prompt.user) as PromptPayload;
    return JSON.stringify(analyzeWithHeuristics(payload.logs));
  }
}
