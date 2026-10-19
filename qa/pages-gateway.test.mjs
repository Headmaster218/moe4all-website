import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const source = await fs.readFile(new URL('../backend/pages-gateway/_worker.js', import.meta.url), 'utf8');
const { default: gateway } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const url = 'https://api.moe4all.com';

test('gateway identifies its missing or configured service binding without claiming backend health', async () => {
  for (const [env, state] of [[{}, 'missing'], [{ SUBMISSIONS: { fetch() {} } }, 'configured']]) {
    const response = await gateway.fetch(new Request(url), env);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).service_binding, state);
    assert.equal(response.headers.get('cache-control'), 'no-store');
  }
});

test('missing gateway binding fails closed rather than serving a static success page', async () => {
  const response = await gateway.fetch(new Request(url + '/v1/health'), {});
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error.code, 'gateway_unavailable');
});

test('gateway forwards API requests and upstream responses unchanged through an internal binding', async () => {
  for (const method of ['GET', 'POST', 'OPTIONS']) {
    const request = new Request(url + '/v1/upload-sessions/test/report', {
      method,
      headers: { Authorization: 'Bearer synthetic-test-only', Origin: 'https://moe4all.com', 'Content-Type': 'text/plain; charset=utf-8', 'CF-Connecting-IP': '192.0.2.1' },
      ...(method === 'POST' ? { body: 'MOE4ALL-SUBMISSION/1\r\n测试原件\r\n' } : {})
    });
    const expected = new Response(method === 'OPTIONS' ? null : '{"api_version":1}', { status: method === 'OPTIONS' ? 204 : 202, headers: { 'Access-Control-Allow-Origin': 'https://moe4all.com', 'Cache-Control': 'no-store' } });
    const response = await gateway.fetch(request, { SUBMISSIONS: { async fetch(forwarded) {
      assert.equal(forwarded, request);
      assert.equal(forwarded.headers.get('Authorization'), 'Bearer synthetic-test-only');
      assert.equal(forwarded.headers.get('CF-Connecting-IP'), '192.0.2.1');
      if (method === 'POST') assert.equal(await forwarded.text(), 'MOE4ALL-SUBMISSION/1\r\n测试原件\r\n');
      return expected;
    } } });
    assert.equal(response, expected);
  }
});

test('gateway cannot proxy arbitrary destinations or disclose internal errors', async () => {
  const env = { SUBMISSIONS: { fetch() { throw new Error('synthetic private detail'); } } };
  assert.equal((await gateway.fetch(new Request(url + '/proxy?url=https://elsewhere.invalid'), env)).status, 404);
  const response = await gateway.fetch(new Request(url + '/v1/health'), env);
  assert.equal(response.status, 503);
  assert.doesNotMatch(await response.text(), /synthetic private detail/);
  assert.doesNotMatch(source, /https:\/\/.*workers\.dev|console\.(log|error)/);
});
