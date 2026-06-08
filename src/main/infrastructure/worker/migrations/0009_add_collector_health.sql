CREATE TABLE collector_health (
  collector_id  TEXT PRIMARY KEY,
  last_run_at   TEXT NOT NULL,
  signal_count  INTEGER NOT NULL,
  error         TEXT
);
