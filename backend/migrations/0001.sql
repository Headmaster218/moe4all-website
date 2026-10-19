PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS upload_sessions (
  id TEXT PRIMARY KEY, token_hash TEXT NOT NULL, authorize_hash TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('benchmark','error')), report_id TEXT NOT NULL,
  file_sha256 TEXT NOT NULL, size_bytes INTEGER NOT NULL,
  state TEXT NOT NULL DEFAULT 'awaiting_verification', expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL, receipt_id TEXT
);
CREATE INDEX IF NOT EXISTS sessions_expiry ON upload_sessions(expires_at);
CREATE TABLE IF NOT EXISTS reports (
  receipt_id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('benchmark','error')),
  report_id TEXT NOT NULL, file_sha256 TEXT NOT NULL, payload_sha256 TEXT NOT NULL,
  armor TEXT, size_bytes INTEGER NOT NULL DEFAULT 0, summary_json TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending_review',
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, group_id TEXT,
  review_note TEXT NOT NULL DEFAULT '', reviewed_sha256 TEXT, public_url TEXT,
  archive_json TEXT, resolution_version TEXT, is_fixture INTEGER NOT NULL DEFAULT 0, UNIQUE(kind, report_id)
);
CREATE INDEX IF NOT EXISTS report_queue ON reports(kind,status,created_at);
CREATE TABLE IF NOT EXISTS receipt_grants (
  token_hash TEXT PRIMARY KEY, receipt_id TEXT NOT NULL REFERENCES reports(receipt_id),
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS grants_receipt ON receipt_grants(receipt_id);
CREATE TABLE IF NOT EXISTS benchmark_rows (
  id TEXT PRIMARY KEY, receipt_id TEXT NOT NULL REFERENCES reports(receipt_id), row_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS error_groups (
  id TEXT PRIMARY KEY, fingerprint TEXT UNIQUE NOT NULL, title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'triaged', resolution_version TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS audit_events (
  id TEXT PRIMARY KEY, receipt_id TEXT, actor TEXT NOT NULL, action TEXT NOT NULL,
  detail_json TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS rate_limits (
  bucket TEXT PRIMARY KEY, count INTEGER NOT NULL, expires_at TEXT NOT NULL
);
