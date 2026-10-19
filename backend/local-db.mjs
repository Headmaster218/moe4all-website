import { DatabaseSync } from 'node:sqlite';

export function localDatabase(filename, migration) {
  const db = new DatabaseSync(filename); db.exec(migration);
  if (!db.prepare('PRAGMA table_info(reports)').all().some(column => column.name === 'size_bytes')) db.exec('ALTER TABLE reports ADD COLUMN size_bytes INTEGER NOT NULL DEFAULT 0');
  if (!db.prepare('PRAGMA table_info(error_groups)').all().some(column => column.name === 'resolution_version')) db.exec('ALTER TABLE error_groups ADD COLUMN resolution_version TEXT');
  for (const table of ['upload_sessions', 'reports']) {
    if (!db.prepare(`PRAGMA table_info(${table})`).all().some(column => column.name === 'publication_consent')) db.exec(`ALTER TABLE ${table} ADD COLUMN publication_consent TEXT`);
  }
  db.exec('CREATE TABLE IF NOT EXISTS pr_sync_locks (receipt_id TEXT PRIMARY KEY, owner TEXT NOT NULL, expires_at TEXT NOT NULL)');
  for (const [table, columns] of Object.entries({ upload_sessions: { summary_json: 'TEXT' }, reports: { source_path: 'TEXT', report_created_at: 'TEXT', next_attempt_at: 'TEXT', delivery_expires_at: 'TEXT', delivery_attempts: 'INTEGER NOT NULL DEFAULT 0', body_deleted_at: 'TEXT', failure_code: 'TEXT' } })) {
    const present = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map(column => column.name));
    for (const [column, type] of Object.entries(columns)) if (!present.has(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  }
  db.exec('CREATE TABLE IF NOT EXISTS submission_admissions (receipt_id TEXT PRIMARY KEY, source_hash TEXT NOT NULL, created_at TEXT NOT NULL); CREATE INDEX IF NOT EXISTS admissions_source_time ON submission_admissions(source_hash,created_at); CREATE INDEX IF NOT EXISTS reports_delivery_due ON reports(status,next_attempt_at)');
  db.exec('UPDATE reports SET size_bytes=length(CAST(armor AS BLOB)) WHERE size_bytes=0 AND armor IS NOT NULL');
  db.exec('CREATE TABLE IF NOT EXISTS session_admissions (session_id TEXT PRIMARY KEY, source_hash TEXT NOT NULL, created_at TEXT NOT NULL); CREATE INDEX IF NOT EXISTS sessions_source_time ON session_admissions(source_hash,created_at)');
  db.exec("UPDATE reports SET delivery_expires_at=strftime('%Y-%m-%dT%H:%M:%fZ',created_at,'+72 hours') WHERE armor IS NOT NULL AND delivery_expires_at IS NULL AND publication_consent IN ('public_benchmark','public_error')");
  const wrap = (sql, args = []) => ({
    bind: (...values) => wrap(sql, values),
    first: async () => db.prepare(sql).get(...args) || null,
    all: async () => ({ results: db.prepare(sql).all(...args) }),
    run: async () => ({ meta: db.prepare(sql).run(...args) }),
    execute: () => db.prepare(sql).run(...args)
  });
  return {
    prepare: sql => wrap(sql),
    batch: async statements => {
      db.exec('BEGIN IMMEDIATE');
      try { const results = statements.map(s => ({ meta: s.execute() })); db.exec('COMMIT'); return results; }
      catch (error) { db.exec('ROLLBACK'); throw error; }
    },
    close: () => db.close()
  };
}
