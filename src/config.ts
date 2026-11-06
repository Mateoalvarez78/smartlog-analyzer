export interface AppConfig {
  nodeEnv: "development" | "test" | "production";
  host: string;
  port: number;
  databaseUrl: string;
  logLevel: string;
  healthDbTimeoutMs: number;
  analysisAdapter: "mock";
  analysisTimeoutMs: number;
  analysisMaxLogs: number;
  analysisMaxBytes: number;
  logsDefaultLimit: number;
  logsMaxLimit: number;
}

class ConfigError extends Error {}

function requireString(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key];
  if (!value || value.trim() === "") {
    throw new ConfigError(`Missing required environment variable: ${key}`);
  }
  return value;
}

function optionalInt(env: NodeJS.ProcessEnv, key: string, fallback: number): number {
  const raw = env[key];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new ConfigError(`Invalid environment variable ${key}: expected a positive integer, got "${raw}"`);
  }
  return value;
}

function optionalString(env: NodeJS.ProcessEnv, key: string, fallback: string): string {
  const raw = env[key];
  return raw === undefined || raw === "" ? fallback : raw;
}

/**
 * Parses and validates process.env once at startup. Failing fast here means a
 * misconfigured container never accepts traffic with a half-broken setup.
 * Errors never echo the offending value, only the variable name.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const nodeEnvRaw = optionalString(env, "NODE_ENV", "development");
  if (nodeEnvRaw !== "development" && nodeEnvRaw !== "test" && nodeEnvRaw !== "production") {
    throw new ConfigError(`Invalid environment variable NODE_ENV: expected development|test|production, got "${nodeEnvRaw}"`);
  }

  return {
    nodeEnv: nodeEnvRaw,
    host: optionalString(env, "HOST", "0.0.0.0"),
    port: optionalInt(env, "PORT", 3000),
    databaseUrl: requireString(env, "DATABASE_URL"),
    logLevel: optionalString(env, "LOG_LEVEL", "info"),
    healthDbTimeoutMs: optionalInt(env, "HEALTH_DB_TIMEOUT_MS", 1000),
    analysisAdapter: "mock",
    analysisTimeoutMs: optionalInt(env, "ANALYSIS_TIMEOUT_MS", 5000),
    analysisMaxLogs: optionalInt(env, "ANALYSIS_MAX_LOGS", 100),
    analysisMaxBytes: optionalInt(env, "ANALYSIS_MAX_BYTES", 200_000),
    logsDefaultLimit: optionalInt(env, "LOGS_DEFAULT_LIMIT", 50),
    logsMaxLimit: optionalInt(env, "LOGS_MAX_LIMIT", 500),
  };
}

export { ConfigError };
