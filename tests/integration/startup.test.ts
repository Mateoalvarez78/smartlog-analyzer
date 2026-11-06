import type { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { seedDatabase } from "../../db/seed.js";
import { runMigrations } from "../../src/db/migrate.js";
import { createTestPool, truncateAll } from "./helpers/db.js";

describe("startup: migrations and seed", () => {
  let pool: Pool;

  beforeAll(async () => {
    pool = await createTestPool();
  });

  beforeEach(async () => {
    await truncateAll(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  it("starts from a clean database and creates the expected tables", async () => {
    const { rows } = await pool.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name`,
    );
    const tableNames = rows.map((r) => r.table_name);
    expect(tableNames).toEqual(expect.arrayContaining(["logs", "analyses", "schema_migrations"]));
  });

  it("re-running migrations on an already-migrated database is a no-op", async () => {
    const applied = await runMigrations(pool);
    expect(applied).toEqual([]);
  });

  it("re-running the seed does not duplicate rows", async () => {
    const first = await seedDatabase(pool);
    expect(first.inserted).toBeGreaterThan(0);

    const second = await seedDatabase(pool);
    expect(second.inserted).toBe(0);
    expect(second.alreadyPresent).toBe(first.inserted);

    const { rows } = await pool.query<{ count: string }>("SELECT COUNT(*)::text AS count FROM logs");
    expect(Number(rows[0]?.count)).toBe(first.inserted);
  });
});
