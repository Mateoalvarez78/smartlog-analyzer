/**
 * What gets sent to a language model: fixed instructions (system) kept
 * separate from the untrusted data (user). See prompt.ts.
 */
export interface LlmPrompt {
  system: string;
  user: string;
}

/**
 * The only thing that changes between the mock and a real provider: send a
 * prompt, get raw text back. Everything else (building the prompt, parsing
 * and validating the answer, timeout, persistence) is shared, so the tests
 * for "unexpected format" exercise the same parsing code a real model hits.
 */
export interface LlmClient {
  readonly name: string;
  complete(prompt: LlmPrompt, signal: AbortSignal): Promise<string>;
}
