import { createServer } from 'node:net';
import type { AddressInfo, Server, Socket } from 'node:net';
import { pino } from 'pino';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { createPool, pingDatabase } from '../../src/db/pool.js';

const silentLogger = pino({ level: 'silent' });

// Connection timeout in pool.ts plus some margin. Far below the time a hung connection would take.
const MAX_EXPECTED_MS = 4_000;

describe('a database that accepts connections but never answers', () => {
  let silentServer: Server;
  let pool: Pool;
  const sockets: Socket[] = [];

  beforeEach(async () => {
    silentServer = createServer((socket) => {
      sockets.push(socket);
    });
    await new Promise<void>((resolve) => silentServer.listen(0, '127.0.0.1', resolve));
    const { port } = silentServer.address() as AddressInfo;
    pool = createPool(`postgres://user:pass@127.0.0.1:${port}/db`, silentLogger);
  });

  afterEach(async () => {
    sockets.forEach((socket) => socket.destroy());
    await pool.end();
    await new Promise((resolve) => silentServer.close(resolve));
  });

  it('fails within the timeout instead of hanging', async () => {
    const startedAt = Date.now();

    await expect(pingDatabase(pool)).rejects.toThrow(/timeout/i);

    expect(Date.now() - startedAt).toBeLessThan(MAX_EXPECTED_MS);
  });
});
