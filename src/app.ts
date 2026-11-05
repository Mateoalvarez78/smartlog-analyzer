import Fastify from 'fastify';
import type { FastifyBaseLogger, FastifyInstance } from 'fastify';
import { registerHealthRoutes } from './api/health.js';
import type { DatabaseCheck } from './api/health.js';

export interface AppDependencies {
  logger: FastifyBaseLogger;
  checkDatabase: DatabaseCheck;
}

/**
 * Builds the HTTP application without opening a port.
 *
 * Dependencies come in as parameters so tests can inject requests and replace them with
 * fakes, without a server or a database.
 */
export function buildApp({ logger, checkDatabase }: AppDependencies): FastifyInstance {
  const app = Fastify({ loggerInstance: logger });

  registerHealthRoutes(app, checkDatabase);

  return app;
}
