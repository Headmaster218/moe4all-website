import test from 'node:test';
import assert from 'node:assert/strict';
import { uploadStore, sameReport, submissionRequest, humanVerifier } from '../community/upload-support.mjs';

test('tab recovery is service-bound, time-limited and tolerates blocked storage', () => {
  const values = new Map(), storage = { getItem: k => values.get(k), setItem: (k, v) => values.set(k, v), removeItem: k => values.delete(k) };
  let now = 1000000;
  const store = uploadStore(() => storage, 'https://api.example/v1', () => now);
  const credential = { id: 'us_fixture', token: 'browser-fixture' };
  assert.equal(store.write('confirmation', credential), true);
  assert.deepEqual(store.read('confirmation'), credential);
  store.write('confirmation', { ...credential, report: 'private-body', turnstile_token: 'one-use' });
  assert.ok(![...values.values()].join('').includes('private-body')); assert.ok(![...values.values()].join('').includes('one-use'));
  assert.equal(uploadStore(() => storage, 'https://other.example/v1', () => now).read('confirmation'), null);
  store.write('confirmation', credential); now += 900001;
  assert.equal(store.read('confirmation'), null);
  const blocked = uploadStore(() => { throw new Error('blocked'); }, 'test');
  assert.equal(blocked.write('confirmation', credential), false); assert.equal(blocked.read('confirmation'), null); blocked.clear('confirmation');
  values.set('moe4all-upload-v1:confirmation', '{bad'); assert.equal(store.read('confirmation'), null);
});

test('resuming a file requires identical kind, ID, bytes and hash', () => {
  const decoded = { id: 'fixture', kind: 'benchmark', fileSha256: 'a'.repeat(64), sizeBytes: 512 };
  const session = { report_id: decoded.id, kind: decoded.kind, file_sha256: decoded.fileSha256, size_bytes: decoded.sizeBytes };
  assert.equal(sameReport(session, decoded), true);
  for (const [key, value] of [['id', 'other'], ['kind', 'error'], ['fileSha256', 'b'.repeat(64)], ['sizeBytes', 513]]) assert.equal(sameReport(session, { ...decoded, [key]: value }), false);
});

test('only reads retry automatically; failed writes retain stage and request ID', async () => {
  let calls = 0;
  const fetcher = async (_, init) => { assert.equal(init.credentials, 'include'); if (++calls === 1) throw new TypeError('network'); return Response.json({ state: 'ready' }); };
  assert.deepEqual(await submissionRequest('https://test', '/status', {}, fetcher, async () => {}), { state: 'ready' }); assert.equal(calls, 2);
  calls = 0;
  await assert.rejects(submissionRequest('https://test', '/authorize', { method: 'POST', stage: '授权' }, async () => { calls++; throw new TypeError('network'); }), error => error.stage === '授权' && error.code === 'network_error');
  assert.equal(calls, 1);
  await assert.rejects(submissionRequest('https://test', '/report', { method: 'POST', stage: '发送报告' }, async () => Response.json({ request_id: 'req_fixture', error: { code: 'inbox_full', message: '缓冲已满' } }, { status: 503 })), error => error.stage === '发送报告' && error.requestId === 'req_fixture' && error.code === 'inbox_full');
});

function widgetFixture() {
  const scripts = [], renders = [], tokens = [], failures = [], removed = [];
  let target = {};
  const win = {}, doc = { querySelector: () => target, createElement: () => ({ remove() { this.removed = true; } }), head: { append: s => scripts.push(s) } };
  const loaded = () => { win.turnstile = { render: (element, options) => { renders.push({ element, options }); return renders.length; }, remove: id => removed.push(id) }; };
  const verifier = humanVerifier(win, doc, { token: t => tokens.push(t), failure: m => failures.push(m), timeoutMs: 30 });
  return { scripts, renders, tokens, failures, removed, loaded, verifier, replace: () => { target = {}; } };
}

test('failed or timed out CAPTCHA load can be retried, without reloading the page', async () => {
  const f = widgetFixture(), info = { turnstile_site_key: 'fixture' };
  const first = f.verifier.prepare(info); f.scripts[0].onerror(); await assert.rejects(first, /无法加载/);
  assert.equal(f.scripts[0].removed, true);
  const second = f.verifier.prepare(info, true); f.loaded(); f.scripts[1].onload(); await second;
  f.renders[0].options.callback('one-use'); assert.equal(f.tokens.at(-1), 'one-use');
  await f.verifier.prepare(info); assert.equal(f.tokens.at(-1), 'one-use'); assert.equal(f.renders.length, 1);
  for (const callback of ['expired-callback', 'timeout-callback', 'error-callback']) { f.renders[0].options[callback]('600010'); assert.equal(f.tokens.at(-1), ''); }
  assert.equal(f.failures.length, 3);
  await f.verifier.prepare(info, true); f.renders[0].options.callback('stale'); assert.equal(f.tokens.at(-1), '');
  f.renders[1].options.callback('fresh'); assert.equal(f.tokens.at(-1), 'fresh');
  const timed = widgetFixture(); await assert.rejects(timed.verifier.prepare(info), /超时/); assert.equal(timed.scripts[0].removed, true);
});

test('late CAPTCHA loads cannot attach a widget after navigation', async () => {
  const f = widgetFixture(), waiting = f.verifier.prepare({ turnstile_site_key: 'fixture' });
  f.verifier.dispose(); f.replace(); f.loaded(); f.scripts[0].onload(); await waiting;
  assert.equal(f.renders.length, 0);
});
