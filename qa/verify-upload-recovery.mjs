import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { startLocalServer } from '../backend/local-server.mjs';
import { packFixture, benchmarkFixture, errorFixture } from '../backend/fixtures.mjs';
import { decodeSubmission } from '../community/submission-codec.mjs';

const work = process.env.MOE4ALL_WORK_ROOT, task = process.env.MOE4ALL_TEST_ID;
if (!path.isAbsolute(work || '') || !/^[A-Za-z0-9-]+$/.test(task || '')) throw new Error('Set explicit MOE4ALL_WORK_ROOT and MOE4ALL_TEST_ID');
const output = path.join(work, 'results', 'moe4all', task), temp = path.join(work, 'tmp', 'moe4all', task);
await fs.mkdir(output, { recursive: true }); await fs.mkdir(temp, { recursive: true });
const require = createRequire(import.meta.url);
const { chromium } = require(path.join(process.env.MOE4ALL_BROWSER_MODULES, 'playwright'));
const server = await startLocalServer({ directory: path.join(work, 'runtime', 'moe4all', task, 'web'), port: 0, seed: false });
const browser = await chromium.launchPersistentContext(path.join(temp, 'recovery-browser'), { executablePath: process.env.MOE4ALL_BROWSER_EXE, headless: true, downloadsPath: path.join(temp, 'downloads'), viewport: { width: 1440, height: 1000 }, args: ['--disable-gpu', '--no-proxy-server', '--disk-cache-size=1048576', '--media-cache-size=1048576'] });
const checks = [], errors = [], counts = { created: 0, authorized: 0, reports: 0, emptyAuthorization: 0 };
const faults = { confirmation: 0, authorizeRejected: 0, authorizeLost: 0, reportFailure: 0, reportLost: 0 };
let page;
try {
  await browser.addInitScript(() => {
    window.__captcha = { options: null, renders: 0 };
    window.turnstile = { render: (_, options) => { window.__captcha.options = options; return ++window.__captcha.renders; }, remove: () => { window.__captcha.options = null; } };
  });
  page = await browser.newPage(); page.on('pageerror', e => errors.push(e.message));
  await page.route('**/*', async route => {
    const req = route.request(), url = new URL(req.url());
    if (url.origin !== server.origin) return route.abort();
    if (url.pathname === '/community/config.js') return route.fulfill({ contentType: 'text/javascript', body: `window.MOE4ALL_COMMUNITY_CONFIG=${JSON.stringify({ mode: 'production', apiBase: server.origin + '/v1', reviewMode: 'github_pr', repository: 'Headmaster218/MoE4All' })}` });
    if (url.pathname.endsWith('/confirmation')) {
      if (faults.confirmation > 0) { faults.confirmation--; return route.abort(); }
      const response = await route.fetch(), value = await response.json();
      return route.fulfill({ response, json: { ...value, turnstile_site_key: 'test-only-site-key' } });
    }
    if (url.pathname === '/v1/upload-sessions' && req.method() === 'POST') counts.created++;
    if (url.pathname.endsWith('/authorize')) {
      counts.authorized++; if (!req.postDataJSON().turnstile_token) counts.emptyAuthorization++;
      if (faults.authorizeRejected > 0) { faults.authorizeRejected--; return route.fulfill({ status: 403, json: { error: { code: 'verification_required', message: '测试：验证码已失效，请重新验证。' } } }); }
      if (faults.authorizeLost > 0) { faults.authorizeLost--; await route.fetch(); return route.abort(); }
    }
    if (url.pathname.endsWith('/report')) {
      counts.reports++;
      if (faults.reportFailure > 0) { faults.reportFailure--; return route.fulfill({ status: 503, json: { error: { code: 'inbox_full', message: '测试：暂时无法接收报告，请稍后重试。' }, request_id: 'req_fixture' } }); }
      if (faults.reportLost > 0) { faults.reportLost--; await route.fetch(); return route.abort(); }
    }
    return route.continue();
  });
  const human = async () => {
    await page.waitForFunction(() => window.__captcha.options);
    await page.evaluate(() => window.__captcha.options.callback('one-use-test-token'));
  };
  const retry = () => page.locator('[data-action="retry-upload"]').click();
  const select = async file => { await page.locator('#file').setInputFiles(file); await page.getByText('文件校验完成').waitFor(); await page.locator('#consent').check(); };
  await page.goto(server.origin + '/community/upload.html');
  for (const [kind, payload] of [['benchmark', benchmarkFixture(701)], ['error', errorFixture(701)]]) {
    await page.evaluate(() => sessionStorage.clear());
    const armor = await packFixture(kind, payload), file = { name: payload.id + (kind === 'benchmark' ? '.m4b' : '.m4e'), mimeType: 'text/plain', buffer: Buffer.from(armor) };
    await page.goto(server.origin + '/community/upload.html?kind=' + kind); await select(file);
    const created = counts.created, auth = counts.authorized;
    faults.confirmation = 2;
    await page.locator('#upload-button').click(); await page.locator('.upload-failure').waitFor();
    assert.equal(counts.created, created + 1); assert.equal(counts.authorized, auth);
    await retry(); await human();
    await page.evaluate(() => window.__captcha.options['error-callback']('600010'));
    await page.locator('.upload-failure').waitFor(); assert.equal(await page.locator('#upload-button').isDisabled(), true);
    await retry(); await human();
    // Refresh requires reselecting the same local file, never storing its private body.
    const saved = await page.evaluate(() => sessionStorage.getItem('moe4all-upload-v1:upload'));
    assert.ok(saved && !saved.includes('-----BEGIN') && !saved.includes('one-use-test-token'));
    await page.reload(); await page.getByText('已恢复待上传会话。', { exact: false }).waitFor();
    await select(file); await human();
    assert.equal(counts.created, created + 1);
    faults.authorizeRejected = 1;
    await page.locator('#upload-button').click(); await page.locator('.upload-failure').waitFor();
    assert.match(await page.locator('.upload-failure').innerText(), /verification_required/);
    await retry(); await human();
    faults.reportFailure = 1;
    await page.locator('#upload-button').click(); await page.locator('.upload-failure').waitFor();
    await page.waitForTimeout(4500); assert.match(await page.locator('.upload-failure').innerText(), /req_fixture/);
    for (const width of [320, 390, 768, 1440]) { await page.setViewportSize({ width, height: 1000 }); assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)); }
    await page.screenshot({ path: path.join(output, kind + '-persistent-error.png'), fullPage: true });
    const authAfter = counts.authorized;
    faults.reportLost = 1; await retry(); await page.locator('.upload-failure').waitFor();
    await retry(); await page.locator('.receipt-big h2').waitFor();
    assert.equal(counts.authorized, authAfter); assert.equal(counts.created, created + 1);
    assert.equal(await page.evaluate(() => sessionStorage.getItem('moe4all-upload-v1:upload')), null);
    checks.push(kind + ': first confirmation failure, CAPTCHA error/server rejection/reset, refresh/reselect bound file, persistent responsive error, failed write and lost response recovery, one receipt');
  }
  const armor = await packFixture('benchmark', benchmarkFixture(702)), decoded = await decodeSubmission(new TextEncoder().encode(armor));
  async function begin() {
    const response = await fetch(server.origin + '/v1/upload-sessions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: decoded.kind, report_id: decoded.id, file_sha256: decoded.fileSha256, size_bytes: decoded.sizeBytes, summary: decoded.summary.slice(0, 8) }) });
    assert.equal(response.status, 201); return response.json();
  }
  const session = await begin(); await page.goto(session.verification_url); await page.locator('#confirmation-consent').waitFor(); assert.equal(new URL(page.url()).hash, '');
  await page.reload(); await page.locator('#confirmation-consent').waitFor(); await human(); await page.locator('#confirmation-consent').check();
  faults.authorizeLost = 1; const before = counts.authorized;
  await page.evaluate(() => { const button = document.querySelector('#confirmation-button'); button.click(); button.click(); });
  await page.locator('.upload-failure').waitFor(); await retry();
  await page.getByText('已授权，请回到 CMD 继续上传。').waitFor(); assert.equal(counts.authorized, before + 1);
  checks.push('CMD confirmation: URL credential removed, refresh recovery, double-click latch and lost authorization response recover through status without token reuse');
  const cancel = await begin(); await page.goto(cancel.verification_url); await page.locator('[data-action="cancel-upload"]').click(); await page.getByText('已取消这次上传。').waitFor();
  checks.push('CMD cancellation preserves the original and does not upload');
  const expired = await begin(); await server.app.store.run('UPDATE upload_sessions SET expires_at=? WHERE id=?', '2000-01-01T00:00:00Z', expired.session_id);
  await page.goto(expired.verification_url); await page.locator('.upload-failure').waitFor();
  await page.locator('[data-action="restart-upload"]').click(); await page.locator('#file').waitFor({ state: 'attached' });
  checks.push('Expired authorization remains a visible error, never a success');
  assert.equal(counts.emptyAuthorization, 0); assert.deepEqual(errors, []);
  assert.equal((await server.app.store.one('SELECT count(*) AS n FROM reports')).n, 2);
  await fs.writeFile(path.join(output, 'browser-recovery.json'), JSON.stringify({ passed: true, checks, counts, pageErrors: errors, captcha: 'controlled official-API fixture, not a live CAPTCHA', backend: 'real loopback HTTP and SQLite', cloudWrites: false, inference: false }, null, 2));
  console.log(JSON.stringify({ passed: true, checks: checks.length, counts }));
} finally { await browser.close(); await server.close(); }
