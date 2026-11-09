import { describe, expect, it } from "vitest";
import { parseLlmResponse } from "../../src/analysis/llm/parse-response.js";
import { InvalidAdapterOutputError } from "../../src/analysis/validate-output.js";

const VALID = { summary: "ok", categories: [], suggestions: [] };

describe("parseLlmResponse", () => {
  it("parses a plain JSON answer", () => {
    expect(parseLlmResponse(JSON.stringify(VALID))).toEqual(VALID);
  });

  it("tolerates surrounding whitespace", () => {
    expect(parseLlmResponse(`\n  ${JSON.stringify(VALID)}  \n`)).toEqual(VALID);
  });

  it("unwraps a ```json markdown fence", () => {
    expect(parseLlmResponse("```json\n" + JSON.stringify(VALID, null, 2) + "\n```")).toEqual(VALID);
  });

  it("unwraps a bare ``` fence", () => {
    expect(parseLlmResponse("```\n" + JSON.stringify(VALID) + "\n```")).toEqual(VALID);
  });

  it.each([
    ["an empty answer", ""],
    ["whitespace only", "   \n "],
    ["a refusal in prose", "I'm sorry, I can't help with that."],
    ["prose around the JSON", `Here is the analysis: ${JSON.stringify(VALID)}`],
    ["truncated JSON (output cut by max tokens)", '{"summary": "Found 3 conn'],
    ["an unclosed fence", "```json\n" + JSON.stringify(VALID)],
  ])("rejects %s as INVALID_ADAPTER_OUTPUT", (_name, text) => {
    expect(() => parseLlmResponse(text)).toThrow(InvalidAdapterOutputError);
  });

  it("returns well-formed JSON of the wrong shape as-is (shape is checked later by validateAnalysisOutput)", () => {
    expect(parseLlmResponse("[1, 2, 3]")).toEqual([1, 2, 3]);
  });
});
