import type { AppConfig } from "../config.js";
import { LlmAnalysisAdapter } from "./llm/llm-adapter.js";
import { MockLlmClient } from "./llm/mock-llm-client.js";
import { OpenAiCompatibleClient } from "./llm/openai-compatible-client.js";
import type { AnalysisAdapter } from "./types.js";

/** Picks the LLM client from ANALYSIS_ADAPTER; the rest of the pipeline is identical. */
export function createAnalysisAdapter(config: AppConfig): AnalysisAdapter {
  if (config.analysisAdapter === "openai-compatible") {
    if (!config.llm) {
      // loadConfig guarantees this; the check keeps the type honest.
      throw new Error("ANALYSIS_ADAPTER=openai-compatible requires LLM_BASE_URL and LLM_MODEL.");
    }
    return new LlmAnalysisAdapter(new OpenAiCompatibleClient(config.llm));
  }
  return new LlmAnalysisAdapter(new MockLlmClient());
}
