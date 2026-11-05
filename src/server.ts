import { pino } from 'pino';
import { buildApp } from './app.js';
import { loadConfig } from './config/env.js';
import { runMigrations } from './db/migrate.js';
import { createPool, pingDatabase } from './db/pool.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = pino({ level: config.LOG_LEVEL });

  const applied = await runMigrations(config.DATABASE_URL, logger);
  logger.info({ applied }, 'Migrations up to date');

  const pool = createPool(config.DATABASE_URL, logger);
  const app = buildApp({ logger, checkDatabase: () => pingDatabase(pool) });

  // The order matters: stop taking requests first, then close what they depend on.
  const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
    logger.info({ signal }, 'Shutting down');
    try {
      await app.close();
      await pool.end();
      process.exit(0);
    } catch (err) {
      logger.error({ err }, 'Shutdown failed');
      process.exit(1);
    }
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);

  await app.listen({ host: config.HOST, port: config.PORT });
}

main().catch((err: unknown) => {
  // The logger may not exist yet if the configuration is what failed.
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
