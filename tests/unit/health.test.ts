import { pino } from 'pino';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import type { DatabaseCheck } from '../../src/api/health.js';

const silentLogger = pino({ level: 'silent' });

describe('GET /api/health', () => {
  let app: FastifyInstance;

  const startApp = (checkDatabase: DatabaseCheck): FastifyInstance => {
    app = buildApp({ logger: silentLogger, checkDatabase });
    return app;
  };

  afterEach(async () => {
    await app.close();
  });

  it('responds 200 when the database answers', async () => {
    const response = await startApp(async () => {}).inject({
      method: 'GET',
      url: '/api/health',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok', checks: { database: 'ok' } });
  });

  it('responds 503 when the database does not answer', async () => {
    const response = await startApp(async () => {
      throw new Error('connection refused');
    }).inject({ method: 'GET', url: '/api/health' });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({
      status: 'unavailable',
      checks: { database: 'unavailable' },
    });
  });

  it('does not expose the cause of the failure', async () => {
    const response = await startApp(async () => {
      throw new Error('password authentication failed for user "admin" at 10.0.0.5');
    }).inject({ method: 'GET', url: '/api/health' });

    expect(response.body).not.toContain('admin');
    expect(response.body).not.toContain('10.0.0.5');
  });

  it('checks the database on every request instead of caching the result', async () => {
    const checkDatabase = vi
      .fn<DatabaseCheck>()
      .mockResolvedValueOnce()
      .mockRejectedValueOnce(new Error('down'));
    const server = startApp(checkDatabase);

    const first = await server.inject({ method: 'GET', url: '/api/health' });
    const second = await server.inject({ method: 'GET', url: '/api/health' });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(503);
  });

  it('rejects other HTTP methods', async () => {
    const response = await startApp(async () => {}).inject({
      method: 'POST',
      url: '/api/health',
    });

    expect(response.statusCode).toBe(404);
  });
});
