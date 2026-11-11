// Migration "0002_create_analyses". Plain SQL kept as a string so the runner has no
// files to read at runtime and the build ships it inside dist/.
export default `
-- Up
CREATE TABLE analyses (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  adapter    text        NOT NULL CHECK (char_length(adapter) BETWEEN 1 AND 100),
  log_ids    uuid[]      NOT NULL CHECK (array_length(log_ids, 1) BETWEEN 1 AND 100),
  status     text        NOT NULL CHECK (status IN ('succeeded', 'failed')),
  result     jsonb,
  error_code text        CHECK (error_code IS NULL OR char_length(error_code) BETWEEN 1 AND 100),

  -- A terminal row is either a success with a result and no error, or a
  -- failure with an error code and no result. There is no "pending" state:
  -- analysis is synchronous, so a row only exists once it has an outcome.
  CONSTRAINT analyses_outcome_chk CHECK (
    (status = 'succeeded' AND result IS NOT NULL AND error_code IS NULL) OR
    (status = 'failed' AND result IS NULL AND error_code IS NOT NULL)
  )
);

-- Serves a future "recent analyses" listing; not exposed by any endpoint yet.
CREATE INDEX analyses_created_at_idx ON analyses (created_at DESC);
`;
