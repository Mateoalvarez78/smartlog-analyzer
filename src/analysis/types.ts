import type { LogRecord } from "../logs/types.js";

export interface AnalysisCategory {
  name: string;
  severity: "WARN" | "ERROR";
  count: number;
  evidenceLogIds: string[];
}

export interface AnalysisSuggestion {
  category: string;
  message: string;
}

export interface AnalysisOutput {
  summary: string;
  categories: AnalysisCategory[];
  suggestions: AnalysisSuggestion[];
}

export interface AnalysisInput {
  logs: LogRecord[];
}

/**
 * Anything that can turn a batch of logs into an AnalysisOutput: the mock
 * today, an HTTP call to a real LLM provider tomorrow. The orchestrator only
 * depends on this interface (ARCHITECTURE.md §4) — swapping the active
 * adapter never touches selection, timeout handling or persistence.
 */
export interface AnalysisAdapter {
  readonly name: string;
  analyze(input: AnalysisInput, signal: AbortSignal): Promise<AnalysisOutput>;
}

export type AnalysisStatus = "succeeded" | "failed";

export interface AnalysisRecord {
  id: string;
  createdAt: string;
  adapter: string;
  logIds: string[];
  status: AnalysisStatus;
  result: AnalysisOutput | null;
  errorCode: string | null;
}
