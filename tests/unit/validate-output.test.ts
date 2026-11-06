import { describe, expect, it } from "vitest";
import { InvalidAdapterOutputError, validateAnalysisOutput } from "../../src/analysis/validate-output.js";

const BATCH_IDS = new Set(["a", "b", "c"]);

const VALID_OUTPUT = {
  summary: "Found 1 connection error.",
  categories: [{ name: "connection_errors", severity: "ERROR", count: 1, evidenceLogIds: ["a"] }],
  suggestions: [{ category: "connection_errors", message: "Check connectivity." }],
};

describe("validateAnalysisOutput", () => {
  it("accepts a well-formed output", () => {
    expect(() => validateAnalysisOutput(VALID_OUTPUT, BATCH_IDS)).not.toThrow();
  });

  it("accepts the no-findings shape", () => {
    expect(() => validateAnalysisOutput({ summary: "No anomalies.", categories: [], suggestions: [] }, BATCH_IDS)).not.toThrow();
  });

  it("rejects a non-object output", () => {
    expect(() => validateAnalysisOutput("not an object", BATCH_IDS)).toThrow(InvalidAdapterOutputError);
    expect(() => validateAnalysisOutput(null, BATCH_IDS)).toThrow(InvalidAdapterOutputError);
  });

  it("rejects a missing or empty summary", () => {
    expect(() => validateAnalysisOutput({ ...VALID_OUTPUT, summary: "" }, BATCH_IDS)).toThrow(/summary/);
    expect(() => validateAnalysisOutput({ categories: [], suggestions: [] }, BATCH_IDS)).toThrow(/summary/);
  });

  it("rejects a category missing required fields", () => {
    const output = { ...VALID_OUTPUT, categories: [{ name: "x" }] };
    expect(() => validateAnalysisOutput(output, BATCH_IDS)).toThrow(InvalidAdapterOutputError);
  });

  it("rejects an evidence log id that does not belong to the analyzed batch", () => {
    const output = {
      ...VALID_OUTPUT,
      categories: [{ name: "x", severity: "ERROR", count: 1, evidenceLogIds: ["not-in-batch"] }],
    };
    expect(() => validateAnalysisOutput(output, BATCH_IDS)).toThrow(/evidenceLogIds/);
  });

  it("rejects a suggestion missing a message", () => {
    const output = { ...VALID_OUTPUT, suggestions: [{ category: "x" }] };
    expect(() => validateAnalysisOutput(output, BATCH_IDS)).toThrow(InvalidAdapterOutputError);
  });

  it("rejects an oversized categories array", () => {
    const categories = Array.from({ length: 51 }, (_, i) => ({
      name: `c${i}`,
      severity: "ERROR",
      count: 1,
      evidenceLogIds: ["a"],
    }));
    expect(() => validateAnalysisOutput({ ...VALID_OUTPUT, categories }, BATCH_IDS)).toThrow(/categories/);
  });
});
