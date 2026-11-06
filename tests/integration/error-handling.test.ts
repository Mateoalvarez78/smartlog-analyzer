import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../../src/app.js";
import type { AppConfig } from "../../src/config.js";
import { createTestPool, testDatabaseUrl } from "./helpers/db.js";

const config: AppConfig = {
  nodeEnv: "test",
  host: "127.0.0.1",
  port: 0,
  databaseUrl: testDatabaseUrl(),
  logLevel: "silent",
  healthDbTimeoutMs: 1000,
  analysisAdapter: "mock",
  analysisTimeoutMs: 5000,
  analysisMaxLogs: 100,
  analysisMaxBytes: 200_000,
  logsDefaultLimit: 50,
  logsMaxLimit: 500,
};

/**
 * These cover Fastify's own request-parsing errors (not our route schemas,
 * not AppError) — the class of bug found by live-probing the running
 * container with curl: a >1MB POST body logged FST_ERR_CTP_BODY_TOO_LARGE
 * (statusCode 413) but the client received a raw 500, because the error
 * handler only special-cased AppError and `.validation` and defaulted
 * everything else to 500 regardless of the error's own statusCode.
 */
describe("Fastify-level request errors use their real statusCode, not a flat 500", () => {
  let pool: Pool;
  let app: FastifyInstance;

  beforeAll(async () => {
    pool = await createTestPool();
    app = buildApp(config, pool);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  it("returns 400 (not 500) for malformed JSON", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/logs",
      headers: { "content-type": "application/json" },
      payload: '{"service":"x", invalid json',
    });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body).toHaveProperty("error.code");
    expect(body).toHaveProperty("error.message");
  });

  it("returns 400 (not 500) for an empty body with a JSON content-type", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/logs",
      headers: { "content-type": "application/json" },
      payload: "",
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 413 (not 500) for a body over the size limit", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/logs",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({
        service: "x",
        level: "INFO",
        message: "a".repeat(2_000_000),
        timestamp: "2026-11-06T12:00:00Z",
      }),
    });
    expect(res.statusCode).toBe(413);
    expect(res.json().error.code).toBe("FST_ERR_CTP_BODY_TOO_LARGE");
  });
});
