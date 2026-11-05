import { Pool } from 'pg';
import type { Logger } from 'pino';

const CONNECTION_TIMEOUT_MS = 3_000;
const QUERY_TIMEOUT_MS = 5_000;

/**
 * Creates the shared connection pool.
 *
 * Both timeouts make a stuck database surface as an error instead of a request that hangs.
 *
 * The `error` listener is required: when the database drops an idle connection, `pg` emits
 * that event, and without a listener Node treats it as uncaught and kills the process.
 */
export function createPool(databaseUrl: string, logger: Logger): Pool {
  const pool = new Pool({
    connectionString: databaseUrl,
    connectionTimeoutMillis: CONNECTION_TIMEOUT_MS,
    query_timeout: QUERY_TIMEOUT_MS,
  });

  pool.on('error', (err) => {
    logger.error({ err }, 'Idle database connection failed');
  });

  return pool;
}

/** Rejects when the database cannot answer a trivial query within the timeouts. */
export async function pingDatabase(pool: Pool): Promise<void> {
  await pool.query('SELECT 1');
}
