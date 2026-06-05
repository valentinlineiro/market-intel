CREATE TABLE IF NOT EXISTS market_tests (
  id               TEXT PRIMARY KEY,
  description      TEXT NOT NULL,
  generated_config TEXT,
  status           TEXT NOT NULL DEFAULT 'pending',
  result           TEXT,
  error            TEXT,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);
