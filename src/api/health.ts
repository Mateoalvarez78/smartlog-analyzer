import type { FastifyInstance } from 'fastify';

export type DatabaseCheck = () => Promise<void>;

/**
 * Registers `GET /api/health`.
 *
 * It reports a state rather than a request error, so 200 and 503 share one body shape.
 * It does not call the LLM: that would cost money, and logs can still be ingested while
 * the provider is down. The cause of a failure goes to the logs, not to the response.
 */
export function registerHealthRoutes(app: FastifyInstance, checkDatabase: DatabaseCheck): void {
  app.get('/api/health', async (request, reply) => {
    try {
      await checkDatabase();
      return { status: 'ok', checks: { database: 'ok' } };
    } catch (err) {
      request.log.error({ err }, 'Health check failed');
      return reply
        .code(503)
        .send({ status: 'unavailable', checks: { database: 'unavailable' } });
    }
  });
}
