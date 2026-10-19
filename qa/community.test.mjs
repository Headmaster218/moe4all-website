import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { spawnSync } from 'node:child_process';
import { decodeSubmission, inspectHeaders, parseStrictJson, sha256, fixed2, oneLine, benchmarkRows, privacyFindings } from '../community/submission-codec.mjs';
import { packFixture, benchmarkFixture, errorFixture } from '../backend/fixtures.mjs';
import { localDatabase } from '../backend/local-db.mjs';
import { createService } from '../backend/service.mjs';
import { filterRows, comparisonError, csv, capacityGiB, rangeError, rangeBounds } from '../community/ui-model.mjs';
import { verifyAccess } from '../backend/worker.mjs';
import { GitHubArchive } from '../backend/archive.mjs';

const encode = text => new TextEncoder().encode(text);
const migration = await fs.readFile(new URL('../backend/migrations/0001.sql', import.meta.url), 'utf8');
const bench = await packFixture('benchmark', benchmarkFixture()), error = await packFixture('error', errorFixture());
function setup() {
  const DB = localDatabase(':memory:', migration), archives = new Map();
  const env = { DB, MODE: 'local', SITE_ORIGIN: 'http://localhost:8765', RATE_LIMIT_SALT: 'test-only', clientAddress: () => 'test', authorizeAdmin: async r => r.headers.get('authorization') === 'Bearer test-admin' ? 'test-admin' : null, verifyHuman: async token => token === 'test-human', ARCHIVE: { mode: 'test', process: async row => { archives.set(row.report_id, row.armor); return { state: 'published', mode: 'test', commit: 'test:verified', file_sha256: row.file_sha256 }; }, verify: async row => archives.has(row.report_id) } };
  const service = createService(env);
  const call = async (path, method = 'GET', body, token, type = 'application/json', origin) => {
    const headers = { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { 'Content-Type': type } : {}), ...(origin ? { Origin: origin } : {}) };
    const request = new Request('http://localhost:8765/v1' + path, { method, headers, ...(body !== undefined ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}) });
    const response = await service.fetch(request), value = await response.json(); return { status: response.status, headers: response.headers, value };
  };
  const begin = async (armor = bench) => {
    const decoded = inspectHeaders(armor), opened = await call('/upload-sessions', 'POST', { kind: decoded.kind, report_id: decoded.id, file_sha256: await sha256(encode(armor)), size_bytes: encode(armor).length });
    assert.equal(opened.status, 201, JSON.stringify(opened.value));
    const session = opened.value, browser = new URLSearchParams(new URL(session.verification_url).hash.slice(1)).get('authorize');
    return { ...session, browser, armor };
  };
  const authorize = s => call(`/upload-sessions/${s.session_id}/authorize`, 'POST', { consent: inspectHeaders(s.armor).kind === 'benchmark' ? 'public_benchmark' : env.REVIEW_MODE === 'github_pr' ? 'public_error' : 'private_error', turnstile_token: 'test-human' }, s.browser);
  const upload = s => call(`/upload-sessions/${s.session_id}/report`, 'POST', s.armor, s.session_token, 'text/plain; charset=utf-8');
  return { env, service, call, begin, authorize, upload, close: () => DB.close() };
}

