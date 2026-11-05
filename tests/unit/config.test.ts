import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config/env.js';

const DATABASE_URL = 'postgres://user:s3cret@localhost:5432/smartlog';

describe('loadConfig', () => {
  it('applies defaults when only the required variable is set', () => {
    expect(loadConfig({ DATABASE_URL })).toEqual({
      DATABASE_URL,
      HOST: '0.0.0.0',
      PORT: 3000,
      LOG_LEVEL: 'info',
    });
  });

  it('converts PORT from text to a number', () => {
    expect(loadConfig({ DATABASE_URL, PORT: '8080' }).PORT).toBe(8080);
  });

  it('fails when DATABASE_URL is missing', () => {
    expect(() => loadConfig({})).toThrow(/DATABASE_URL/);
  });

  it('fails when DATABASE_URL is not a postgres URL', () => {
    expect(() => loadConfig({ DATABASE_URL: 'mysql://localhost/db' })).toThrow(/DATABASE_URL/);
  });

  it.each(['0', '65536', 'abc', '3000.5', ''])('fails when PORT is "%s"', (PORT) => {
    expect(() => loadConfig({ DATABASE_URL, PORT })).toThrow(/PORT/);
  });

  it('fails when LOG_LEVEL is not a known level', () => {
    expect(() => loadConfig({ DATABASE_URL, LOG_LEVEL: 'verbose' })).toThrow(/LOG_LEVEL/);
  });

  it('reports every invalid variable at once', () => {
    expect(() => loadConfig({ PORT: 'abc', LOG_LEVEL: 'verbose' })).toThrow(
      /DATABASE_URL.*PORT.*LOG_LEVEL/,
    );
  });

  it('never includes the password in the error message', () => {
    let message = '';
    try {
      loadConfig({ DATABASE_URL: 'mysql://user:s3cret@localhost/db' });
    } catch (err) {
      message = (err as Error).message;
    }

    expect(message).toContain('DATABASE_URL');
    expect(message).not.toContain('s3cret');
  });
});
