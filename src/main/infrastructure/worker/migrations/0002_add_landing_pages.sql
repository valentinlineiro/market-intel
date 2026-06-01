CREATE TABLE landing_pages (
    segment     TEXT PRIMARY KEY,
    html        TEXT NOT NULL,
    title       TEXT,
    deployed_at TEXT NOT NULL
);
