import { LOG_LEVELS, SERVICE_SCHEMA, TIMESTAMP_PATTERN } from "../logs/schema.js";

export const postAnalyzeBodySchema = {
  type: "object",
  additionalProperties: false,
  required: ["from", "to"],
  properties: {
    from: { type: "string", pattern: TIMESTAMP_PATTERN },
    to: { type: "string", pattern: TIMESTAMP_PATTERN },
    service: SERVICE_SCHEMA,
    level: { type: "string", enum: LOG_LEVELS },
  },
} as const;