test('both report types, manual results, UTC offsets, CRLF and CR decode losslessly', async () => {
  for (const [kind, payload] of [['benchmark', benchmarkFixture()], ['benchmark', benchmarkFixture(2, true)], ['error', errorFixture()]]) {
    const text = await packFixture(kind, payload);
    for (const version of [text, text.replace(/\n/g, '\r\n'), text.replace(/\n/g, '\r')]) assert.deepEqual((await decodeSubmission(encode(version))).payload, payload);
  }
  const p = errorFixture(); p.created_at_utc = '2026-10-19T01:02:03+00:00';
  assert.equal((await decodeSubmission(encode(await packFixture('error', p)))).payload.created_at_utc, p.created_at_utc);
});
test('strict JSON rejects duplicate/escaped duplicate keys, reserved keys, nonfinite and unsafe numeric values', () => {
  for (const source of ['{"x":1,"x":2}', '{"x":1,"\\u0078":2}', '{"__proto__":{}}', '{"x":NaN}', '{"x":1e400}', '{"x":9007199254740992}']) assert.throws(() => parseStrictJson(source));
  assert.deepEqual(parseStrictJson('{"x":{"x":1},"s":"\\\"x\\\":{}"}'), { x: { x: 1 }, s: '"x":{}' });
});
test('Rust-compatible rounding, Unicode normalization and truncation boundaries', () => {
  assert.equal(fixed2(2.125), '2.12'); assert.equal(fixed2(2.375), '2.38'); assert.equal(fixed2(1.005), '1.00');
  assert.equal(oneLine('a\u0000\t b', 50), 'a b'); assert.equal(oneLine('中'.repeat(240), 240), '中'.repeat(240) + '...');
});
test('envelope rejects tampered summary/hash/lengths, duplicate headers, BOM, invalid base64, trailing text and kind mismatch', async () => {
  for (const changed of [bench.replace('profile: standard', 'profile: full'), bench.replace(/sha256: [a-f0-9]/, 'sha256: 0'), bench.replace('decoded-bytes: ', 'decoded-bytes: 99'), bench.replace('kind: benchmark', 'kind: error'), bench.replace('kind: benchmark', 'kind: benchmark\nkind: benchmark'), '\ufeff' + bench, bench + 'extra', bench.replace('-----END MOE4ALL PAYLOAD-----', '!\n-----END MOE4ALL PAYLOAD-----')]) await assert.rejects(decodeSubmission(encode(changed)));
  await assert.rejects(decodeSubmission(encode(bench), { filename: 'wrong.m4b' }));
});
test('bounded gzip rejects bombs, CRC corruption and multiple members including an empty prefix', async () => {
  const valid = inspectHeaders(bench);
  for (const compressed of [gzipSync(Buffer.alloc(4194305)), Buffer.concat([gzipSync(''), Buffer.from(valid.base64, 'base64')]), Buffer.from(valid.base64, 'base64')]) {
    if (compressed.length === Number(valid.headers['compressed-bytes'])) compressed[compressed.length - 8] ^= 255;
    const wrapped = compressed.toString('base64').match(/.{1,76}/g).join('\n');
    const armor = bench.replace(/compressed-bytes: \d+/, `compressed-bytes: ${compressed.length}`).replace(/-----BEGIN MOE4ALL PAYLOAD-----[\s\S]*?-----END MOE4ALL PAYLOAD-----/, `-----BEGIN MOE4ALL PAYLOAD-----\n${wrapped}\n-----END MOE4ALL PAYLOAD-----`);
    await assert.rejects(decodeSubmission(encode(armor)));
  }
});
test('error report without description can be inspected locally but cannot be submitted', async () => {
  const text = await packFixture('error', errorFixture(5, ''));
  await assert.rejects(decodeSubmission(encode(text)), /描述/);
  assert.equal((await decodeSubmission(encode(text), { submission: false })).kind, 'error');
});
test('privacy scanner detects secrets and private fields without echoing their values', () => {
  const hits = privacyFindings({ error: { message: 'Bearer fake-secret-123456789' }, launch: { arguments: ['D:\\private\\model.gguf'] }, username: 'private-person' });
  assert.equal(hits.length, 3); assert.ok(!JSON.stringify(hits).includes('fake-secret')); assert.deepEqual(privacyFindings({ message: 'api_key=[REDACTED]' }), []);
});
test('file handshake requires browser role, explicit consent and human verification before data is stored', async t => {
  const a = setup(); t.after(a.close); const s = await a.begin();
  assert.equal((await a.upload(s)).status, 403);
  assert.equal((await a.call(`/upload-sessions/${s.session_id}/authorize`, 'POST', { consent: 'public_benchmark', turnstile_token: 'test-human' }, s.session_token)).status, 401);
  assert.equal((await a.call(`/upload-sessions/${s.session_id}/authorize`, 'POST', { consent: 'private_error', turnstile_token: 'test-human' }, s.browser)).status, 403);
  assert.equal((await a.call(`/upload-sessions/${s.session_id}/authorize`, 'POST', { consent: 'public_benchmark', turnstile_token: 'bad' }, s.browser)).status, 403);
  assert.equal((await a.service.store.one('SELECT count(*) AS n FROM reports')).n, 0);
  assert.equal((await a.authorize(s)).status, 200);
  assert.equal((await a.upload(s)).status, 202);
});
test('receipts are scoped and pending benchmark data never leaks into public rows', async t => {
  const a = setup(); t.after(a.close); const s = await a.begin(); await a.authorize(s); const r = (await a.upload(s)).value;
  assert.equal((await a.call(`/receipts/${r.receipt_id}`)).status, 401);
  assert.equal((await a.call(`/receipts/${r.receipt_id}`, 'GET', undefined, s.session_token)).status, 401);
  const receipt = await a.call(`/receipts/${r.receipt_id}`, 'GET', undefined, r.receipt_token); assert.equal(receipt.status, 200); assert.equal(receipt.value.status, 'pending_review'); assert.equal(receipt.value.payload, undefined);
  assert.equal((await a.call('/benchmarks')).value.rows.length, 0);
  assert.equal((await a.call('/admin/overview')).status, 401);
  assert.equal((await a.call(`/admin/reports/${r.receipt_id}`)).status, 401);
});
test('retries recover the same receipt; line-ending variations deduplicate by payload hash', async t => {
  const a = setup(); t.after(a.close); const s = await a.begin(); await a.authorize(s); const first = await a.upload(s), second = await a.upload(s);
  assert.equal(second.status, 200); assert.equal(second.value.receipt_id, first.value.receipt_id); assert.equal(second.value.duplicate, true);
  const crlf = await a.begin(bench.replace(/\n/g, '\r\n')); await a.authorize(crlf); const third = await a.upload(crlf);
  assert.equal(third.status, 200); assert.equal(third.value.receipt_id, first.value.receipt_id); assert.notEqual(third.value.submitted_file_sha256, third.value.file_sha256);
  assert.equal((await a.service.store.one('SELECT count(*) AS n FROM reports')).n, 1);
});
test('same report ID with different payload conflicts; session byte binding forbids altered uploads', async t => {
  const a = setup(); t.after(a.close); const s = await a.begin(); await a.authorize(s); await a.upload(s);
  const p = benchmarkFixture(); p.contexts[0].prefill.tokens_per_second++;
  const changed = await a.begin(await packFixture('benchmark', p)); await a.authorize(changed); assert.equal((await a.upload(changed)).status, 409);
  assert.equal((await a.upload({ ...s, armor: s.armor + '\n' })).status, 409);
});
test('cancelled/expired sessions cannot upload; foreign origins and wrong content types are blocked', async t => {
  const a = setup(); t.after(a.close); const s = await a.begin(); await a.authorize(s);
  await a.call(`/upload-sessions/${s.session_id}/cancel`, 'POST', {}, s.browser); assert.equal((await a.upload(s)).status, 409);
  await a.service.store.run('UPDATE upload_sessions SET expires_at=? WHERE id=?', '2000-01-01T00:00:00Z', s.session_id); assert.equal((await a.upload(s)).status, 410);
  assert.equal((await a.call('/health', 'GET', undefined, undefined, undefined, 'https://evil.invalid')).status, 403);
  assert.equal((await a.call('/upload-sessions', 'POST', '{}', undefined, 'text/plain')).status, 415);
});
test('approve binds reviewed hash, archives once and exposes only safe derived benchmark rows', async t => {
  const a = setup(); t.after(a.close); const s = await a.begin(); await a.authorize(s); const r = (await a.upload(s)).value;
  assert.equal((await a.call(`/admin/reports/${r.receipt_id}/review`, 'POST', { action: 'approve', file_sha256: '0'.repeat(64) }, 'test-admin')).status, 409);
  const approved = await a.call(`/admin/reports/${r.receipt_id}/review`, 'POST', { action: 'approve', file_sha256: r.file_sha256 }, 'test-admin'); assert.equal(approved.status, 200); assert.equal(approved.value.status, 'published');
  const publicRows = (await a.call('/benchmarks')).value.rows; assert.equal(publicRows.length, 9); assert.ok(publicRows.every(row => !('logs' in row) && !('description' in row) && row.authenticity === 'self_reported'));
  assert.equal((await a.call(`/admin/reports/${r.receipt_id}/cleanup`, 'POST', { file_sha256: r.file_sha256 }, 'test-admin')).status, 409);
});
test('error reports stay private, group by stable failure signature and support split and status updates', async t => {
  const a = setup(); t.after(a.close);
  const results = [];
  for (const i of [0, 1]) { const s = await a.begin(await packFixture('error', errorFixture(i))); await a.authorize(s); results.push((await a.upload(s)).value); }
  const overview = (await a.call('/admin/overview', 'GET', undefined, 'test-admin')).value;
  assert.equal(overview.groups.length, 1); assert.equal(overview.groups[0].report_count, 2);
  assert.equal((await a.call('/benchmarks')).value.rows.length, 0);
  const id = overview.groups[0].id;
  assert.equal((await a.call(`/admin/groups/${id}`, 'PATCH', { status: 'resolved', resolution_version: '1.0.4' }, 'test-admin')).status, 200);
  assert.equal((await a.call(`/receipts/${results[0].receipt_id}`, 'GET', undefined, results[0].receipt_token)).value.resolution_version, '1.0.4');
  assert.equal((await a.call('/admin/groups/move', 'POST', { receipt_id: results[0].receipt_id, group_id: null }, 'test-admin')).status, 200);
  assert.equal((await a.call('/admin/overview', 'GET', undefined, 'test-admin')).value.groups.length, 2);
});
test('limits, human failures and privacy findings return bounded actionable errors, never a success', async t => {
  const a = setup(); t.after(a.close);
  const p = errorFixture(); p.description = 'Bearer secret-private-123456789';
  const s = await a.begin(await packFixture('error', p)); await a.authorize(s); const result = await a.upload(s);
  assert.equal(result.status, 422); assert.equal(result.value.error.code, 'sensitive_content'); assert.ok(!JSON.stringify(result.value).includes('secret-private'));
  const session = await a.call('/upload-sessions', 'POST', { kind: 'benchmark', report_id: 'test', file_sha256: 'a'.repeat(64), size_bytes: 524289 }); assert.equal(session.status, 400);
  assert.equal(result.headers.get('cache-control'), 'no-store');
});
test('ranking filters by configuration policy, not benchmark collection mode', () => {
  const rows = benchmarkRows(benchmarkFixture()), manual = benchmarkRows(benchmarkFixture(2, true));
  assert.equal(filterRows([...rows, ...manual], { strategy: ['aggressive'] }).length, rows.length);
  assert.equal(filterRows([...rows, ...manual], { strategy: ['manual'] }).length, manual.length);
  assert.equal(filterRows([...rows, ...manual], {}).length, rows.length + manual.length);
  assert.notEqual(comparisonError([rows[0]], rows[1]), '');
  assert.ok(csv([{ ...rows[0], gpu: '=HYPERLINK("x")' }]).includes("'=HYPERLINK"));
});

