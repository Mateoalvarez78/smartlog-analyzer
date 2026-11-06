import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { Pool } from "pg";
import { loadConfig } from "../config.js";

const MIGRATIONS_DIR = path.join(process.cwd(), "db", "migrations");

/**
 * Minimal forward-only migration runner: applies db/migrations/*.sql files in
 * filename order, each inside its own transaction, and records applied
 * filenames in schema_migrations so re-running on an already-migrated
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

  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith(".sql")).sort();
  const { rows } = await pool.query<{ filename: string }>("SELECT filename FROM schema_migrations");
  const applied = new Set(rows.map((r) => r.filename));

  const newlyApplied: string[] = [];
  for (const file of files) {
    if (applied.has(file)) continue;

    const sql = await readFile(path.join(MIGRATIONS_DIR, file), "utf8");
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
