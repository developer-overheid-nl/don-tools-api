-- Events agenda (GET/POST /v1/events). Run by hand against the events database, in the schema of DB_SCHEMA:
--   psql "host=... dbname=don_events user=..." -v ON_ERROR_STOP=1 -f db/001_create_events.sql
-- The application user only needs SELECT, INSERT, UPDATE and DELETE on events.

CREATE TABLE events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source text NOT NULL CHECK (source IN ('manual', 'pleio')),
  source_name text,
  external_id text,
  title text NOT NULL,
  summary text,
  location text,
  url text NOT NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL CHECK (ends_at >= starts_at),
  source_updated_at timestamptz,
  hidden_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source, source_name, external_id)
);

CREATE INDEX events_starts_at_idx ON events (starts_at) WHERE hidden_at IS NULL;
