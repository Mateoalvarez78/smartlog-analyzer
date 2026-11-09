import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { LlmProviderError, OpenAiCompatibleClient } from "../../src/analysis/llm/openai-compatible-client.js";

/**
 * A real HTTP server on localhost playing the provider, so the client's
 * actual fetch/headers/body/abort behavior is exercised without network
 * access or an API key.
 */
type Handler = (req: IncomingMessage, body: string, res: ServerResponse) => void;

describe("OpenAiCompatibleClient", () => {
  let server: Server;
  let baseUrl: string;
  let handler: Handler;

  beforeAll(async () => {
    server = createServer((req, res) => {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => handler(req, body, res));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
  });

  beforeEach(() => {
    handler = (_req, _body, res) => res.writeHead(500).end();
  });

  afterAll(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  const prompt = { system: "instructions", user: '{"logs":[]}' };
  const signal = () => new AbortController().signal;

  function reply(res: ServerResponse, status: number, payload: unknown) {
    res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(payload));
  }

  it("posts a chat completion with system/user messages and returns the message content", async () => {
    let seen: { url?: string | undefined; auth?: string | undefined; body?: Record<string, unknown> } = {};
    handler = (req, body, res) => {
      seen = { url: req.url, auth: req.headers.authorization, body: JSON.parse(body) };
      reply(res, 200, { choices: [{ message: { role: "assistant", content: '{"summary":"ok"}' } }] });
    };

    const client = new OpenAiCompatibleClient({ baseUrl: `${baseUrl}/`, model: "test-model", apiKey: "k-123" });
    const text = await client.complete(prompt, signal());

    expect(text).toBe('{"summary":"ok"}');
    expect(seen.url).toBe("/v1/chat/completions");
    expect(seen.auth).toBe("Bearer k-123");
    expect(seen.body).toMatchObject({
      model: "test-model",
      temperature: 0,
      messages: [
        { role: "system", content: "instructions" },
        { role: "user", content: '{"logs":[]}' },
      ],
    });
  });

  it("omits the Authorization header when there is no API key (e.g. local Ollama)", async () => {
    let auth: string | undefined = "unset";
    handler = (req, _body, res) => {
      auth = req.headers.authorization;
      reply(res, 200, { choices: [{ message: { content: "{}" } }] });
    };
    await new OpenAiCompatibleClient({ baseUrl, model: "m" }).complete(prompt, signal());
    expect(auth).toBeUndefined();
  });

  it("throws LlmProviderError with only the status on a non-2xx response", async () => {
    handler = (_req, _body, res) => reply(res, 429, { error: { message: "quota exceeded for prompt: secret stuff" } });
    const promise = new OpenAiCompatibleClient({ baseUrl, model: "m" }).complete(prompt, signal());
    await expect(promise).rejects.toBeInstanceOf(LlmProviderError);
    await expect(promise).rejects.toThrow("HTTP 429");
    await expect(promise).rejects.not.toThrow(/secret/);
  });

  it("throws LlmProviderError when the response has no message content", async () => {
    handler = (_req, _body, res) => reply(res, 200, { choices: [] });
    await expect(new OpenAiCompatibleClient({ baseUrl, model: "m" }).complete(prompt, signal())).rejects.toBeInstanceOf(
      LlmProviderError,
    );
  });

  it("cancels the in-flight HTTP request when the signal aborts", async () => {
    let requestClosed = false;
    handler = (req) => {
      // Never answers; we only observe whether the client hangs up.
      req.socket.on("close", () => (requestClosed = true));
    };
    const controller = new AbortController();
    const promise = new OpenAiCompatibleClient({ baseUrl, model: "m" }).complete(prompt, controller.signal);
    setTimeout(() => controller.abort(), 50);

    await expect(promise).rejects.toThrow(/abort/i);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(requestClosed).toBe(true);
  });
});
