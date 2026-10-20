import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { createService } from '../backend/service.mjs';
import { localDatabase } from '../backend/local-db.mjs';
import { benchmarkFixture, errorFixture, packFixture } from '../backend/fixtures.mjs';
import { decodeSubmission, sha256, MAX_ARMOR_BYTES, MAX_DECODED_BYTES } from '../community/submission-codec.mjs';
import worker from '../backend/worker.mjs';

const encode = text => new TextEncoder().encode(text);
const migration = await fs.readFile(new URL('../backend/migrations/0001.sql', import.meta.url), 'utf8');
async function fixture(kind = 'benchmark', id = 0) {
  const payload = kind === 'benchmark' ? benchmarkFixture(id) : errorFixture(id);
  return decodeSubmission(encode(await packFixture(kind, payload)));
}
function setup(t, extra = {}) {
  const DB = localDatabase(':memory:', migration);
  let now = Date.parse('2026-10-19T15:00:00Z');
  const sent = [];
  const env = { DB, MODE: 'production', REVIEW_MODE: 'github_pr', RATE_LIMIT_SALT: 'test-only', SITE_ORIGIN: 'https://example.test', TURNSTILE_SITE_KEY: 'public-test-key', now: () => now, clientAddress: () => 'test-source', verifyHuman: async () => true,
    ARCHIVE: { mode: 'github', process: async row => { sent.push(row); return { state: 'pending', verified: true, mode: 'github', path: row.source_path, head_sha: 'b'.repeat(40), pr_number: 7, file_sha256: row.file_sha256, public_url: 'https://github.com/example/reports/pull/7' }; } }, ...extra };
  const api = createService(env);
  const call = async (path, method = 'GET', value, token) => {
    const raw = typeof value === 'string';
    const response = await api.fetch(new Request('https://example.test/v1' + path, { method, headers: { ...(value !== undefined ? { 'Content-Type': raw ? 'text/plain' : 'application/json' } : {}), ...(token ? { Authorization: 'Bearer ' + token } : {}) }, ...(value !== undefined ? { body: raw ? value : JSON.stringify(value) } : {}) }));
    return { code: response.status, headers: response.headers, body: await response.json() };
  };
  const open = async (file, summary) => {
    const r = await call('/upload-sessions', 'POST', { kind: file.kind, report_id: file.id, file_sha256: file.fileSha256, size_bytes: file.sizeBytes, ...(summary ? { summary } : {}) });
    assert.equal(r.code, 201, JSON.stringify(r.body));
    const browser = new URLSearchParams(new URL(r.body.verification_url).hash.slice(1)).get('authorize');
    const s = { ...r.body, browser, file };
    assert.equal((await call(`/upload-sessions/${s.session_id}/authorize`, 'POST', { consent: file.kind === 'benchmark' ? 'public_benchmark' : 'public_error' }, browser)).code, 200);
    return s;
  };
  const upload = s => call(`/upload-sessions/${s.session_id}/report`, 'POST', s.file.text, s.session_token);
  t.after(() => DB.close());
  return { env, api, sent, call, open, upload, advance: n => { now += n; }, current: () => new Date(now).toISOString(), source: () => sha256(encode('test-only:source:test-source')) };
}

test('both complete armor and decoded JSON are capped at 128 KiB', async () => {
  assert.equal(MAX_ARMOR_BYTES, 131072); assert.equal(MAX_DECODED_BYTES, 131072);
  const payload = errorFixture(); payload.extra_padding = 'x'.repeat(131072);
  await assert.rejects(decodeSubmission(encode(await packFixture('error', payload))), error => error.code === 'payload_too_large');
  await assert.rejects(decodeSubmission(new Uint8Array(131073)), error => error.code === 'payload_too_large');
});

test('production transport refuses plaintext HTTP before reading credentials or reports', async t => {
  const a = setup(t);
  const response = await a.api.fetch(new Request('http://example.test/v1/health'));
  assert.equal(response.status, 400); assert.equal((await response.json()).error.code, 'https_required');
});

