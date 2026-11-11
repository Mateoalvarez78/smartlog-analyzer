// Migration "0001_create_logs". Plain SQL kept as a string so the runner has no
// files to read at runtime and the build ships it inside dist/.
export default `
-- Up
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE logs (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  service     text        NOT NULL CHECK (char_length(service) BETWEEN 1 AND 100),
  level       text        NOT NULL CHECK (level IN ('DEBUG', 'INFO', 'WARN', 'ERROR')),
  message     text        NOT NULL CHECK (char_length(message) > 0),
  "timestamp" timestamptz NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Serves GET /api/logs with no service/level filter, ordered timestamp DESC, id DESC.
CREATE INDEX logs_timestamp_id_idx ON logs ("timestamp" DESC, id DESC);

-- Serves GET /api/logs and POST /api/logs/analyze filtered by service and/or
-- level over a [from, to) range, and the service/level aggregation query.
CREATE INDEX logs_service_level_timestamp_idx ON logs (service, level, "timestamp" DESC);
`;
