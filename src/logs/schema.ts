export const LOG_LEVELS = ["DEBUG", "INFO", "WARN", "ERROR"] as const;

// Requires an explicit offset (Z or ±HH:MM) on purpose: a bare
// "2026-11-01T08:00:00" is ambiguous (ECMA-262 treats date-time strings
// without an offset as local time, not UTC), and ARCHITECTURE.md §3
// commits to accepting zoned timestamps only.
export const TIMESTAMP_PATTERN = "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(\\.\\d{1,3})?(Z|[+-]\\d{2}:\\d{2})$";

export const postLogBodySchema = {
  type: "object",
  additionalProperties: false,
  required: ["service", "level", "message", "timestamp"],
  properties: {
    service: { type: "string", minLength: 1, maxLength: 100 },
    level: { type: "string", enum: LOG_LEVELS },
    message: { type: "string", minLength: 1 },
    timestamp: { type: "string", pattern: TIMESTAMP_PATTERN },
  },
} as const;

export function getLogsQuerySchema(logsMaxLimit: number) {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      service: { type: "string", minLength: 1, maxLength: 100 },
      level: { type: "string", enum: LOG_LEVELS },
      from: { type: "string", pattern: TIMESTAMP_PATTERN },
      to: { type: "string", pattern: TIMESTAMP_PATTERN },
      limit: { type: "integer", minimum: 1, maximum: logsMaxLimit },
    },
  } as const;
}
