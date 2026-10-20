import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import worker, { verifyAccess } from '../backend/worker.mjs';
import { GitHubArchive } from '../backend/archive.mjs';
import { localDatabase } from '../backend/local-db.mjs';

const schema = await fs.readFile(new URL('../backend/migrations/0001.sql', import.meta.url), 'utf8');

// Node accepts redirect:"error", but the Workers runtime only accepts follow/manual.
function workersFetch(handler) {
  return async (url, options = {}) => {
    if (options.redirect && !['follow', 'manual'].includes(options.redirect)) throw new TypeError('Unsupported redirect mode');
    assert.equal(options.redirect, 'manual');
    return handler(url, options);
  };
}

test('Worker authorization reaches Siteverify with Workers-compatible options', async t => {
  const db = localDatabase(':memory:', schema), deferred = [];
  const env = { DB: db, RATE_LIMIT_SALT: 'fixture', SITE_ORIGIN: 'https://moe4all.com', TURNSTILE_SECRET: 'fixture-secret', TURNSTILE_SITE_KEY: 'fixture-site', GITHUB_TOKEN: 'fixture-token', GITHUB_REPOSITORY: 'owner/repo' };
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; db.close(); });
  let answer = { success: false }, status = 200, calls = 0;
  globalThis.fetch = workersFetch((url, options) => {
    calls++;
    assert.equal(url, 'https://challenges.cloudflare.com/turnstile/v0/siteverify');
    assert.equal(options.method, 'POST');
    assert.equal(options.body.get('secret'), env.TURNSTILE_SECRET);
    return Response.json(answer, { status });
  });
  const call = (path, token, body) => worker.fetch(new Request('https://api.moe4all.com/v1' + path, {
    method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: JSON.stringify(body)
  }), env, { waitUntil: promise => deferred.push(promise) });
  for (const kind of ['benchmark', 'error']) {
    const created = await call('/upload-sessions', null, { kind, report_id: 'worker-' + kind, file_sha256: 'a'.repeat(64), size_bytes: 512 });
    assert.equal(created.status, 201);
    const session = await created.json(), path = '/upload-sessions/' + session.session_id + '/authorize';
    const browser = new URLSearchParams(new URL(session.verification_url).hash.slice(1)).get('authorize');
    const body = { consent: kind === 'benchmark' ? 'public_benchmark' : 'public_error', turnstile_token: 'fixture-response' };
    for (const [value, httpStatus] of [
      [{ success: false }, 200],
      [{ success: true, hostname: 'other.example', action: 'submission' }, 200],
      [{ success: true, hostname: 'moe4all.com', action: 'other' }, 200],
      [{ success: true, hostname: 'moe4all.com', action: 'submission' }, 302],
      [{ success: true, hostname: 'moe4all.com', action: 'submission' }, 503]
    ]) {
      answer = value; status = httpStatus;
      const response = await call(path, browser, body);
      assert.equal(response.status, 403);
      assert.equal((await response.json()).error.code, 'verification_required');
    }
    answer = { success: true, hostname: 'moe4all.com', action: 'submission' }; status = 200;
    assert.equal((await call(path, browser, body)).status, 200);
    const before = calls;
    assert.equal((await call(path, browser, body)).status, 200);
    assert.equal(calls, before, 'retries must not spend another one-use token');
    assert.equal((await call(path, session.session_token, body)).status, 401);
    assert.equal((await call(path, browser, { ...body, consent: 'private_error' })).status, 403);
  }
  assert.equal(calls, 12);
  await Promise.all(deferred);
});

test('GitHub archive refuses redirects without forwarding its bearer credential', async () => {
  let calls = 0;
  const archive = new GitHubArchive({ token: 'fixture', repository: 'owner/repo', fetcher: workersFetch((url, init) => {
    calls++;
    assert.equal(url, 'https://api.github.com/repos/owner/repo/git/ref/heads/main');
    assert.equal(init.headers.Authorization, 'Bearer fixture');
    return new Response(null, { status: 302, headers: { location: 'https://untrusted.example' } });
  }) });
  await assert.rejects(archive.api('git/ref/heads/main'), error => error.statusCode === 302);
  assert.equal(calls, 1);
});

test('Access certificate fetch also uses Workers-compatible redirect handling', async t => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  let calls = 0;
  globalThis.fetch = workersFetch(() => { calls++; return new Response(null, { status: 302 }); });
  const env = { ACCESS_ISSUER: 'https://fixture.cloudflareaccess.com', ACCESS_AUD: 'fixture-aud', ADMIN_EMAIL: 'fixture@example.com' };
  const encode = value => btoa(JSON.stringify(value)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
  const jwt = encode({ alg: 'RS256', kid: 'fixture' }) + '.' + encode({ iss: env.ACCESS_ISSUER, aud: env.ACCESS_AUD, email: env.ADMIN_EMAIL, exp: Math.ceil(Date.now() / 1000) + 100 }) + '.fixture';
  assert.equal(await verifyAccess(new Request('https://api.moe4all.com', { headers: { 'cf-access-jwt-assertion': jwt } }), env), null);
  assert.equal(calls, 1);
});
