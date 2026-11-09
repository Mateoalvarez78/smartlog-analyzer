import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import type { AppConfig } from "../config.js";
import { aggregateByServiceAndLevel, insertLog, listLogs } from "../logs/repository.js";
import { getLogStatsQuerySchema, getLogsQuerySchema, postLogBodySchema } from "../logs/schema.js";
import type { ListLogsFilters, LogLevel, NewLog } from "../logs/types.js";
import { assertValidRange, assertValidTimestamp } from "../time.js";

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

  app.get<{ Querystring: { from: string; to: string } }>(
    "/api/logs/stats",
    { schema: { querystring: getLogStatsQuerySchema } },
    async (request, reply) => {
      const { from, to } = request.query;
      assertValidTimestamp(from);
      assertValidTimestamp(to);
      assertValidRange(from, to);

      const groups = await aggregateByServiceAndLevel(pool, { from: new Date(from), to: new Date(to) });
      const total = groups.reduce((sum, group) => sum + group.count, 0);
      return reply.code(200).send({ from: new Date(from).toISOString(), to: new Date(to).toISOString(), total, groups });
    },
  );

  app.get<{ Querystring: GetLogsQuery }>(
    "/api/logs",
    { schema: { querystring: getLogsQuerySchema(config.logsMaxLimit) } },
    async (request, reply) => {
      const { service, level, from, to, limit } = request.query;
      if (from !== undefined) assertValidTimestamp(from);
      if (to !== undefined) assertValidTimestamp(to);
      if (from !== undefined && to !== undefined) assertValidRange(from, to);

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
