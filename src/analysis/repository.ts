import type { Pool, QueryResultRow } from "pg";
import type { AnalysisOutput, AnalysisRecord, AnalysisStatus } from "./types.js";

interface AnalysisRow extends QueryResultRow {
  id: string;
  created_at: Date;
  adapter: string;
  log_ids: string[];
  status: AnalysisStatus;
  result: AnalysisOutput | null;
  error_code: string | null;
}

function toRecord(row: AnalysisRow): AnalysisRecord {
  return {
    id: row.id,
    createdAt: row.created_at.toISOString(),
    adapter: row.adapter,
    logIds: row.log_ids,
    status: row.status,
    result: row.result,
    errorCode: row.error_code,
  };
}

export type NewAnalysis =
  | { adapter: string; logIds: string[]; status: "succeeded"; result: AnalysisOutput }
  | { adapter: string; logIds: string[]; status: "failed"; errorCode: string };

/**
 * Exactly one row per accepted analysis attempt (ARCHITECTURE.md §6): the
 * orchestrator calls this once, after the adapter has already settled
 * (succeeded, failed, or timed out) — never before, and never twice for the
 * same attempt.
 */
export async function insertAnalysis(pool: Pool, input: NewAnalysis): Promise<AnalysisRecord> {
  const result = input.status === "succeeded" ? input.result : null;
  const errorCode = input.status === "failed" ? input.errorCode : null;

  const { rows } = await pool.query<AnalysisRow>(
    `INSERT INTO analyses (adapter, log_ids, status, result, error_code)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, created_at, adapter, log_ids, status, result, error_code`,
    [input.adapter, input.logIds, input.status, result ? JSON.stringify(result) : null, errorCode],
  );
  const row = rows[0];
  if (!row) throw new Error("INSERT INTO analyses did not return a row");
  return toRecord(row);
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidAnalysisId(id: string): boolean {
  return UUID_PATTERN.test(id);
}

export async function getAnalysisById(pool: Pool, id: string): Promise<AnalysisRecord | null> {
  const { rows } = await pool.query<AnalysisRow>(
    `SELECT id, created_at, adapter, log_ids, status, result, error_code
     FROM analyses
     WHERE id = $1`,
    [id],
  );
  const row = rows[0];
  return row ? toRecord(row) : null;
}
