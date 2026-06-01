CREATE TABLE signals (
    id              TEXT PRIMARY KEY,
    source          TEXT NOT NULL,
    collected_at    TEXT NOT NULL,
    segment         TEXT NOT NULL,
    location        TEXT,
    raw_text        TEXT,
    url             TEXT,
    pain_keywords   TEXT,
    sentiment_score REAL,
    salary_mean     INTEGER,
    income_tier     TEXT,
    signal_strength REAL,
    has_deadline    INTEGER DEFAULT 0
);

CREATE TABLE opportunities (
    id                  TEXT PRIMARY KEY,
    segment             TEXT NOT NULL,
    pain_summary        TEXT,
    score               REAL,
    score_breakdown     TEXT,
    signal_ids          TEXT,
    signal_count        INTEGER DEFAULT 0,
    first_seen          TEXT,
    last_updated        TEXT,
    status              TEXT DEFAULT 'watching',
    landing_url         TEXT,
    emails_captured     INTEGER DEFAULT 0,
    validation_deadline TEXT,
    telegram_alerted_at TEXT
);

CREATE TABLE leads (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    email       TEXT NOT NULL,
    segment     TEXT NOT NULL,
    captured_at TEXT NOT NULL,
    ip          TEXT,
    ua          TEXT,
    UNIQUE(email, segment)
);

CREATE INDEX idx_signals_segment        ON signals(segment);
CREATE INDEX idx_signals_collected      ON signals(collected_at);
CREATE UNIQUE INDEX idx_signals_url_seg ON signals(url, segment);
CREATE INDEX idx_opps_score             ON opportunities(score DESC);
CREATE INDEX idx_opps_status            ON opportunities(status);
