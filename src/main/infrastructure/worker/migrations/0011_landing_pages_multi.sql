CREATE TABLE landing_pages_new (
  segment     TEXT NOT NULL,
  page_slug   TEXT NOT NULL DEFAULT 'index',
  html        TEXT NOT NULL,
  copy        TEXT,
  title       TEXT,
  deployed_at TEXT NOT NULL,
  PRIMARY KEY (segment, page_slug)
);
INSERT INTO landing_pages_new (segment, page_slug, html, title, deployed_at)
  SELECT segment, 'index', html, title, deployed_at FROM landing_pages;
DROP TABLE landing_pages;
ALTER TABLE landing_pages_new RENAME TO landing_pages;
