import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../../src/app.js";
import type { AppConfig } from "../../src/config.js";
import { createTestPool, testDatabaseUrl, truncateAll } from "./helpers/db.js";

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

async function postLog(app: FastifyInstance, overrides: Record<string, unknown> = {}) {
  return app.inject({
    method: "POST",
    url: "/api/logs",
    payload: {
      service: "payments-api",
      level: "INFO",
      message: "Payment captured",
      timestamp: "2026-11-01T08:00:00Z",
      ...overrides,
    },
  });
}

describe("POST /api/logs", () => {
  let pool: Pool;
  let app: FastifyInstance;

  beforeAll(async () => {
    pool = await createTestPool();
    app = buildApp(config, pool);
    await app.ready();
  });

  beforeEach(async () => {
    await truncateAll(pool);
  });

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  it("creates a log and returns 201 with the stored record", async () => {
    const response = await postLog(app);
    expect(response.statusCode).toBe(201);

    const body = response.json();
    expect(body).toMatchObject({
      service: "payments-api",
      level: "INFO",
      message: "Payment captured",
      timestamp: "2026-11-01T08:00:00.000Z",
    });
    expect(body.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("normalizes a non-UTC offset to UTC in the stored timestamp", async () => {
    const response = await postLog(app, { timestamp: "2026-11-01T05:00:00-03:00" });
    expect(response.statusCode).toBe(201);
    expect(response.json().timestamp).toBe("2026-11-01T08:00:00.000Z");
  });

  it.each([
    ["missing service", { service: undefined }],
    ["empty service", { service: "" }],
    ["invalid level", { level: "CRITICAL" }],
    ["empty message", { message: "" }],
    ["timestamp without offset", { timestamp: "2026-11-01T08:00:00" }],
    ["malformed timestamp", { timestamp: "not-a-date" }],
    ["unknown extra field", { extra: "nope" }],
  ])("rejects %s with 400 and a safe error body", async (_name, overrides) => {
    const response = await postLog(app, overrides);
    expect(response.statusCode).toBe(400);
    const body = response.json();
    expect(body).toHaveProperty("error.code");
    expect(body).toHaveProperty("error.message");
  });

  it("rejects a timestamp that matches the pattern but is not a real calendar date", async () => {
    const response = await postLog(app, { timestamp: "2026-02-30T10:00:00Z" });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("INVALID_TIMESTAMP");
  });
});

describe("GET /api/logs", () => {
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

  beforeEach(async () => {
    await truncateAll(pool);
    const fixtures = [
      { service: "payments-api", level: "ERROR", message: "a", timestamp: "2026-11-01T08:00:00Z" },
      { service: "payments-api", level: "INFO", message: "b", timestamp: "2026-11-01T09:00:00Z" },
      { service: "auth-service", level: "WARN", message: "c", timestamp: "2026-11-01T10:00:00Z" },
      { service: "auth-service", level: "ERROR", message: "d", timestamp: "2026-11-02T00:00:00Z" },
    ];
    for (const fixture of fixtures) {
      const res = await app.inject({ method: "POST", url: "/api/logs", payload: fixture });
      expect(res.statusCode).toBe(201);
    }
  });

  it("returns an empty list when there are no logs in range", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/logs?from=2099-01-01T00:00:00Z&to=2099-01-02T00:00:00Z",
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([]);
  });

  it("orders results by timestamp DESC, id DESC", async () => {
    const response = await app.inject({ method: "GET", url: "/api/logs" });
    expect(response.statusCode).toBe(200);
    const timestamps = response.json().map((log: { timestamp: string }) => log.timestamp);
    expect(timestamps).toEqual([...timestamps].sort().reverse());
  });

  it("filters by service and level combined", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/logs?service=auth-service&level=ERROR",
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toHaveLength(1);
    expect(body[0]).toMatchObject({ service: "auth-service", level: "ERROR", message: "d" });
  });

  it("applies the [from, to) interval at its exact boundaries", async () => {
    // "to" is exclusive: a log exactly at `to` must not be included.
    const response = await app.inject({
      method: "GET",
      url: "/api/logs?from=2026-11-01T08:00:00Z&to=2026-11-01T09:00:00Z",
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toHaveLength(1);
    expect(body[0]).toMatchObject({ message: "a" });
  });

  it("rejects an invalid limit beyond the documented maximum", async () => {
    const response = await app.inject({ method: "GET", url: `/api/logs?limit=${config.logsMaxLimit + 1}` });
    expect(response.statusCode).toBe(400);
  });

  it("applies logsDefaultLimit when limit is omitted, and truncates to the newest rows", async () => {
    // The 4 beforeEach fixtures aren't enough to prove truncation; a
    // dedicated low-default app on the same data makes the default limit
    // and the DESC order it truncates against both observable.
    const lowLimitApp = buildApp({ ...config, logsDefaultLimit: 2 }, pool);
    await lowLimitApp.ready();
    try {
      const response = await lowLimitApp.inject({ method: "GET", url: "/api/logs" });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body).toHaveLength(2);
      // Fixtures "d" (2026-11-02) and "c" (2026-11-01T10:00) are the two
      // most recent of the four — truncation must keep those, not drop them.
      expect(body.map((log: { message: string }) => log.message)).toEqual(["d", "c"]);
    } finally {
      await lowLimitApp.close();
    }
  });

  it("respects an explicit limit smaller than the matching row count", async () => {
    const response = await app.inject({ method: "GET", url: "/api/logs?limit=1" });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toHaveLength(1);
    expect(body[0]).toMatchObject({ message: "d" });
  });

  it("rejects malformed filter timestamps", async () => {
    const response = await app.inject({ method: "GET", url: "/api/logs?from=not-a-date" });
    expect(response.statusCode).toBe(400);
  });
});
