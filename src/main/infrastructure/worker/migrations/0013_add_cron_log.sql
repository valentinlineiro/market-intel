CREATE TABLE cron_log (
  id               TEXT PRIMARY KEY,
  started_at       TEXT NOT NULL,
  finished_at      TEXT,
  trigger          TEXT NOT NULL DEFAULT 'scheduled', -- 'scheduled' | 'manual'
  fresh_signals    INTEGER,
  analyzed_signals INTEGER,
  opps_updated     INTEGER,
  error            TEXT
);

CREATE INDEX cron_log_started ON cron_log(started_at DESC);
