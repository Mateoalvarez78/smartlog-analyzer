import type { Pool, QueryResultRow } from "pg";
import type { ListLogsFilters, LogRecord, NewLog } from "./types.js";

export interface ServiceLevelCount {
  service: string;
  level: string;
  count: number;
}

interface LogRow extends QueryResultRow {
  id: string;
  service: string;
  level: LogRecord["level"];
  message: string;
  timestamp: Date;
  created_at: Date;
}

function toLogRecord(row: LogRow): LogRecord {
  return {
    id: row.id,
    service: row.service,
    level: row.level,
    message: row.message,
    timestamp: row.timestamp.toISOString(),
    createdAt: row.created_at.toISOString(),
  };
}

export async function insertLog(pool: Pool, log: NewLog): Promise<LogRecord> {
  const { rows } = await pool.query<LogRow>(
    `INSERT INTO logs (service, level, message, "timestamp")
     VALUES ($1, $2, $3, $4)
     RETURNING id, service, level, message, "timestamp", created_at`,
    [log.service, log.level, log.message, log.timestamp],
  );
  const row = rows[0];
  if (!row) throw new Error("INSERT INTO logs did not return a row");
  return toLogRecord(row);
}

/**
 * Shared by GET /api/logs (Etapa 2) and the batch selection in
 * POST /api/logs/analyze (Etapa 3): same filters, same deterministic order
 * (timestamp DESC, id DESC), so the batch an analysis sees is exactly what
 * the equivalent listing would show. `limit` is the caller's responsibility
 * (the analyze endpoint requests maxLogs + 1 to detect an oversized batch).
 */
export async function listLogs(pool: Pool, filters: ListLogsFilters): Promise<LogRecord[]> {
  const conditions: string[] = [];
  const values: unknown[] = [];

  if (filters.service !== undefined) {
    values.push(filters.service);
    conditions.push(`service = $${values.length}`);
  }
  if (filters.level !== undefined) {
    values.push(filters.level);
    conditions.push(`level = $${values.length}`);
  }
  if (filters.from !== undefined) {
    values.push(filters.from);
    conditions.push(`"timestamp" >= $${values.length}`);
  }
  if (filters.to !== undefined) {
    values.push(filters.to);
    conditions.push(`"timestamp" < $${values.length}`);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  values.push(filters.limit);

  const { rows } = await pool.query<LogRow>(
    `SELECT id, service, level, message, "timestamp", created_at
     FROM logs
     ${where}
     ORDER BY "timestamp" DESC, id DESC
     LIMIT $${values.length}`,
    values,
  );

  return rows.map(toLogRecord);
}

/**
 * Aggregation required by the challenge ("al menos una consulta de
 * agregación"): count of logs per service and level within [from, to).
 * Exposed as GET /api/logs/stats. Served by the (service, level, timestamp)
 * index.
 */
export async function aggregateByServiceAndLevel(
  pool: Pool,
  range: { from: Date; to: Date },
): Promise<ServiceLevelCount[]> {
  const { rows } = await pool.query<ServiceLevelCount>(
    `SELECT service, level, COUNT(*)::int AS count
     FROM logs
     WHERE "timestamp" >= $1 AND "timestamp" < $2
     GROUP BY service, level
     ORDER BY service, level`,
    [range.from, range.to],
  );
  return rows;
}