test('upload returns before GitHub, both report kinds release bodies only after verified PR heads', async t => {
  const a = setup(t);
  for (const kind of ['benchmark', 'error']) {
    const s = await a.open(await fixture(kind)), result = await a.upload(s);
    assert.equal(result.code, 202); assert.equal(result.body.status, 'forwarding');
    assert.equal(a.sent.length, kind === 'benchmark' ? 0 : 1);
    const id = result.body.receipt_id;
    assert.ok((await a.api.store.one('SELECT armor FROM reports WHERE receipt_id=?', id)).armor);
    await a.api.syncPending();
    const row = await a.api.store.one('SELECT * FROM reports WHERE receipt_id=?', id);
    assert.equal(row.status, 'pending_review'); assert.equal(row.armor, null); assert.ok(row.body_deleted_at);
    assert.equal(row.report_created_at, s.file.headers['created-at']); assert.match(row.source_path, /2026-10\//);
    assert.equal(JSON.parse(row.archive_json).head_sha, 'b'.repeat(40));
    const receipt = await a.call('/receipts/' + id, 'GET', undefined, result.body.receipt_token);
    assert.equal(receipt.body.body_retained, false); assert.equal(receipt.body.status, 'pending_review');
  }
  assert.equal((await a.api.store.one('SELECT count(*) AS n FROM benchmark_rows')).n, 0);
  assert.equal((await a.api.store.one('SELECT count(*) AS n FROM error_groups')).n, 0);
  assert.equal((await a.call('/integrations/github/import', 'POST', {})).code, 404);
});

test('bodyless receipts can still synchronize merge and rejection without decoding the original', async t => {
  const a = setup(t), responses = [];
  for (const kind of ['benchmark', 'error']) responses.push((await a.upload(await a.open(await fixture(kind)))).body);
  await a.api.syncPending(); a.advance(900001);
  a.env.ARCHIVE.process = async row => {
    assert.equal(row.armor, null); assert.ok(row.source_path); assert.ok(row.report_created_at);
    return { state: row.kind === 'benchmark' ? 'published' : 'rejected', verified: true, mode: 'github', path: row.source_path, commit: 'c'.repeat(40), file_sha256: row.file_sha256 };
  };
  await a.api.syncPending();
  for (const report of responses) {
    const receipt = await a.call('/receipts/' + report.receipt_id, 'GET', undefined, report.receipt_token);
    assert.equal(receipt.body.status, report.kind === 'benchmark' ? 'published' : 'rejected');
  }
});

test('unverified, wrong-path and wrong-hash PR results never release a body or claim pending review', async t => {
  const a = setup(t), received = (await a.upload(await a.open(await fixture()))).body;
  for (const wrong of [{ verified: false }, { path: 'wrong' }, { file_sha256: '0'.repeat(64) }]) {
    a.env.ARCHIVE.process = async row => ({ state: 'pending', verified: true, path: row.source_path, file_sha256: row.file_sha256, ...wrong });
    await a.api.syncPending();
    const row = await a.api.store.one('SELECT * FROM reports WHERE receipt_id=?', received.receipt_id);
    assert.equal(row.status, 'forwarding'); assert.ok(row.armor); assert.equal(row.failure_code, 'github_unavailable_or_unverified');
    a.advance(3600001);
  }
});

test('forwarding diagnostics retain safe HTTP classifications but no upstream secrets', async t => {
  const a = setup(t), received = (await a.upload(await a.open(await fixture()))).body;
  for (const [error, expected] of [
    [Object.assign(new Error('private credential and upstream body'), { statusCode: 403, operation: 'POST git' }), { http_status: 403, operation: 'POST git', error_type: 'Error' }],
    [Object.assign(new TypeError('private runtime detail'), { statusCode: 'secret', operation: 'https://private.example/token' }), { http_status: null, operation: null, error_type: 'TypeError' }]
  ]) {
    a.env.ARCHIVE.process = async () => { throw error; };
    await a.api.syncPending();
    const events = await a.api.store.all('SELECT detail_json FROM audit_events WHERE receipt_id=? AND action=? ORDER BY created_at', received.receipt_id, 'pr_sync_failed');
    assert.deepEqual(JSON.parse(events.at(-1).detail_json), expected);
    assert.ok(!JSON.stringify(events).includes('private'));
    const row = await a.api.store.one('SELECT * FROM reports WHERE receipt_id=?', received.receipt_id);
    assert.equal(row.status, 'forwarding'); assert.ok(row.armor);
    a.advance(3600001);
  }
});

test('failure retries back off, expire after 72h even without GitHub configuration, and preserve receipts', async t => {
  const a = setup(t), s = await a.open(await fixture('error')), received = (await a.upload(s)).body;
  let attempts = 0; a.env.ARCHIVE.process = async () => { attempts++; throw new Error('private upstream detail'); };
  await a.api.syncPending(); await a.api.syncPending(); assert.equal(attempts, 1);
  a.advance(30001); await a.api.syncPending(); assert.equal(attempts, 2);
  a.advance(72 * 3600000); a.env.ARCHIVE = null; await a.api.syncPending();
  const r = (await a.call('/receipts/' + received.receipt_id, 'GET', undefined, received.receipt_token)).body;
  assert.equal(r.status, 'delivery_failed'); assert.equal(r.body_retained, false); assert.equal(r.failure_code, 'delivery_expired');
  assert.ok(!JSON.stringify(r).includes('private upstream detail'));
});

test('success quota combines both kinds, is atomic at the boundary, and duplicates consume no quota', async t => {
  const a = setup(t), source = await a.source();
  await a.api.store.batch(Array.from({ length: 49 }, (_, i) => ['INSERT INTO submission_admissions VALUES(?,?,?)', 'seed-' + i, source, a.current()]));
  const sessions = await Promise.all([a.open(await fixture()), a.open(await fixture('error'))]);
  const results = await Promise.all(sessions.map(a.upload));
  assert.deepEqual(results.map(r => r.code).sort(), [202, 429]);
  const winner = results.findIndex(r => r.code === 202), retry = await a.upload(sessions[winner]);
  assert.equal(retry.code, 200); assert.equal(retry.body.duplicate, true);
  assert.equal((await a.api.store.one('SELECT count(*) AS n FROM submission_admissions')).n, 50);
  const denied = results.find(r => r.code === 429); assert.equal(denied.body.error.code, 'daily_limit');
});

test('buffer admission is atomic, never evicts valid work, and rejected uploads keep a reusable session', async t => {
  const a = setup(t), files = [await fixture(), await fixture('error')];
  const sessions = await Promise.all(files.map(file => a.open(file)));
  a.env.MAX_STORED_BYTES = Math.max(...files.map(file => file.sizeBytes));
  const results = await Promise.all(sessions.map(a.upload));
  assert.deepEqual(results.map(r => r.code).sort(), [202, 503]);
  const loser = results.findIndex(r => r.code === 503);
  assert.equal(results[loser].body.error.retryable, true); assert.equal(results[loser].headers.get('Retry-After'), '60');
  assert.equal((await a.call('/upload-sessions/' + sessions[loser].session_id, 'GET', undefined, sessions[loser].session_token)).body.state, 'ready');
  assert.equal((await a.api.store.one('SELECT count(*) AS n FROM submission_admissions')).n, 1);
  await a.api.syncPending(); assert.equal((await a.upload(sessions[loser])).code, 202);
});

test('100-session rolling quota is atomic and survives expiration of 15-minute sessions', async t => {
  const a = setup(t), source = await a.source(), file = await fixture();
  await a.api.store.batch(Array.from({ length: 99 }, (_, i) => ['INSERT INTO session_admissions VALUES(?,?,?)', 'seed-' + i, source, a.current()]));
  const meta = { kind: file.kind, report_id: file.id, file_sha256: file.fileSha256, size_bytes: file.sizeBytes };
  const results = await Promise.all([a.call('/upload-sessions', 'POST', meta), a.call('/upload-sessions', 'POST', meta)]);
  assert.deepEqual(results.map(r => r.code).sort(), [201, 429]);
  a.advance(900001); assert.equal((await a.call('/upload-sessions', 'POST', meta)).code, 429);
  a.advance(86400000); assert.equal((await a.call('/upload-sessions', 'POST', meta)).code, 201);
});

test('confirmation summary is untrusted until the original is received, and CMD polling gets no widget key', async t => {
  const a = setup(t), s = await a.open(await fixture(), ['client-supplied summary']);
  const before = (await a.call(`/upload-sessions/${s.session_id}/confirmation`, 'GET', undefined, s.browser)).body;
  assert.deepEqual(before.summary, ['client-supplied summary']); assert.equal(before.summary_verified, false);
  const polling = (await a.call('/upload-sessions/' + s.session_id, 'GET', undefined, s.session_token)).body;
  assert.ok(!Object.hasOwn(polling, 'turnstile_site_key')); assert.ok(!Object.hasOwn(polling, 'summary'));
  await a.upload(s);
  const after = (await a.call(`/upload-sessions/${s.session_id}/confirmation`, 'GET', undefined, s.browser)).body;
  assert.equal(after.summary_verified, true); assert.deepEqual(after.summary, s.file.summary);
});

test('deferred delivery does not hold the HTTP response while GitHub is stalled', async t => {
  const jobs = [], a = setup(t, { defer: promise => jobs.push(promise) });
  let release; const gate = new Promise(resolve => { release = resolve; });
  const process = a.env.ARCHIVE.process;
  a.env.ARCHIVE.process = async row => { await gate; return process(row); };
  const received = await a.upload(await a.open(await fixture()));
  assert.equal(received.code, 202); assert.equal(received.body.status, 'forwarding'); assert.equal(jobs.length, 1);
  release(); await Promise.all(jobs);
  assert.equal((await a.api.store.one('SELECT armor FROM reports WHERE receipt_id=?', received.body.receipt_id)).armor, null);
});

test('cloud migrations apply in order and match local schema, without consent promotion', async () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(migration);
    db.exec(await fs.readFile(new URL('../backend/migrations/0002_public_pr.sql', import.meta.url), 'utf8'));
    db.exec("INSERT INTO reports(receipt_id,kind,report_id,file_sha256,payload_sha256,armor,summary_json,created_at,updated_at) VALUES('old','error','old','hash','payload','private','[]','2026-10-19T00:00:00Z','2026-10-19T00:00:00Z')");
    db.exec(await fs.readFile(new URL('../backend/migrations/0003_forwarding.sql', import.meta.url), 'utf8'));
    const old = db.prepare('SELECT * FROM reports').get(); assert.equal(old.publication_consent, null); assert.equal(old.armor, 'private'); assert.equal(old.delivery_expires_at, null);
    for (const table of ['reports', 'upload_sessions']) {
      const local = localDatabase(':memory:', migration);
      const localColumns = (await local.prepare(`PRAGMA table_info(${table})`).all()).results.map(c => c.name).sort();
      assert.deepEqual(db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name).sort(), localColumns); local.close();
    }
  } finally { db.close(); }
});

