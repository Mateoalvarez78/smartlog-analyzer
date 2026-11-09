import type { LogRecord } from "../logs/types.js";
import type { AnalysisCategory, AnalysisOutput, AnalysisSuggestion } from "./types.js";

/** The subset of a log the heuristics look at (what the LLM prompt carries). */
export type HeuristicLogInput = Pick<LogRecord, "id" | "service" | "level" | "message">;

interface PatternRule {
  name: string;
  pattern: RegExp;
  suggestion: string;
}

// Keyword rules over WARN/ERROR messages. Order matters: the first match
// wins, so more specific patterns are listed before generic ones (e.g. an
// "SMTP connection refused" is a delivery failure before it is a generic
// connection error).
const PATTERN_RULES: PatternRule[] = [
  {
    name: "delivery_failures",
    pattern: /failed to deliver|smtp/i,
    suggestion: "Verify connectivity and credentials to the delivery provider (SMTP/email gateway).",
  },
  {
    name: "connection_errors",
    pattern: /connection (refused|reset|timed out)|ECONNREFUSED/i,
    suggestion: "Check connectivity and credentials to the downstream dependency; consider a circuit breaker and retries with backoff.",
  },
  {
    name: "upstream_timeouts",
    pattern: /timeout|timed out/i,
    suggestion: "Investigate upstream latency and consider raising the timeout budget or adding retries with backoff.",
  },
  {
    name: "validation_errors",
    pattern: /validation failed|missing required field/i,
    suggestion: "Review client payloads for the reported fields and add stricter validation upstream of this service.",
  },
  {
    name: "rate_limiting",
    pattern: /rate limit/i,
    suggestion: "Review client request rates; consider backoff on the client side or raising limits for legitimate traffic.",
  },
];

const UNCATEGORIZED_SUGGESTION = "No known pattern matched these messages; review them manually.";

/**
 * Deterministic, rule-based analysis: given the exact same batch it always
 * returns the exact same output. It is what the mock LLM client "answers"
 * with (src/analysis/llm/mock-llm-client.ts), so `docker compose up` works
 * with no API key and the demo is reproducible.
 */
export function analyzeWithHeuristics(logs: readonly HeuristicLogInput[]): AnalysisOutput {
  const problems = logs.filter((log) => log.level === "ERROR" || log.level === "WARN");

  const buckets = new Map<string, { severity: "WARN" | "ERROR"; logs: HeuristicLogInput[]; suggestion: string }>();

  for (const log of problems) {
    const rule = PATTERN_RULES.find((r) => r.pattern.test(log.message));
    const name = rule?.name ?? "uncategorized";
    const suggestion = rule?.suggestion ?? UNCATEGORIZED_SUGGESTION;

    const bucket = buckets.get(name);
    if (bucket) {
      bucket.logs.push(log);
      if (log.level === "ERROR") bucket.severity = "ERROR";
    } else {
      buckets.set(name, { severity: log.level === "ERROR" ? "ERROR" : "WARN", logs: [log], suggestion });
    }
  }

  const categories: AnalysisCategory[] = [...buckets.entries()]
    .map(([name, bucket]) => ({
      name,
      severity: bucket.severity,
      count: bucket.logs.length,
      // Bounded: the evidence list cites examples, not a full index of
      // every matching log, so output size doesn't grow unbounded with a
      // large batch of near-identical errors.
      evidenceLogIds: bucket.logs.slice(0, 5).map((l) => l.id),
    }))
    .sort((a, b) => b.count - a.count);

  const suggestions: AnalysisSuggestion[] = [...buckets.entries()].map(([name, bucket]) => ({
    category: name,
    message: bucket.suggestion,
  }));

  const servicesCount = new Set(logs.map((l) => l.service)).size;
  const summary =
    categories.length === 0
      ? `Analyzed ${logs.length} log(s) across ${servicesCount} service(s). No anomalies detected.`
      : `Analyzed ${logs.length} log(s) across ${servicesCount} service(s). Found ${categories
          .map((c) => `${c.count} ${c.name.replace(/_/g, " ")}`)
          .join(", ")}.`;

  return { summary, categories, suggestions };
}
