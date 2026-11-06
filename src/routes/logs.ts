import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import type { AppConfig } from "../config.js";
import { badRequest } from "../errors.js";
import { insertLog, listLogs } from "../logs/repository.js";
import { getLogsQuerySchema, postLogBodySchema } from "../logs/schema.js";
import type { ListLogsFilters, LogLevel, NewLog } from "../logs/types.js";

interface PostLogBody {
  service: string;
  level: LogLevel;
  message: string;
  timestamp: string;
}

interface GetLogsQuery {
  service?: string;
  level?: LogLevel;
  from?: string;
  to?: string;
  limit?: number;
}

function assertValidTimestamp(value: string): void {
  if (Number.isNaN(Date.parse(value))) {
    throw badRequest("INVALID_TIMESTAMP", `"${value}" is not a valid calendar date/time.`);
  }
}

export function registerLogsRoutes(app: FastifyInstance, pool: Pool, config: AppConfig): void {
  app.post<{ Body: PostLogBody }>(
    "/api/logs",
    { schema: { body: postLogBodySchema } },
    async (request, reply) => {
      const { service, level, message, timestamp } = request.body;
      assertValidTimestamp(timestamp);

      const log: NewLog = { service, level, message, timestamp };
      const created = await insertLog(pool, log);
      return reply.code(201).send(created);
    },
  );

  app.get<{ Querystring: GetLogsQuery }>(
    "/api/logs",
    { schema: { querystring: getLogsQuerySchema(config.logsMaxLimit) } },
    async (request, reply) => {
      const { service, level, from, to, limit } = request.query;
      if (from !== undefined) assertValidTimestamp(from);
      if (to !== undefined) assertValidTimestamp(to);

      const filters: ListLogsFilters = {
        ...(service !== undefined ? { service } : {}),
        ...(level !== undefined ? { level } : {}),
        ...(from !== undefined ? { from } : {}),
        ...(to !== undefined ? { to } : {}),
        limit: limit ?? config.logsDefaultLimit,
      };

      const logs = await listLogs(pool, filters);
      return reply.code(200).send(logs);
    },
  );
}
