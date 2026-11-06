import type { LogRecord } from "../logs/types.js";
import type { AnalysisAdapter, AnalysisCategory, AnalysisInput, AnalysisOutput, AnalysisSuggestion } from "./types.js";

interface PatternRule {
  name: string;
  pattern: RegExp;
  suggestion: string;
}

// Keyword rules over WARN/ERROR messages. Order matters: the first match
// wins, so more specific patterns are listed before generic ones.
const PATTERN_RULES: PatternRule[] = [
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
  {
    name: "delivery_failures",
    pattern: /failed to deliver|smtp/i,
    suggestion: "Verify connectivity and credentials to the delivery provider (SMTP/email gateway).",
  },
];

const UNCATEGORIZED_SUGGESTION = "No known pattern matched these messages; review them manually.";

/**
 * Deterministic, no-network adapter: given the exact same batch of logs it
 * always returns the exact same output. That's what makes it safe to use as
 * the default (ARCHITECTURE.md §4 — no API key needed for `docker compose
 * up`) and what makes the timeout/invalid-output tests reproducible.
 */
export class MockAnalysisAdapter implements AnalysisAdapter {
  readonly name = "mock-v1";

  async analyze(input: AnalysisInput): Promise<AnalysisOutput> {
    const { logs } = input;
    const problems = logs.filter((log) => log.level === "ERROR" || log.level === "WARN");

    const buckets = new Map<string, { severity: "WARN" | "ERROR"; logs: LogRecord[]; suggestion: string }>();

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
}