test('scheduled maintenance expires buffered data even when the GitHub secret is absent', async t => {
  const a = setup(t), accepted = (await a.upload(await a.open(await fixture()))).body;
  await a.api.store.run('UPDATE reports SET delivery_expires_at=? WHERE receipt_id=?', '2000-01-01T00:00:00Z', accepted.receipt_id);
  const tasks = [], env = { ...a.env, GITHUB_TOKEN: undefined, TURNSTILE_SECRET: 'test-only' };
  await worker.scheduled({}, env, { waitUntil: task => tasks.push(task) });
  await Promise.all(tasks);
  const row = await a.api.store.one('SELECT armor,status FROM reports WHERE receipt_id=?', accepted.receipt_id);
  assert.equal(row.armor, null); assert.equal(row.status, 'delivery_failed');
  assert.match(await fs.readFile(new URL('../backend/wrangler.toml', import.meta.url), 'utf8'), /crons\s*=\s*\["\*\/5 \* \* \* \*"\]/);
});

test('cleanup defers to an active synchronization lease, then releases expired originals', async t => {
  const a = setup(t), accepted = (await a.upload(await a.open(await fixture()))).body;
  a.advance(73 * 3600000);
  await a.api.store.run('INSERT INTO pr_sync_locks VALUES(?,?,?)', accepted.receipt_id, 'test-lease', new Date(Date.parse(a.current()) + 120000).toISOString());
  await a.api.syncPending(); assert.ok((await a.api.store.one('SELECT armor FROM reports WHERE receipt_id=?', accepted.receipt_id)).armor);
  a.advance(120001); await a.api.syncPending();
  assert.equal((await a.api.store.one('SELECT status FROM reports WHERE receipt_id=?', accepted.receipt_id)).status, 'delivery_failed');
  assert.equal((await a.api.store.one('SELECT count(*) AS n FROM pr_sync_locks')).n, 0);
});
