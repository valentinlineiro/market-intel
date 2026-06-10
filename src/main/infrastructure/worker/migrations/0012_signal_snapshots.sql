CREATE TABLE signal_snapshots (
  segment        TEXT NOT NULL,
  week           TEXT NOT NULL,
  count          INTEGER NOT NULL,
  avg_pain       REAL NOT NULL,
  solution_ratio REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (segment, week)
);

ALTER TABLE opportunities ADD COLUMN gap_score REAL;
