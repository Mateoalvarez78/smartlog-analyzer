import type { LlmClient, LlmPrompt } from "./types.js";

export interface OpenAiCompatibleOptions {
  /** e.g. https://api.openai.com/v1, http://localhost:11434/v1 (Ollama), or Gemini's OpenAI-compatible endpoint. */
  baseUrl: string;
  model: string;
  /** Optional: local servers such as Ollama don't need one. */
  apiKey?: string | undefined;
}

export class LlmProviderError extends Error {}

/**
 * Real client for any provider exposing the OpenAI Chat Completions API
 * (`POST {baseUrl}/chat/completions`). One implementation covers OpenAI,
 * Gemini (free tier, via its OpenAI-compatible endpoint) and local models
 * served by Ollama, so trying it doesn't require paying for anything.
 *
 * The AbortSignal is forwarded to fetch, so a timeout in the orchestrator
 * really cancels the HTTP request instead of leaving it running.
 */
export class OpenAiCompatibleClient implements LlmClient {
  readonly name: string;

  constructor(private readonly options: OpenAiCompatibleOptions) {
    this.name = `openai-compatible:${options.model}`;
  }

  async complete(prompt: LlmPrompt, signal: AbortSignal): Promise<string> {
    const url = `${this.options.baseUrl.replace(/\/+$/, "")}/chat/completions`;
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (this.options.apiKey) headers.authorization = `Bearer ${this.options.apiKey}`;

    const response = await fetch(url, {
      method: "POST",
      headers,
      signal,
      body: JSON.stringify({
        model: this.options.model,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: prompt.system },
          { role: "user", content: prompt.user },
        ],
      }),
    });

    if (!response.ok) {
      // Only the status: the provider's body may echo parts of the prompt.
      throw new LlmProviderError(`LLM provider responded with HTTP ${response.status}.`);
    }

    const body = (await response.json()) as { choices?: Array<{ message?: { content?: unknown } }> };
    const content = body.choices?.[0]?.message?.content;
    if (typeof content !== "string") {
      throw new LlmProviderError("LLM provider response has no message content.");
    }
    return content;
  }
}
