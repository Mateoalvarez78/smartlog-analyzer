import { pino } from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { buildApp } from '../../src/app.js';
import { runMigrations } from '../../src/db/migrate.js';
import { createPool, pingDatabase } from '../../src/db/pool.js';
import { startPostgres } from './helpers/postgres.js';

const silentLogger = pino({ level: 'silent' });

describe('startup against a real database', () => {
  let container: StartedPostgreSqlContainer;
  let pool: Pool;
  let app: FastifyInstance;
  let databaseUrl: string;

  beforeAll(async () => {
    container = await startPostgres();
    databaseUrl = container.getConnectionUri();
    pool = createPool(databaseUrl, silentLogger);
    app = buildApp({ logger: silentLogger, checkDatabase: () => pingDatabase(pool) });
  });

  afterAll(async () => {
    await app?.close();
    await pool?.end();
    await container?.stop();
  });

  it('applies the migrations on an empty database', async () => {
    const applied = await runMigrations(databaseUrl, silentLogger);

    expect(applied).toContain('0001_create_logs');
    const { rows } = await pool.query(`SELECT to_regclass('public.logs') AS name`);
    expect(rows[0].name).toBe('logs');
  });

  it('does nothing when the migrations were already applied', async () => {
    await expect(runMigrations(databaseUrl, silentLogger)).resolves.toEqual([]);
  });

  it('lets two instances start at the same time', async () => {
    const results = await Promise.all([
      runMigrations(databaseUrl, silentLogger),
      runMigrations(databaseUrl, silentLogger),
    ]);

    expect(results).toEqual([[], []]);
  });

  it('rejects a log with a level outside the allowed values', async () => {
    const insert = pool.query(
      `INSERT INTO logs (service, level, message, "timestamp")
       VALUES ('billing', 'NOTICE', 'something happened', now())`,
    );

    await expect(insert).rejects.toThrow(/logs_level_check/);
  });

  it('reports healthy while the database is up', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/health' });

    expect(response.statusCode).toBe(200);
  });

  // Keep last: it stops the database shared by this file.
  it('reports unavailable and stays alive when the database goes down', async () => {
    await container.stop();

    const response = await app.inject({ method: 'GET', url: '/api/health' });

    expect(response.statusCode).toBe(503);
  });
});

describe('startup without a database', () => {
  it('fails instead of starting half configured', async () => {
    const unreachable = 'postgres://user:pass@127.0.0.1:1/none';

    await expect(runMigrations(unreachable, silentLogger)).rejects.toThrow();
  });
});