test('multi-select facets use OR within groups and AND across groups without changing rows', () => {
  const rows = [...benchmarkRows(benchmarkFixture()), ...benchmarkRows(benchmarkFixture(2, true))];
  const before = JSON.stringify(rows);
  const selected = filterRows(rows, { context: ['6144', '30720'], slots: ['1', '2'], strategy: ['aggressive'], mtp: ['false'] });
  assert.equal(selected.length, 4);
  assert.equal(filterRows(rows, { context: [], profile: [] }).length, rows.length);
  assert.equal(filterRows(rows, { mtp: ['true'] }).length, 0);
  assert.equal(filterRows(rows, { strategy: ['aggressive', 'manual'] }).length, rows.length);
  assert.equal(filterRows(rows, { os: ['windows'], context: ['153600'], slots: ['3'] }).length, 1);
  assert.equal(filterRows(rows, { context: ['30720'], strategy: ['aggressive'], search: ' radeon ' }).length, 3);
  assert.equal(JSON.stringify(rows), before);
});

test('context ranges are inclusive, open-ended and support arbitrary future report lengths', () => {
  const first = benchmarkRows(benchmarkFixture())[0];
  const rows = [6144, 12345, 32768, 65536, 150001, 300000].map(context => ({ ...first, context }));
  assert.deepEqual(filterRows(rows, { contextMode: 'range', contextMin: '12345', contextMax: '65536' }).map(r => r.context), [12345, 32768, 65536]);
  assert.equal(filterRows(rows, { contextMode: 'range', contextMin: '', contextMax: '12345' }).length, 2);
  assert.equal(filterRows(rows, { contextMode: 'range', contextMin: '150001', contextMax: '' }).length, 2);
  assert.equal(filterRows(rows, { contextMode: 'range', contextMin: '', contextMax: '', context: ['6144'] }).length, rows.length);
  assert.equal(filterRows(rows, { contextMode: 'points', contextMin: '999999', contextMax: '', context: ['12345', '300000'] }).length, 2);
  assert.equal(filterRows(rows, { contextMode: 'range', contextMin: '65536', contextMax: '12345' }).length, 0);
  assert.ok(rangeError('65536', '12345'));
  assert.ok(rangeError('-1', '10'));
  assert.ok(rangeError('Infinity', ''));
  assert.equal(rangeError('', ''), '');
});

