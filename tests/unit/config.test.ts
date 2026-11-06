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

  it("honors explicit overrides", () => {
    const config = loadConfig({ ...BASE_ENV, PORT: "8080", LOG_LEVEL: "debug", NODE_ENV: "production" });
    expect(config.port).toBe(8080);
    expect(config.logLevel).toBe("debug");
    expect(config.nodeEnv).toBe("production");
  });
});
