ALTER TABLE upload_sessions ADD COLUMN summary_json TEXT;
ALTER TABLE reports ADD COLUMN source_path TEXT;
ALTER TABLE reports ADD COLUMN report_created_at TEXT;
ALTER TABLE reports ADD COLUMN next_attempt_at TEXT;
ALTER TABLE reports ADD COLUMN delivery_expires_at TEXT;
ALTER TABLE reports ADD COLUMN delivery_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE reports ADD COLUMN body_deleted_at TEXT;
ALTER TABLE reports ADD COLUMN failure_code TEXT;
CREATE TABLE IF NOT EXISTS submission_admissions (
  receipt_id TEXT PRIMARY KEY,
  source_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS admissions_source_time ON submission_admissions(source_hash, created_at);
CREATE INDEX IF NOT EXISTS reports_delivery_due ON reports(status, next_attempt_at);
CREATE TABLE IF NOT EXISTS session_admissions (
  session_id TEXT PRIMARY KEY,
  source_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_source_time ON session_admissions(source_hash, created_at);
UPDATE reports SET delivery_expires_at=strftime('%Y-%m-%dT%H:%M:%fZ',created_at,'+72 hours')
WHERE armor IS NOT NULL AND publication_consent IN ('public_benchmark','public_error');