test('capacity filters use reported total GiB and unknown memory is not treated as zero', () => {
  const G = 1073741824, first = benchmarkRows(benchmarkFixture())[0];
  const rows = [[32, 8], [64, 16], [96, 23.98], [128, 32], [null, null]].map(([ram, vram]) => ({ ...first, ram_bytes: ram === null ? null : ram * G, vram_bytes: vram === null ? null : vram * G }));
  assert.equal(capacityGiB(23.98 * G), 24);
  assert.equal(capacityGiB(null), null);
  assert.equal(filterRows(rows, { ram: ['64', '96'], vram: ['16', '24'] }).length, 2);
  assert.equal(filterRows(rows, { ramMin: '64', ramMax: '96', vramMin: '24', vramMax: '' }).length, 1);
  assert.equal(filterRows(rows, { vramMin: '0', vramMax: '0' }).length, 0);
  assert.equal(filterRows(rows, { ram: ['unknown'] }).length, 1);
  assert.equal(filterRows(rows, { ramMin: '', ramMax: '' }).length, rows.length);
});

test('range bounds come from database metadata rather than selected pages or hardcoded limits', () => {
  const G = 1073741824, rows = [{ context: 12345, ram_bytes: 48 * G, vram_bytes: 12 * G }, { context: 777777, ram_bytes: 192 * G, vram_bytes: 47.98 * G }];
  assert.deepEqual(rangeBounds(rows, 'context'), { min: 12345, max: 777777 });
  assert.deepEqual(rangeBounds(rows, 'ram'), { min: 48, max: 192 });
  assert.deepEqual(rangeBounds(rows, 'vram'), { min: 12, max: 48 });
  assert.deepEqual(rangeBounds(rows.slice(0, 1), 'context', { context: { min: 1024, max: 1000000 } }), { min: 1024, max: 1000000 });
  assert.deepEqual(rangeBounds([], 'context'), { min: null, max: null });
  assert.deepEqual(rangeBounds([{ ram_bytes: null }], 'ram'), { min: null, max: null });
  assert.deepEqual(rangeBounds([{ context: 2048 }], 'context'), { min: 2048, max: 2048 });
});

