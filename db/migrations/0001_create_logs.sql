-- Up Migration
CREATE TABLE logs (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  service     text        NOT NULL CHECK (char_length(service) BETWEEN 1 AND 100),
  level       text        NOT NULL CHECK (level IN ('DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL')),
  message     text        NOT NULL CHECK (char_length(message) > 0),
  "timestamp" timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  trace_id    text,
  metadata    jsonb       NOT NULL DEFAULT '{}'
);

-- Serves the listing and its cursor pagination.
CREATE INDEX logs_timestamp_id_idx ON logs ("timestamp" DESC, id DESC);

-- Serves the service and level filters over a date range.
CREATE INDEX logs_service_level_timestamp_idx ON logs (service, level, "timestamp" DESC);

-- Down Migration
DROP TABLE logs;
