import { Pool } from "pg";
import { loadConfig } from "../config.js";
import { migrations } from "../../db/migrations/index.js";

/**
 * Minimal forward-only migration runner: applies the migrations listed in
 * db/migrations/index.ts in order, each inside its own transaction, and records applied
 * migration names in schema_migrations so re-running on an already-migrated
 * database is a no-op. No external migration library: the project only
 * needs ordered SQL application, not rollback tooling.
 */
export async function runMigrations(pool: Pool): Promise<string[]> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename    text PRIMARY KEY,
      applied_at  timestamptz NOT NULL DEFAULT now()
    )
  `);

  const { rows } = await pool.query<{ filename: string }>("SELECT filename FROM schema_migrations");
  const applied = new Set(rows.map((r) => r.filename));

  const newlyApplied: string[] = [];
  for (const { name: file, sql } of migrations) {
    if (applied.has(file)) continue;

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations (filename) VALUES ($1)", [file]);
      await client.query("COMMIT");
      newlyApplied.push(file);
    } catch (error) {
      await client.query("ROLLBACK");
      throw new Error(`Migration ${file} failed: ${(error as Error).message}`);
    } finally {
      client.release();
    }
  }

  return newlyApplied;
}

async function main(): Promise<void> {
  const config = loadConfig();
  const pool = new Pool({ connectionString: config.databaseUrl });
  try {
    const applied = await runMigrations(pool);
    if (applied.length === 0) {
      console.log("No pending migrations.");
    } else {
      console.log(`Applied ${applied.length} migration(s): ${applied.join(", ")}`);
    }
  } finally {
    await pool.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
