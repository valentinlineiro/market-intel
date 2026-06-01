CREATE TABLE IF NOT EXISTS signals (
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

CREATE TABLE IF NOT EXISTS opportunities (
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

CREATE INDEX IF NOT EXISTS idx_signals_segment        ON signals(segment);
CREATE INDEX IF NOT EXISTS idx_signals_collected      ON signals(collected_at);
CREATE INDEX IF NOT EXISTS idx_opps_score             ON opportunities(score DESC);
CREATE INDEX IF NOT EXISTS idx_opps_status            ON opportunities(status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_signals_url_seg ON signals(url, segment);

CREATE TABLE IF NOT EXISTS leads (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    email       TEXT NOT NULL,
    segment     TEXT NOT NULL,
    captured_at TEXT NOT NULL,
    ip          TEXT,
    ua          TEXT,
    UNIQUE(email, segment)
);

CREATE TABLE IF NOT EXISTS landing_pages (
    segment     TEXT PRIMARY KEY,
    html        TEXT NOT NULL,
    title       TEXT,
    deployed_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS discovery_candidates (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    profile         TEXT NOT NULL,
    pain            TEXT NOT NULL,
    keywords        TEXT NOT NULL,
    post_count      INTEGER DEFAULT 0,
    discovery_score REAL DEFAULT 0,
    income_est      TEXT,
    has_deadline    INTEGER DEFAULT 0,
    source          TEXT DEFAULT 'reddit',
    run_id          TEXT NOT NULL,
    discovered_at   TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_discovery_run   ON discovery_candidates(run_id);
CREATE INDEX IF NOT EXISTS idx_discovery_score ON discovery_candidates(discovery_score DESC);
