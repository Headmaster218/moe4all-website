ALTER TABLE upload_sessions ADD COLUMN publication_consent TEXT;
ALTER TABLE reports ADD COLUMN publication_consent TEXT;
CREATE TABLE IF NOT EXISTS pr_sync_locks (
  receipt_id TEXT PRIMARY KEY, owner TEXT NOT NULL, expires_at TEXT NOT NULL
);
