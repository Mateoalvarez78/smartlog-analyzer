import { describe, expect, it } from "vitest";
import { LlmAnalysisAdapter } from "../../src/analysis/llm/llm-adapter.js";
import { MockLlmClient } from "../../src/analysis/llm/mock-llm-client.js";
import type { LlmClient, LlmPrompt } from "../../src/analysis/llm/types.js";
import { InvalidAdapterOutputError, validateAnalysisOutput } from "../../src/analysis/validate-output.js";
import type { LogRecord } from "../../src/logs/types.js";

function log(id: string, level: LogRecord["level"], message: string): LogRecord {
  return { id, service: "payments-api", level, message, timestamp: "2026-11-01T08:00:00.000Z", createdAt: "2026-11-01T08:00:00.000Z" };
}

/** Records the prompt it received and answers with a fixed text. */
class ScriptedClient implements LlmClient {
  readonly name = "scripted";
  lastPrompt: LlmPrompt | undefined;
  constructor(private readonly answer: string) {}
  async complete(prompt: LlmPrompt): Promise<string> {
    this.lastPrompt = prompt;
    return this.answer;
  }
}

const signal = new AbortController().signal;

describe("LlmAnalysisAdapter", () => {
  it("is named after its client", () => {
    expect(new LlmAnalysisAdapter(new ScriptedClient("{}")).name).toBe("llm:scripted");
  });

  it("sends the batch to the client and returns the parsed answer", async () => {
    const client = new ScriptedClient('```json\n{"summary":"ok","categories":[],"suggestions":[]}\n```');
    const output = await new LlmAnalysisAdapter(client).analyze({ logs: [log("a", "INFO", "hi")] }, signal);

    expect(output).toEqual({ summary: "ok", categories: [], suggestions: [] });
    expect(JSON.parse(client.lastPrompt!.user).logs[0].id).toBe("a");
  });

  it("surfaces a non-JSON answer as InvalidAdapterOutputError", async () => {
    const adapter = new LlmAnalysisAdapter(new ScriptedClient("Sorry, I cannot do that."));
    await expect(adapter.analyze({ logs: [log("a", "ERROR", "x")] }, signal)).rejects.toBeInstanceOf(InvalidAdapterOutputError);
  });
});

describe("MockLlmClient through LlmAnalysisAdapter", () => {
  const adapter = new LlmAnalysisAdapter(new MockLlmClient());

  it("produces output that passes the same validation a real model's output must pass", async () => {
    const logs = [
      log("e1", "ERROR", "Connection refused to database at 10.0.1.5:5432"),
      log("w1", "WARN", "Rate limit approaching for client 198.51.100.23"),
      log("i1", "INFO", "Payment captured"),
    ];
    const output = await adapter.analyze({ logs }, signal);

    expect(() => validateAnalysisOutput(output, new Set(logs.map((l) => l.id)))).not.toThrow();
    expect(output.categories.map((c) => c.name).sort()).toEqual(["connection_errors", "rate_limiting"]);
  });

  it("is deterministic", async () => {
    const logs = [log("e1", "ERROR", "Timeout waiting for upstream")];
    expect(await adapter.analyze({ logs }, signal)).toEqual(await adapter.analyze({ logs }, signal));
  });
});
