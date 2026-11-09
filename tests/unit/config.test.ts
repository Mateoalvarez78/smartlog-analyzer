import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig } from "../../src/config.js";

const BASE_ENV = { DATABASE_URL: "postgresql://user:pass@localhost:5432/db" };

describe("loadConfig", () => {
  it("applies documented defaults when only DATABASE_URL is set", () => {
    const config = loadConfig(BASE_ENV);

    expect(config).toMatchObject({
      nodeEnv: "development",
      host: "0.0.0.0",
      port: 3000,
      logLevel: "info",
      healthDbTimeoutMs: 1000,
      analysisAdapter: "mock",
      analysisTimeoutMs: 5000,
      analysisMaxLogs: 100,
      analysisMaxBytes: 200_000,
      logsDefaultLimit: 50,
      logsMaxLimit: 500,
    });
  });

  it("throws when DATABASE_URL is missing", () => {
    expect(() => loadConfig({})).toThrow(ConfigError);
    expect(() => loadConfig({})).toThrow(/DATABASE_URL/);
  });

  it("rejects an invalid NODE_ENV without leaking into a silent default", () => {
    expect(() => loadConfig({ ...BASE_ENV, NODE_ENV: "staging" })).toThrow(ConfigError);
  });

  it("rejects a non-numeric PORT", () => {
    expect(() => loadConfig({ ...BASE_ENV, PORT: "not-a-number" })).toThrow(/PORT/);
  });

  it("rejects a zero or negative numeric override", () => {
    expect(() => loadConfig({ ...BASE_ENV, ANALYSIS_MAX_LOGS: "0" })).toThrow(/ANALYSIS_MAX_LOGS/);
    expect(() => loadConfig({ ...BASE_ENV, ANALYSIS_MAX_LOGS: "-5" })).toThrow(/ANALYSIS_MAX_LOGS/);
  });

  it("does not include LLM settings for the mock adapter", () => {
    expect(loadConfig(BASE_ENV)).not.toHaveProperty("llm");
  });

  it("rejects an unknown ANALYSIS_ADAPTER", () => {
    expect(() => loadConfig({ ...BASE_ENV, ANALYSIS_ADAPTER: "gpt" })).toThrow(/ANALYSIS_ADAPTER/);
  });

  it("requires LLM_BASE_URL and LLM_MODEL for the openai-compatible adapter", () => {
    const env = { ...BASE_ENV, ANALYSIS_ADAPTER: "openai-compatible" };
    expect(() => loadConfig(env)).toThrow(/LLM_BASE_URL/);
    expect(() => loadConfig({ ...env, LLM_BASE_URL: "http://localhost:11434/v1" })).toThrow(/LLM_MODEL/);
    expect(() => loadConfig({ ...env, LLM_BASE_URL: "not a url", LLM_MODEL: "m" })).toThrow(/LLM_BASE_URL/);
  });

  it("loads the openai-compatible settings, treating a blank API key as absent", () => {
    const config = loadConfig({
      ...BASE_ENV,
      ANALYSIS_ADAPTER: "openai-compatible",
      LLM_BASE_URL: "http://localhost:11434/v1",
      LLM_MODEL: "llama3.1",
      LLM_API_KEY: "",
    });
    expect(config.llm).toEqual({ baseUrl: "http://localhost:11434/v1", model: "llama3.1", apiKey: undefined });
  });

  it("never echoes the API key in a configuration error", () => {
    const secret = "sk-super-secret";
    try {
      loadConfig({ ...BASE_ENV, ANALYSIS_ADAPTER: "openai-compatible", LLM_API_KEY: secret });
      expect.unreachable();
    } catch (error) {
      expect((error as Error).message).not.toContain(secret);
    }
  });

  it("honors explicit overrides", () => {
    const config = loadConfig({ ...BASE_ENV, PORT: "8080", LOG_LEVEL: "debug", NODE_ENV: "production" });
    expect(config.port).toBe(8080);
    expect(config.logLevel).toBe("debug");
    expect(config.nodeEnv).toBe("production");
  });
});
