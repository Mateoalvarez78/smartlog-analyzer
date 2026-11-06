import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { checkDatabase } from "../db.js";

export function registerHealthRoute(app: FastifyInstance, pool: Pool, dbTimeoutMs: number): void {
  app.get("/api/health", async (_request, reply) => {
    const databaseOk = await checkDatabase(pool, dbTimeoutMs);
    return reply.code(databaseOk ? 200 : 503).send({
      status: databaseOk ? "ok" : "unavailable",
      checks: { database: databaseOk ? "ok" : "unavailable" },
    });
  });
}
