import type { Pool } from "pg";
import type { AppConfig } from "../config.js";
import { listLogs } from "../logs/repository.js";
import type { ListLogsFilters } from "../logs/types.js";
import { insertAnalysis } from "./repository.js";
import { runWithTimeout, TIMEOUT } from "./run-with-timeout.js";
import type { AnalysisAdapter, AnalysisRecord } from "./types.js";
import { InvalidAdapterOutputError, validateAnalysisOutput } from "./validate-output.js";

export type AnalyzeFilters = Omit<ListLogsFilters, "limit">;

export type AnalyzeOutcome =
  | { outcome: "rejected"; code: "EMPTY_BATCH" | "BATCH_TOO_LARGE" | "BATCH_TOO_LARGE_BYTES"; message: string }
  | { outcome: "succeeded"; record: AnalysisRecord }
  | { outcome: "failed"; record: AnalysisRecord; httpStatus: 502 | 504 };

/**
 * Selects a bounded, deterministic batch, runs it through the adapter under
 * a hard timeout, and persists exactly one terminal row per accepted
 * attempt. See ARCHITECTURE.md §3/§4/§6 for the contract this implements.
 */
export interface AnalysisLogger {
  warn(obj: Record<string, unknown>, msg: string): void;
}

export async function runAnalysis(
  pool: Pool,
  config: AppConfig,
  adapter: AnalysisAdapter,
  filters: AnalyzeFilters,
  logger?: AnalysisLogger,
): Promise<AnalyzeOutcome> {
  // Same filters and order as GET /api/logs (src/logs/repository.ts), just
  // capped one row past the limit so an oversized batch can be detected
  // without a separate COUNT(*) query.
  const candidates = await listLogs(pool, { ...filters, limit: config.analysisMaxLogs + 1 });

  if (candidates.length === 0) {
    return { outcome: "rejected", code: "EMPTY_BATCH", message: "No logs match the given filters and range." };
  }
  if (candidates.length > config.analysisMaxLogs) {
    return {
      outcome: "rejected",
      code: "BATCH_TOO_LARGE",
      message: `The batch exceeds the maximum of ${config.analysisMaxLogs} logs; narrow the range or add filters.`,
    };
  }

  const batch = candidates;
  const batchBytes = Buffer.byteLength(JSON.stringify(batch), "utf8");
  if (batchBytes > config.analysisMaxBytes) {
    return {
      outcome: "rejected",
      code: "BATCH_TOO_LARGE_BYTES",
      message: `The serialized batch exceeds the ${config.analysisMaxBytes}-byte limit; narrow the range or add filters.`,
    };
  }

  const logIds = batch.map((log) => log.id);
  const batchLogIds = new Set(logIds);

  let settled: { status: "succeeded"; result: Awaited<ReturnType<AnalysisAdapter["analyze"]>> } | { status: "failed"; errorCode: string };

  try {
    const raced = await runWithTimeout((signal) => adapter.analyze({ logs: batch }, signal), config.analysisTimeoutMs);
    if (raced === TIMEOUT) {
      settled = { status: "failed", errorCode: "ADAPTER_TIMEOUT" };
    } else {
      validateAnalysisOutput(raced, batchLogIds);
      settled = { status: "succeeded", result: raced };
    }
  } catch (error) {
    const errorCode = error instanceof InvalidAdapterOutputError ? "INVALID_ADAPTER_OUTPUT" : "ADAPTER_ERROR";
    // The client only ever sees the stable errorCode (never the adapter's
    // raw message — it could be a real LLM provider's response). Logging it
    // server-side is what makes "ADAPTER_ERROR" debuggable later instead of
    // a dead end: without this, a failing real adapter would be completely
    // silent in the logs.
    logger?.warn({ err: error, errorCode, adapter: adapter.name }, "analysis adapter did not produce a usable result");
    settled = { status: "failed", errorCode };
  }

  if (settled.status === "succeeded") {
    const record = await insertAnalysis(pool, {
      adapter: adapter.name,
      logIds,
      status: "succeeded",
      result: settled.result,
    });
    return { outcome: "succeeded", record };
  }

  const record = await insertAnalysis(pool, {
    adapter: adapter.name,
    logIds,
    status: "failed",
    errorCode: settled.errorCode,
  });
  return { outcome: "failed", record, httpStatus: settled.errorCode === "ADAPTER_TIMEOUT" ? 504 : 502 };
}
