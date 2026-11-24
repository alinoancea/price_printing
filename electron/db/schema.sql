CREATE TABLE IF NOT EXISTS barcodes (
  barcode TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  um TEXT NOT NULL,
  price REAL NOT NULL,
  quantity REAL NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_barcodes_updated_at ON barcodes(updated_at);

-- Single-row table storing app-level metadata like last sync time.
CREATE TABLE IF NOT EXISTS app_meta (
  id INTEGER PRIMARY KEY CHECK (id = 0),
  last_sync INTEGER
);

INSERT OR IGNORE INTO app_meta (id, last_sync) VALUES (0, NULL);

