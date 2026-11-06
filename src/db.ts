import { Pool } from "pg";
import type { AppConfig } from "./config.js";

export function createPool(config: AppConfig): Pool {
  // Bounds connection acquisition too, not just query execution, so a
  // database that accepts no new connections fails the health budget
  // instead of hanging on pool.connect().
  return new Pool({ connectionString: config.databaseUrl, connectionTimeoutMillis: config.healthDbTimeoutMs });
}

/**
 * Bounded liveness check for GET /api/health. Races the connect+query
 * attempt against a hard timer so a stalled database (one that accepts a
 * TCP connection but never answers) can't hang the health check past the
 * budget the caller expects, even if the driver-level timeouts don't catch it.
 */
export async function checkDatabase(pool: Pool, timeoutMs: number): Promise<boolean> {
  const probe = (async () => {
    const client = await pool.connect();
    try {
      await client.query(`SET statement_timeout = ${timeoutMs}`);
      await client.query("SELECT 1");
      return true;
    } finally {
      client.release();
    }
  })().catch(() => false);

  const timeout = new Promise<false>((resolve) => {
    const timer = setTimeout(() => resolve(false), timeoutMs);
    timer.unref();
  });

  return Promise.race([probe, timeout]);
}
