import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../../src/app.js";
import { LlmAnalysisAdapter } from "../../src/analysis/llm/llm-adapter.js";
import { MockLlmClient } from "../../src/analysis/llm/mock-llm-client.js";
import type { LlmClient } from "../../src/analysis/llm/types.js";
import type { AnalysisAdapter } from "../../src/analysis/types.js";
import type { AppConfig } from "../../src/config.js";
import { seedDatabase } from "../../db/seed.js";
import { createTestPool, testDatabaseUrl, truncateAll } from "./helpers/db.js";
import {
  FixedTextLlmClient,
  MalformedTestAdapter,
  SlowLlmClient,
  NeverRespondingInTimeTestAdapter,
  OversizedAdapterNameTestAdapter,
  ThrowingTestAdapter,
  ValidTestAdapter,
} from "./helpers/test-adapters.js";

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const BASE_CONFIG: AppConfig = {
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

// Covers the full seeded window (db/seed.ts): 2026-11-01, all 29 rows.
const FULL_SEED_RANGE = { from: "2026-11-01T00:00:00Z", to: "2026-11-02T00:00:00Z" };

describe("POST /api/logs/analyze + GET /api/analysis/:id", () => {
  let pool: Pool;
  const apps: FastifyInstance[] = [];

  beforeAll(async () => {
    pool = await createTestPool();
  });

  beforeEach(async () => {
    await truncateAll(pool);
    await seedDatabase(pool);
  });

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  async function appWith(overrides: Partial<AppConfig> = {}, adapter: AnalysisAdapter = new ValidTestAdapter()) {
    const app = buildApp({ ...BASE_CONFIG, ...overrides }, pool, adapter);
    await app.ready();
    apps.push(app);
    return app;
  }

  it("accepts a valid batch, persists it, and the result is retrievable by id", async () => {
    const app = await appWith();

    const analyzeRes = await app.inject({ method: "POST", url: "/api/logs/analyze", payload: FULL_SEED_RANGE });
    expect(analyzeRes.statusCode).toBe(201);
    expect(analyzeRes.headers.location).toMatch(/^\/api\/analysis\/[0-9a-f-]{36}$/);

    const body = analyzeRes.json();
    expect(body).toMatchObject({ status: "succeeded", adapter: "test-valid", result: { summary: "ok" } });
    expect(body.logIds).toHaveLength(29);

    const getRes = await app.inject({ method: "GET", url: `/api/analysis/${body.id}` });
    expect(getRes.statusCode).toBe(200);
    expect(getRes.json()).toEqual(body);
  });

  it("rejects an empty batch with 422 and does not persist anything", async () => {
    const app = await appWith();
    const res = await app.inject({
      method: "POST",
      url: "/api/logs/analyze",
      payload: { from: "2099-01-01T00:00:00Z", to: "2099-01-02T00:00:00Z" },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("EMPTY_BATCH");

    const { rows } = await pool.query("SELECT COUNT(*)::int AS count FROM analyses");
    expect(rows[0]?.count).toBe(0);
  });

  it("rejects a batch exceeding the configured row limit with 422, without calling the adapter", async () => {
    const app = await appWith({ analysisMaxLogs: 2 });
    const res = await app.inject({ method: "POST", url: "/api/logs/analyze", payload: FULL_SEED_RANGE });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("BATCH_TOO_LARGE");

    const { rows } = await pool.query("SELECT COUNT(*)::int AS count FROM analyses");
    expect(rows[0]?.count).toBe(0);
  });

  it("rejects a batch exceeding the configured byte limit with 422", async () => {
    const app = await appWith({ analysisMaxBytes: 50 });
    const res = await app.inject({ method: "POST", url: "/api/logs/analyze", payload: FULL_SEED_RANGE });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("BATCH_TOO_LARGE_BYTES");
  });

  it("returns 502 and a consultable id when the adapter throws", async () => {
    const app = await appWith({}, new ThrowingTestAdapter());
    const res = await app.inject({ method: "POST", url: "/api/logs/analyze", payload: FULL_SEED_RANGE });

    expect(res.statusCode).toBe(502);
    const body = res.json();
    expect(body.error.code).toBe("ADAPTER_ERROR");
    expect(body.analysisId).toMatch(/^[0-9a-f-]{36}$/);

    const getRes = await app.inject({ method: "GET", url: `/api/analysis/${body.analysisId}` });
    expect(getRes.statusCode).toBe(200);
    expect(getRes.json()).toMatchObject({ status: "failed", errorCode: "ADAPTER_ERROR", result: null });
  });

  it("returns 502 when the adapter's output fails validation (evidence id outside the batch)", async () => {
    const app = await appWith({}, new MalformedTestAdapter());
    const res = await app.inject({ method: "POST", url: "/api/logs/analyze", payload: FULL_SEED_RANGE });

    expect(res.statusCode).toBe(502);
    expect(res.json().error.code).toBe("INVALID_ADAPTER_OUTPUT");
  });

  it("returns 504 within the configured budget when the adapter ignores the timeout, and a later response never overwrites the persisted outcome", async () => {
    const app = await appWith({ analysisTimeoutMs: 50 }, new NeverRespondingInTimeTestAdapter(300));

    const startedAt = Date.now();
    const res = await app.inject({ method: "POST", url: "/api/logs/analyze", payload: FULL_SEED_RANGE });
    const elapsedMs = Date.now() - startedAt;

    expect(res.statusCode).toBe(504);
    expect(elapsedMs).toBeLessThan(250);
    const body = res.json();
    expect(body.error.code).toBe("ADAPTER_TIMEOUT");

    // The adapter resolves ~300ms after the request started; wait past that
    // and confirm the persisted row is still the timeout failure, not the
    // adapter's late "success".
    await delay(350);
    const getRes = await app.inject({ method: "GET", url: `/api/analysis/${body.analysisId}` });
    expect(getRes.json()).toMatchObject({ status: "failed", errorCode: "ADAPTER_TIMEOUT", result: null });
  });

  it("returns 500 without an analysisId when persistence itself fails after the adapter succeeded", async () => {
    // A genuine PostgreSQL CHECK-constraint violation on the terminal
    // INSERT (adapter.name too long), not a mocked database — see
    // OversizedAdapterNameTestAdapter.
    const app = await appWith({}, new OversizedAdapterNameTestAdapter());
    const res = await app.inject({ method: "POST", url: "/api/logs/analyze", payload: FULL_SEED_RANGE });

    expect(res.statusCode).toBe(500);
    const body = res.json();
    expect(body.error.code).toBe("INTERNAL_ERROR");
    expect(body).not.toHaveProperty("analysisId");
  });

  describe("through the LLM adapter (raw text from the model)", () => {
    const llm = (client: LlmClient) => new LlmAnalysisAdapter(client);

    it("analyzes the seed end-to-end with the default mock LLM and persists the categories", async () => {
      const app = await appWith({}, llm(new MockLlmClient()));
      const res = await app.inject({ method: "POST", url: "/api/logs/analyze", payload: FULL_SEED_RANGE });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.adapter).toBe("llm:mock-v1");
      expect(body.result.categories.map((c: { name: string }) => c.name)).toEqual(
        expect.arrayContaining(["connection_errors", "delivery_failures", "upstream_timeouts", "validation_errors", "rate_limiting"]),
      );
      expect(body.result.suggestions.length).toBe(body.result.categories.length);
    });

    it("accepts a valid answer wrapped in a ```json fence", async () => {
      const answer = "```json\n" + JSON.stringify({ summary: "fine", categories: [], suggestions: [] }) + "\n```";
      const app = await appWith({}, llm(new FixedTextLlmClient(answer)));
      const res = await app.inject({ method: "POST", url: "/api/logs/analyze", payload: FULL_SEED_RANGE });
      expect(res.statusCode).toBe(201);
      expect(res.json().result.summary).toBe("fine");
    });

    it.each([
      ["prose instead of JSON", "Sure! The logs show some connection problems."],
      ["truncated JSON", '{"summary":"Found 3 connection err'],
      ["JSON missing required fields", '{"summary":"ok"}'],
      ["JSON with the wrong types", '{"summary":"ok","categories":"none","suggestions":[]}'],
    ])("returns 502 INVALID_ADAPTER_OUTPUT and persists the failure for %s", async (_name, answer) => {
      const app = await appWith({}, llm(new FixedTextLlmClient(answer)));
      const res = await app.inject({ method: "POST", url: "/api/logs/analyze", payload: FULL_SEED_RANGE });

      expect(res.statusCode).toBe(502);
      expect(res.json().error.code).toBe("INVALID_ADAPTER_OUTPUT");

      const getRes = await app.inject({ method: "GET", url: `/api/analysis/${res.json().analysisId}` });
      expect(getRes.json()).toMatchObject({ status: "failed", errorCode: "INVALID_ADAPTER_OUTPUT", result: null });
    });

    it("returns 504 when the model takes longer than the timeout", async () => {
      const app = await appWith({ analysisTimeoutMs: 50 }, llm(new SlowLlmClient(300)));
      const res = await app.inject({ method: "POST", url: "/api/logs/analyze", payload: FULL_SEED_RANGE });
      expect(res.statusCode).toBe(504);
      expect(res.json().error.code).toBe("ADAPTER_TIMEOUT");
    });
  });

  it("rejects an invalid analysis id with 400", async () => {
    const app = await appWith();
    const res = await app.inject({ method: "GET", url: "/api/analysis/not-a-uuid" });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("INVALID_ANALYSIS_ID");
  });

  it("returns 404 for a well-formed id that doesn't exist", async () => {
    const app = await appWith();
    const res = await app.inject({ method: "GET", url: "/api/analysis/00000000-0000-4000-8000-000000000000" });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("ANALYSIS_NOT_FOUND");
  });

  it("rejects from >= to with 400 INVALID_RANGE, not 422 EMPTY_BATCH", async () => {
    const app = await appWith();
    const res = await app.inject({
      method: "POST",
      url: "/api/logs/analyze",
      payload: { from: FULL_SEED_RANGE.to, to: FULL_SEED_RANGE.from },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("INVALID_RANGE");
  });

  it("rejects a request missing the required from/to fields", async () => {
    const app = await appWith();
    const res = await app.inject({ method: "POST", url: "/api/logs/analyze", payload: { service: "payments-api" } });
    expect(res.statusCode).toBe(400);
  });
});
