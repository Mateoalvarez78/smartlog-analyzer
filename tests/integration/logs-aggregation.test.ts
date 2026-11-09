import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { seedDatabase } from "../../db/seed.js";
import { buildApp } from "../../src/app.js";
import { aggregateByServiceAndLevel } from "../../src/logs/repository.js";
import { createTestPool, testDatabaseUrl, truncateAll } from "./helpers/db.js";

describe("aggregateByServiceAndLevel", () => {
  let pool: Pool;

  beforeAll(async () => {
    pool = await createTestPool();
  });

  beforeEach(async () => {
    await truncateAll(pool);
    await seedDatabase(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  it("counts seeded logs per service and level within the given range", async () => {
    const rows = await aggregateByServiceAndLevel(pool, {
      from: new Date("2026-11-01T00:00:00Z"),
      to: new Date("2026-11-02T00:00:00Z"),
    });

    const paymentsErrors = rows.find((r) => r.service === "payments-api" && r.level === "ERROR");
    const ordersInfo = rows.find((r) => r.service === "orders-api" && r.level === "INFO");

    expect(paymentsErrors?.count).toBe(3);
    expect(ordersInfo?.count).toBe(3);
  });

  it("excludes logs outside the [from, to) range", async () => {
    const rows = await aggregateByServiceAndLevel(pool, {
      from: new Date("2099-01-01T00:00:00Z"),
      to: new Date("2099-01-02T00:00:00Z"),
    });

    expect(rows).toEqual([]);
  });
});

describe("GET /api/logs/stats", () => {
  let pool: Pool;
  let app: FastifyInstance;

  beforeAll(async () => {
    pool = await createTestPool();
    app = buildApp(
      {
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
      },
      pool,
    );
    await app.ready();
  });

  beforeEach(async () => {
    await truncateAll(pool);
    await seedDatabase(pool);
  });

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  it("returns per service/level counts and a total for the range, normalized to UTC", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/logs/stats?from=2026-10-31T21:00:00-03:00&to=2026-11-02T00:00:00Z",
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.from).toBe("2026-11-01T00:00:00.000Z");
    expect(body.total).toBe(29);
    expect(body.groups).toContainEqual({ service: "payments-api", level: "ERROR", count: 3 });
    expect(body.groups).toContainEqual({ service: "orders-api", level: "WARN", count: 1 });
  });

  it("returns an empty result (not an error) for a valid range with no logs", async () => {
    const res = await app.inject({ method: "GET", url: "/api/logs/stats?from=2099-01-01T00:00:00Z&to=2099-01-02T00:00:00Z" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ total: 0, groups: [] });
  });

  it.each([
    ["missing range", "", "VALIDATION_ERROR"],
    ["missing to", "?from=2026-11-01T00:00:00Z", "VALIDATION_ERROR"],
    ["inverted range", "?from=2026-11-02T00:00:00Z&to=2026-11-01T00:00:00Z", "INVALID_RANGE"],
    ["impossible date", "?from=2026-02-30T00:00:00Z&to=2026-03-02T00:00:00Z", "INVALID_TIMESTAMP"],
  ])("rejects %s with 400", async (_name, query, code) => {
    const res = await app.inject({ method: "GET", url: `/api/logs/stats${query}` });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe(code);
  });
});
