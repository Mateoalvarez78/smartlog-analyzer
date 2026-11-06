import { LOG_LEVELS, TIMESTAMP_PATTERN } from "../logs/schema.js";

export const postAnalyzeBodySchema = {
  type: "object",
  additionalProperties: false,
  required: ["from", "to"],
  properties: {
    from: { type: "string", pattern: TIMESTAMP_PATTERN },
    to: { type: "string", pattern: TIMESTAMP_PATTERN },
    service: { type: "string", minLength: 1, maxLength: 100 },
    level: { type: "string", enum: LOG_LEVELS },
  },
} as const;
