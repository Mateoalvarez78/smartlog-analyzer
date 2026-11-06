import { Pool } from "pg";
import { runMigrations } from "../../../src/db/migrate.js";

/**
 * Integration tests run against a real PostgreSQL instance, never a mock or
 * in-memory simulation (see ARCHITECTURE.md §5: SQL is explicit and its
 * real behavior — constraints, JSONB, arrays — is part of what's tested).
 *
 * Point TEST_DATABASE_URL at a disposable database (the docker-compose `db`
 * service works via docker-compose.dev.yml, or any local Postgres). Falling
 * back to DATABASE_URL keeps a single env var working in CI-less setups.
 */
export function testDatabaseUrl(): string {
  const url = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "TEST_DATABASE_URL (or DATABASE_URL) must point at a disposable PostgreSQL instance to run integration tests.",
    );
  }
  return url;
}

let migrated = false;

/** Creates a pool for the test database and ensures migrations ran once per test run. */
export async function createTestPool(): Promise<Pool> {
  const pool = new Pool({ connectionString: testDatabaseUrl() });
  if (!migrated) {
    await runMigrations(pool);
    migrated = true;
  }
  return pool;
}

/** Isolates a test from rows left by earlier tests without re-running migrations. */
export async function truncateAll(pool: Pool): Promise<void> {
  await pool.query("TRUNCATE TABLE analyses, logs RESTART IDENTITY CASCADE");
}
