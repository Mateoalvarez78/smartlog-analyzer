import { Pool } from "pg";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../../src/app.js";
import type { AppConfig } from "../../src/config.js";
import { createTestPool, testDatabaseUrl } from "./helpers/db.js";

const BASE_CONFIG: Omit<AppConfig, "databaseUrl"> = {
  nodeEnv: "test",
  host: "127.0.0.1",
  port: 0,
  logLevel: "silent",
  healthDbTimeoutMs: 500,
  analysisAdapter: "mock",
  analysisTimeoutMs: 5000,
  analysisMaxLogs: 100,
  analysisMaxBytes: 200_000,
  logsDefaultLimit: 50,
  logsMaxLimit: 500,
};

describe("GET /api/health", () => {
  describe("when the database is reachable", () => {
    let pool: Pool;
    let app: FastifyInstance;

    beforeAll(async () => {
      pool = await createTestPool();
      app = buildApp({ ...BASE_CONFIG, databaseUrl: testDatabaseUrl() }, pool);
      await app.ready();
    });

    afterAll(async () => {
      await app.close();
      await pool.end();
    });

    it("returns 200 with a database:ok check", async () => {
      const response = await app.inject({ method: "GET", url: "/api/health" });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ status: "ok", checks: { database: "ok" } });
    });
  });

  describe("when the database is unreachable", () => {
    let pool: Pool;
    let app: FastifyInstance;

    beforeAll(async () => {
      // Port 1 refuses the connection immediately instead of relying on a
      // long OS-level timeout, keeping this test fast and deterministic.
      const unreachableUrl = "postgresql://user:pass@127.0.0.1:1/does-not-matter";
      pool = new Pool({ connectionString: unreachableUrl, connectionTimeoutMillis: 300 });
      app = buildApp({ ...BASE_CONFIG, databaseUrl: unreachableUrl, healthDbTimeoutMs: 300 }, pool);
      await app.ready();
    });

    afterAll(async () => {
      await app.close();
      await pool.end();
    });

    it("returns 503 within the configured time budget", async () => {
      const startedAt = Date.now();
      const response = await app.inject({ method: "GET", url: "/api/health" });
      const elapsedMs = Date.now() - startedAt;

      expect(response.statusCode).toBe(503);
      expect(response.json()).toEqual({ status: "unavailable", checks: { database: "unavailable" } });
      expect(elapsedMs).toBeLessThan(2000);
    });
  });
});
