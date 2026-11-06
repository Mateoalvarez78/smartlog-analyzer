import type { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { seedDatabase } from "../../db/seed.js";
import { aggregateByServiceAndLevel } from "../../src/logs/repository.js";
import { createTestPool, truncateAll } from "./helpers/db.js";

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
