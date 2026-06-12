CREATE TABLE IF NOT EXISTS cron_steps (
  run_id      TEXT NOT NULL,
  step        TEXT NOT NULL,
  status      TEXT NOT NULL CHECK(status IN ('running','done','error')),
  started_at  TEXT NOT NULL,
  finished_at TEXT,
  detail_json TEXT,
  PRIMARY KEY (run_id, step),
  FOREIGN KEY (run_id) REFERENCES cron_log(id)
);
