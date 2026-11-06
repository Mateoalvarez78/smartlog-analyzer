import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createPool } from "./db.js";

const config = loadConfig();
const pool = createPool(config);
const app = buildApp(config, pool);

async function shutdown(signal: string): Promise<void> {
  app.log.info({ signal }, "shutting down");
  await app.close();
  await pool.end();
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

try {
  await app.listen({ host: config.host, port: config.port });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