test('public metadata covers all published measurements, excluding pending records beyond the row page cap', async t => {
  const a = setup(); t.after(a.close);
  const now = new Date().toISOString(), first = benchmarkRows(benchmarkFixture())[0], G = 1073741824;
  await a.service.store.batch([
    ['INSERT INTO reports(receipt_id,kind,report_id,file_sha256,payload_sha256,summary_json,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)', 'bounds_report', 'benchmark', 'bounds_report', 'a'.repeat(64), 'b'.repeat(64), '[]', 'published', now, now],
    ['INSERT INTO benchmark_rows(id,receipt_id,row_json) VALUES(?,?,?)', 'bounds_rows', 'bounds_report', JSON.stringify(Array.from({ length: 1001 }, (_, i) => ({ ...first, id: String(i), context: i === 1000 ? 777777 : 12345, ram_bytes: i === 1000 ? 192 * G : 48 * G, vram_bytes: i === 1000 ? 47.98 * G : 12 * G })))],
    ['INSERT INTO reports(receipt_id,kind,report_id,file_sha256,payload_sha256,summary_json,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)', 'pending_bounds', 'benchmark', 'pending_bounds', 'c'.repeat(64), 'd'.repeat(64), '[]', 'pending_review', now, now],
    ['INSERT INTO benchmark_rows(id,receipt_id,row_json) VALUES(?,?,?)', 'pending_bounds_rows', 'pending_bounds', JSON.stringify([{ ...first, context: 9999999 }])]
  ]);
  const result = (await a.call('/benchmarks')).value;
  assert.equal(result.rows.length, 1000);
  assert.equal(result.total, 1001);
  assert.deepEqual(result.bounds.context, { min: 12345, max: 777777 });
  assert.deepEqual(result.bounds.ram, { min: 48, max: 192 });
  assert.deepEqual(result.bounds.vram, { min: 12, max: 48 });
});

