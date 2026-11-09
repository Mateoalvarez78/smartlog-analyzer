import { describe, expect, it } from "vitest";
import { analyzeWithHeuristics } from "../../src/analysis/heuristics.js";
import type { LogRecord } from "../../src/logs/types.js";

function log(overrides: Partial<LogRecord>): LogRecord {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    service: "payments-api",
    level: "INFO",
    message: "noop",
    timestamp: "2026-11-01T08:00:00.000Z",
    createdAt: "2026-11-01T08:00:00.000Z",
    ...overrides,
  };
}

describe("analyzeWithHeuristics", () => {

  it("is deterministic: the same batch always produces the same output", () => {
    const logs = [
      log({ id: "a", level: "ERROR", message: "Connection refused to database at 10.0.1.5:5432" }),
      log({ id: "b", level: "INFO", message: "All good" }),
    ];
    const first = analyzeWithHeuristics(logs);
    const second = analyzeWithHeuristics(logs);
    expect(first).toEqual(second);
  });

  it("reports no anomalies for a batch with no WARN/ERROR logs", () => {
    const output = analyzeWithHeuristics([log({ level: "INFO" }), log({ level: "DEBUG" })]);
    expect(output.categories).toEqual([]);
    expect(output.suggestions).toEqual([]);
    expect(output.summary).toMatch(/no anomalies/i);
  });

  it("categorizes connection errors and cites evidence ids from the batch", () => {
    const logs = [
      log({ id: "e1", level: "ERROR", message: "Connection refused to database at 10.0.1.5:5432" }),
      log({ id: "e2", level: "ERROR", message: "Connection refused to database at 10.0.1.5:5432" }),
      log({ id: "i1", level: "INFO", message: "Payment captured" }),
    ];
    const output = analyzeWithHeuristics(logs);

    expect(output.categories).toHaveLength(1);
    expect(output.categories[0]).toMatchObject({ name: "connection_errors", severity: "ERROR", count: 2 });
    expect(output.categories[0]?.evidenceLogIds).toEqual(["e1", "e2"]);
    expect(output.suggestions).toHaveLength(1);
    expect(output.suggestions[0]?.category).toBe("connection_errors");
  });

  it("buckets an unrecognized WARN/ERROR message as uncategorized instead of dropping it", () => {
    const output = analyzeWithHeuristics([log({ id: "x", level: "ERROR", message: "Something weird happened" })]);
    expect(output.categories).toHaveLength(1);
    expect(output.categories[0]?.name).toBe("uncategorized");
  });

  it("only cites up to 5 evidence ids per category even with a larger match count", () => {
    const logs = Array.from({ length: 8 }, (_, i) =>
      log({ id: `err-${i}`, level: "ERROR", message: "Connection refused to database at 10.0.1.5:5432" }),
    );
    const output = analyzeWithHeuristics(logs);
    expect(output.categories[0]?.count).toBe(8);
    expect(output.categories[0]?.evidenceLogIds).toHaveLength(5);
  });

  it("classifies an SMTP connection failure as a delivery failure, not a generic connection error", () => {
    const output = analyzeWithHeuristics([
      log({ id: "m1", level: "ERROR", message: "Failed to deliver email: SMTP connection refused" }),
    ]);
    expect(output.categories.map((c) => c.name)).toEqual(["delivery_failures"]);
  });
});
