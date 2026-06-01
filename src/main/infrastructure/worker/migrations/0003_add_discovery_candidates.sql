CREATE TABLE discovery_candidates (
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

CREATE INDEX idx_discovery_run   ON discovery_candidates(run_id);
CREATE INDEX idx_discovery_score ON discovery_candidates(discovery_score DESC);