test('projection normalizes engine auto_profile without inferring it from suite/manual profile', () => {
  const p = benchmarkFixture(2, true);
  p.configuration.auto_profile = 'Conservative';
  assert.equal(benchmarkRows(p)[0].auto_profile, 'conservative');
  p.configuration.auto_profile = 'Aggressive';
  assert.equal(benchmarkRows(p)[0].auto_profile, 'aggressive');
  p.configuration.auto_profile = 'manual';
  assert.equal(benchmarkRows(p)[0].auto_profile, 'manual');
  delete p.configuration.auto_profile;
  const unknown = benchmarkRows(p)[0];
  assert.equal(unknown.auto_profile, null);
  assert.equal(filterRows([unknown], { strategy: ['unknown'] }).length, 1);
  assert.equal(filterRows([unknown], { strategy: ['manual'] }).length, 0);
});
test('invalid dimension types and malformed repetition matrices cannot enter the leaderboard', async () => {
  for (const mutate of [p => { p.model.name = {}; }, p => { p.hardware.gpu.name = []; }, p => { p.configuration.mtp = 'false'; }, p => { p.contexts[0].decode[0].repetitions[0].sections = []; }, p => { p.contexts[0].decode[0].repetitions[0].lane_tokens_per_second[0] = [1, 2]; }]) {
    const p = benchmarkFixture(); mutate(p); await assert.rejects(decodeSubmission(encode(await packFixture('benchmark', p))));
  }
});
test('admin pagination returns bounded metadata without reading report bodies', async t => {
  const a = setup(); t.after(a.close); const now = new Date().toISOString();
  await a.service.store.batch(Array.from({ length: 201 }, (_, i) => ['INSERT INTO reports(receipt_id,kind,report_id,file_sha256,payload_sha256,summary_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)', `rc_${i}`, 'error', `report_${i}`, 'a'.repeat(64), 'b'.repeat(64), '[]', now, now]));
  const overview = (await a.call('/admin/overview', 'GET', undefined, 'test-admin')).value;
  assert.equal(overview.reports.length, 200); assert.equal(overview.next_offset, 200); assert.equal(overview.total, 201);
  const next = (await a.call('/admin/reports?offset=200&limit=200', 'GET', undefined, 'test-admin')).value;
  assert.equal(next.reports.length, 1); assert.equal(next.next_offset, null); assert.equal(next.reports[0].armor, undefined);
});
test('worker denies forged Access headers without valid JWT configuration and signature', async () => {
  assert.equal(await verifyAccess(new Request('https://example.invalid', { headers: { 'cf-access-authenticated-user-email': 'owner@example.invalid' } }), {}), null);
});
test('Access accepts a valid owner JWT and rejects altered signatures or a different owner', async t => {
  const keys = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  const jwk = await crypto.subtle.exportKey('jwk', keys.publicKey); jwk.kid = 'qa-key';
  const original = globalThis.fetch; globalThis.fetch = async () => Response.json({ keys: [jwk] }); t.after(() => { globalThis.fetch = original; });
  const b64 = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const env = { ACCESS_ISSUER: 'https://qa-example.cloudflareaccess.com', ACCESS_AUD: 'qa-audience', ADMIN_EMAIL: 'owner@example.invalid' };
  const data = `${b64({ alg: 'RS256', kid: 'qa-key' })}.${b64({ iss: env.ACCESS_ISSUER, aud: [env.ACCESS_AUD], email: env.ADMIN_EMAIL, exp: Math.floor(Date.now() / 1000) + 60 })}`;
  const signature = Buffer.from(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', keys.privateKey, encode(data))).toString('base64url');
  const request = token => new Request('https://api.example.invalid/v1/admin/overview', { headers: { 'cf-access-jwt-assertion': token } });
  assert.equal(await verifyAccess(request(`${data}.${signature}`), env), env.ADMIN_EMAIL);
  assert.equal(await verifyAccess(request(`${data}.${signature.slice(0, -5)}aaaaa`), env), null);
  assert.equal(await verifyAccess(request(`${data}.${signature}`), { ...env, ADMIN_EMAIL: 'someone-else@example.invalid' }), null);
});
test('concurrent submissions atomically deduplicate and return working credentials', async t => {
  const a = setup(); t.after(a.close);
  const [s1, s2] = await Promise.all([a.begin(), a.begin()]); await Promise.all([a.authorize(s1), a.authorize(s2)]);
  const results = await Promise.all([a.upload(s1), a.upload(s2)]);
  assert.ok(results.every(r => r.status === 202 || r.status === 200), JSON.stringify(results));
  assert.equal(results[0].value.receipt_id, results[1].value.receipt_id);
  assert.equal((await a.service.store.one('SELECT count(*) AS n FROM reports')).n, 1);
  assert.equal((await a.service.store.one('SELECT count(*) AS n FROM benchmark_rows')).n, 1);
  for (const r of results) assert.equal((await a.call(`/receipts/${r.value.receipt_id}`, 'GET', undefined, r.value.receipt_token)).status, 200);
});
test('lost response retries recover the same token without creating unbounded receipt grants', async t => {
  const a = setup(); t.after(a.close); const s = await a.begin(); await a.authorize(s);
  const first = await a.upload(s), next = await a.upload(s);
  assert.equal(first.value.receipt_token, next.value.receipt_token);
  assert.equal((await a.service.store.one('SELECT count(*) AS n FROM receipt_grants')).n, 1);
});
test('conflicting review actions can only claim a pending report once', async t => {
  const a = setup(); t.after(a.close); const s = await a.begin(); await a.authorize(s); const r = (await a.upload(s)).value;
  const actions = await Promise.all(['reject', 'approve'].map(action => a.call(`/admin/reports/${r.receipt_id}/review`, 'POST', { action, file_sha256: r.file_sha256 }, 'test-admin')));
  assert.equal(actions.filter(r => r.status === 200).length, 1); assert.equal(actions.filter(r => r.status === 409).length, 1);
});
test('missing archive configuration leaves pending reports unchanged; failed archives retain originals', async t => {
  const a = setup(); t.after(a.close); const s = await a.begin(); await a.authorize(s); const r = (await a.upload(s)).value;
  a.env.ARCHIVE = null;
  assert.equal((await a.call(`/admin/reports/${r.receipt_id}/review`, 'POST', { action: 'approve', file_sha256: r.file_sha256 }, 'test-admin')).status, 503);
  assert.equal((await a.service.store.one('SELECT status FROM reports WHERE receipt_id=?', r.receipt_id)).status, 'pending_review');
  a.env.ARCHIVE = { process: async () => { throw new Error('test failure'); } };
  assert.equal((await a.call(`/admin/reports/${r.receipt_id}/review`, 'POST', { action: 'approve', file_sha256: r.file_sha256 }, 'test-admin')).status, 500);
  const row = await a.service.store.one('SELECT * FROM reports WHERE receipt_id=?', r.receipt_id); assert.equal(row.status, 'archiving'); assert.ok(row.armor);
});
test('cleanup requires seven days and a fresh archive check; receipt survives cleanup', async t => {
  const a = setup(); t.after(a.close); const s = await a.begin(); await a.authorize(s); const r = (await a.upload(s)).value;
  await a.call(`/admin/reports/${r.receipt_id}/review`, 'POST', { action: 'approve', file_sha256: r.file_sha256 }, 'test-admin');
  await a.service.store.run('UPDATE reports SET updated_at=? WHERE receipt_id=?', '2000-01-01T00:00:00Z', r.receipt_id);
  assert.equal((await a.call(`/admin/reports/${r.receipt_id}/cleanup`, 'POST', { file_sha256: r.file_sha256 }, 'test-admin')).status, 200);
  assert.equal((await a.service.store.one('SELECT armor FROM reports WHERE receipt_id=?', r.receipt_id)).armor, null);
  assert.equal((await a.call(`/receipts/${r.receipt_id}`, 'GET', undefined, r.receipt_token)).value.status, 'published');
});
test('inbox storage ceiling and request limits fail closed', async t => {
  const a = setup(); t.after(a.close); a.env.MAX_STORED_BYTES = 1;
  const meta = { kind: 'benchmark', report_id: 'small', file_sha256: 'a'.repeat(64), size_bytes: 2 };
  assert.equal((await a.call('/upload-sessions', 'POST', meta)).status, 503);
  a.env.MAX_STORED_BYTES = 134217728;
  for (let i = 0; i < 19; i++) assert.equal((await a.call('/upload-sessions', 'POST', meta)).status, 201);
  assert.equal((await a.call('/upload-sessions', 'POST', meta)).status, 429);
});
test('Git main importer requires a server credential and independently validates downloaded artifacts', async t => {
  const a = setup(); t.after(a.close); a.env.GIT_IMPORT_TOKEN = 'server-only-test'; a.env.GITHUB_REPOSITORY = 'example/test';
  a.env.ARCHIVE.readMerged = async () => encode(bench);
  const input = { commit: 'a'.repeat(40), path: 'benchmark-database/v1/2026-10/example-benchmark-00.m4b' };
  assert.equal((await a.call('/integrations/github/import', 'POST', input)).status, 401);
  const first = await a.call('/integrations/github/import', 'POST', input, 'server-only-test'); assert.equal(first.status, 200, JSON.stringify(first.value)); assert.equal(first.value.imported, true);
  assert.equal((await a.call('/benchmarks')).value.rows.length, 9);
  assert.equal((await a.call('/integrations/github/import', 'POST', input, 'server-only-test')).value.duplicate, true);
});
test('GitHub archive never merges an open PR, verifies manual merge, and records rejection', async () => {
  const fileSha = await sha256(encode(bench)), contents = Buffer.from(bench).toString('base64'), commit = 'a'.repeat(40), head = 'b'.repeat(40), merged = 'c'.repeat(40), calls = [];
  const row = { report_id: 'example-benchmark-00', armor: bench, file_sha256: fileSha, payload_sha256: inspectHeaders(bench).headers.sha256 };
  let checked = false, mergeObserved = false, manuallyMerged = false, closed = false;
  const fetcher = async (url, options) => {
    const route = url.split('/repos/example/test/')[1]; calls.push([route, options.method]); let result;
    if (route === 'git/ref/heads/main') result = { object: { sha: commit } };
    else if (route.startsWith('contents/') && route.endsWith('?ref=' + commit)) return new Response('{}', { status: 404 });
    else if (route.startsWith('pulls?')) result = [{ number: 12, head: { sha: head }, state: closed ? 'closed' : 'open', merged: manuallyMerged, merge_commit_sha: merged, html_url: 'https://github.com/example/test/pull/12' }];
    else if (route.startsWith('pulls/12/files?')) result = [{ filename: 'benchmark-database/v1/2026-10/example-benchmark-00.m4b', status: 'added' }];
    else if (route.startsWith('contents/')) result = { content: contents };
    else if (route.startsWith('commits/')) result = { check_runs: checked ? [{ name: 'validate', head_sha: head, status: 'completed', conclusion: 'success' }] : [] };
    else if (route === 'pulls/12/merge') { assert.equal(JSON.parse(options.body).sha, head); mergeObserved = true; result = { merged: true, sha: merged }; }
    else if (route.startsWith('compare/')) result = { status: 'identical' };
    else throw new Error('Unexpected mock route ' + route);
    return Response.json(result);
  };
  const archive = new GitHubArchive({ token: 'test-only', repository: 'example/test', requiredChecks: ['validate'], fetcher });
  assert.equal((await archive.process(row)).state, 'pending'); assert.equal(mergeObserved, false);
  checked = true; assert.equal((await archive.process(row)).state, 'pending'); assert.equal(mergeObserved, false);
  closed = true; assert.equal((await archive.process(row)).state, 'rejected');
  manuallyMerged = true; assert.equal((await archive.process(row)).state, 'published'); assert.equal(mergeObserved, false);
  assert.ok(!calls.some(([route]) => route.startsWith('commits/') || route.endsWith('/merge')));
});

test('public PR mode accepts both kinds, requires public error consent and never needs Access', async t => {
  const a = setup(); t.after(a.close); a.env.REVIEW_MODE = 'github_pr';
  const api = createService(a.env);
  a.service.fetch = api.fetch;
  const submissions = [];
  a.env.ARCHIVE.process = async row => { submissions.push(row); return { state: 'pending', mode: 'github', pr_number: 12, public_url: 'https://github.com/example/test/pull/12', file_sha256: row.file_sha256 }; };
  for (const armor of [bench, error]) {
    const s = await a.begin(armor);
    if (inspectHeaders(armor).kind === 'error') assert.equal((await a.call(`/upload-sessions/${s.session_id}/authorize`, 'POST', { consent: 'private_error', turnstile_token: 'test-human' }, s.browser)).status, 403);
    await a.authorize(s);
    const result = await a.upload(s); assert.equal(result.status, 202, JSON.stringify(result.value));
    assert.equal(result.value.status, 'pending_review'); assert.match(result.value.public_url, /\/pull\/12$/);
    assert.equal((await a.call(`/admin/reports/${result.value.receipt_id}/review`, 'POST', { action: 'approve', file_sha256: result.value.file_sha256 }, 'test-admin')).status, 404);
    assert.equal((await a.call('/benchmarks')).value.rows.length, 0);
  }
  assert.deepEqual(submissions.map(row => row.kind), ['benchmark', 'error']);
});

test('public PR mode preserves unconsented private reports and recovers after GitHub failure', async t => {
  const a = setup(); t.after(a.close);
  const old = await a.begin(error); await a.authorize(old); const privateReport = (await a.upload(old)).value;
  const oldReady = await a.begin(await packFixture('error', errorFixture(5))); await a.authorize(oldReady);
  a.env.REVIEW_MODE = 'github_pr'; const api = createService(a.env); a.service.fetch = api.fetch;
  const sent = []; let fail = true, merged = false;
  a.env.ARCHIVE.process = async row => { if (fail) throw new Error('GitHub unavailable'); sent.push(row); return { state: merged ? 'published' : 'pending', mode: 'github', commit: merged ? 'a'.repeat(40) : undefined, file_sha256: row.file_sha256, public_url: 'https://github.com/example/test/pull/1' }; };
  assert.equal((await a.upload(oldReady)).status, 403);
  const s = await a.begin(); await a.authorize(s); const received = await a.upload(s); assert.equal(received.status, 202); assert.equal(received.value.public_url, null);
  fail = false; await api.syncPending(); assert.equal(sent.length, 1); assert.equal(sent[0].kind, 'benchmark');
  assert.equal((await api.store.one('SELECT publication_consent FROM reports WHERE receipt_id=?', privateReport.receipt_id)).publication_consent, null);
  merged = true; await api.syncPending(); assert.equal((await a.call('/benchmarks')).value.rows.length, 9);
});

test('GitHub creates one public PR for either file kind and reuses it without writing main', async () => {
  for (const [kind, armor] of [['benchmark', bench], ['error', error]]) {
    const decoded = await decodeSubmission(encode(armor)), fileSha = decoded.fileSha256;
    const path = `${kind === 'benchmark' ? 'benchmark-database' : 'error-database'}/v1/2026-10/${decoded.id}.${kind === 'benchmark' ? 'm4b' : 'm4e'}`;
    const row = { kind, report_id: decoded.id, armor, file_sha256: fileSha, payload_sha256: decoded.payloadSha256 };
    let pr = null, source = null, creations = 0;
    const fetcher = async (url, options) => {
      const route = url.split('/repos/example/test/')[1];
      assert.ok(!route.endsWith('/merge') && !route.startsWith('issues'));
      const body = options.body ? JSON.parse(options.body) : null;
      if (route === 'git/ref/heads/main') return Response.json({ object: { sha: 'a'.repeat(40) } });
      if (route === 'git/refs') { assert.equal(body.ref, `refs/heads/community/${kind}/${fileSha}`); return Response.json({}); }
      if (route.startsWith('pulls?')) return Response.json(pr ? [pr] : []);
      if (route === 'pulls') {
        creations++; assert.equal(body.base, 'main'); assert.equal(body.head, `community/${kind}/${fileSha}`); assert.match(body.body, /awaiting maintainer review/);
        pr = { number: 9, head: { sha: 'b'.repeat(40) }, state: 'open', merged: false, html_url: 'https://github.com/example/test/pull/9' }; return Response.json(pr);
      }
      if (route.startsWith('pulls/9/files?')) return Response.json([{ filename: path, status: 'added' }]);
      if (route === `contents/${path}` && options.method === 'PUT') { assert.equal(body.branch, `community/${kind}/${fileSha}`); source = body.content; return Response.json({}); }
      if (route.startsWith(`contents/${path}?ref=`)) {
        if (route.endsWith('a'.repeat(40)) || !source) return new Response('{}', { status: 404 });
        return Response.json({ content: source });
      }
      throw new Error('Unexpected request');
    };
    const archive = new GitHubArchive({ token: 'test-only', repository: 'example/test', fetcher });
    assert.equal((await archive.process(row)).state, 'pending'); assert.equal((await archive.process(row)).state, 'pending'); assert.equal(creations, 1);
    assert.equal(Buffer.from(source, 'base64').toString(), armor);
  }
});

test('concurrent public PR synchronization uses a lease and never publishes before merge', async t => {
  const a = setup(); t.after(a.close); a.env.REVIEW_MODE = 'github_pr'; const api = createService(a.env); a.service.fetch = api.fetch;
  let count = 0, release; const gate = new Promise(resolve => { release = resolve; });
  a.env.ARCHIVE.process = async row => { count++; await gate; return { state: 'pending', mode: 'github', file_sha256: row.file_sha256 }; };
  const s = await a.begin(); await a.authorize(s);
  const first = a.upload(s);
  while (!count) await new Promise(resolve => setTimeout(resolve, 1));
  const second = a.upload(s);
  assert.equal((await second).status, 200); release(); assert.equal((await first).status, 202); assert.equal(count, 1);
  assert.equal((await a.call('/benchmarks')).value.rows.length, 0);
});
test('production community publishes an allowlisted static index, never local admin or fixtures', async () => {
  const build = await fs.readFile(new URL('../scripts/build-site.mjs', import.meta.url), 'utf8');
  assert.match(build, /const communityFiles =/);
  assert.match(build, /readSnapshot/);
  assert.doesNotMatch(build, /'admin.html'|'preview-data.mjs'|'fixtures.mjs'/);
  assert.doesNotMatch(await fs.readFile(new URL('../community/app.mjs', import.meta.url), 'utf8'), /name="decode"|name="prefill"|analytics\.js|cloudflareinsights/);
});
test('independent engine Python decoder accepts both website test envelopes', { skip: !process.env.MOE4ALL_INDEPENDENT_DECODER }, () => {
  for (const armor of [bench, error]) {
    const source = 'import importlib.util,sys;spec=importlib.util.spec_from_file_location("decoder",sys.argv[1]);m=importlib.util.module_from_spec(spec);sys.modules["decoder"]=m;spec.loader.exec_module(m);s=m.decode_text(sys.stdin.buffer.read().decode("utf-8"));print(s.submission_id)';
    const result = spawnSync(process.env.MOE4ALL_PYTHON || 'python', ['-B', '-c', source, process.env.MOE4ALL_INDEPENDENT_DECODER], { input: armor, encoding: 'utf8', windowsHide: true });
    assert.equal(result.status, 0, result.stderr); assert.ok(result.stdout.includes('example-'));
  }
});
