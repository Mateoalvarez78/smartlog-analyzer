import { resolve } from 'node:path';
import { runner } from 'node-pg-migrate';
import type { Logger } from 'pino';

// Same relative path from src/db (tests, tsx) and from dist/db (container).
const MIGRATIONS_DIR = resolve(import.meta.dirname, '../../db/migrations');

/**
 * Applies pending migrations and returns the names of the ones that ran.
 *
 * `wait` makes a second instance starting at the same time wait for the lock instead of
 * failing. By then the migrations are applied, so it finds nothing left to do.
 */
export async function runMigrations(databaseUrl: string, logger: Logger): Promise<string[]> {
  const applied = await runner({
    databaseUrl,
    dir: MIGRATIONS_DIR,
    migrationsTable: 'schema_migrations',
    direction: 'up',
    checkOrder: true,
    advisoryLockMode: 'wait',
    log: (message) => logger.debug(message),
  });

  return applied.map((migration) => migration.name);
}
