import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import { startLocalServer } from '../backend/local-server.mjs';
import { packFixture } from '../backend/fixtures.mjs';
import { decodeSubmission } from '../community/submission-codec.mjs';
import { buildFromGit } from '../scripts/build-leaderboard.mjs';
import { indexRows, decodeIndex } from '../community/leaderboard-model.mjs';
const exec = promisify(execFile), require = createRequire(import.meta.url);
const { chromium } = require(process.env.MOE4ALL_BROWSER_MODULES ? path.join(process.env.MOE4ALL_BROWSER_MODULES, 'playwright') : 'playwright');
const work = process.env.MOE4ALL_WORK_ROOT, engine = process.env.MOE4ALL_ENGINE_ROOT, binary = process.env.MOE4ALL_INFR_BIN;
for (const value of [work, engine, binary]) if (!value || !path.isAbsolute(value)) throw new Error('Set absolute MOE4ALL_WORK_ROOT, MOE4ALL_ENGINE_ROOT and MOE4ALL_INFR_BIN');
const task = process.env.MOE4ALL_TEST_ID;
if (!/^[A-Za-z0-9-]+$/.test(task || '')) throw new Error('Set an explicit MOE4ALL_TEST_ID');
const runtime = path.join(work, 'runtime', 'agent', task + '-integration-' + Date.now());
const output = path.join(work, 'results', 'agent', task), evidence = path.join(work, 'evidence', 'agent', task);
await fs.mkdir(runtime, { recursive: true }); await fs.mkdir(output, { recursive: true }); await fs.mkdir(evidence, { recursive: true });
const run = (exe, args, options = {}) => exec(exe, args, { windowsHide: true, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024, ...options });
const vectors = JSON.parse(await fs.readFile(new URL('./fixtures/submission-vectors.json', import.meta.url), 'utf8'));
const benchInput = path.join(runtime, 'benchmark.json'); await fs.writeFile(benchInput, JSON.stringify(vectors.benchmark));
const packed = await run(binary, ['submission', 'pack-benchmark', '--input', benchInput, '--result-dir', path.join(runtime, 'benchmark-database')]);
const benchmarkFile = packed.stdout.match(/^MOE4ALL_SUBMISSION_PATH=(.+)$/m)?.[1].trim(); assert.ok(benchmarkFile);
const errorDir = path.join(runtime, 'error-database', 'v1', '2026-10'); await fs.mkdir(errorDir, { recursive: true });
const errorFile = path.join(errorDir, vectors.error.id + '.m4e'); await fs.writeFile(errorFile, await packFixture('error', vectors.error));
const description = path.join(runtime, 'description.txt'); await fs.writeFile(description, 'Synthetic integration description: ' + '中'.repeat(240));
await run(binary, ['report', '--source', errorFile, '--description-file', description]);
for (const file of [benchmarkFile, errorFile]) { await run(binary, ['submission', 'verify', file]); await decodeSubmission(await fs.readFile(file)); }
const server = await startLocalServer({ directory: path.join(runtime, 'web'), port: 0 });
let browser;
const checks = [], pageErrors = [], external = [];
try {
  const clientDir = path.join(runtime, 'cmd');
  const psEnv = { ...process.env }; delete psEnv.PSModulePath;
  const ps = await run('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', path.join(engine, 'scripts/Test-SubmissionUpload.ps1'), '-Infr', binary, '-Directory', clientDir, '-BenchmarkFile', benchmarkFile, '-ErrorFile', errorFile, '-ApiBase', server.origin + '/v1'], { env: psEnv });
  await fs.writeFile(path.join(evidence, 'native-upload.log'), ps.stdout + ps.stderr);
  checks.push('Actual Rust producer/verifier, both Windows Git routes with gh fixture, real loopback HTTP upload and CRLF duplicate retries');
  const privateDir = path.join(clientDir, 'config', 'private'), urls = JSON.parse(await fs.readFile(path.join(privateDir, 'handoff-urls.json'), 'utf8'));
  browser = await chromium.launchPersistentContext(path.join(work, 'tmp', 'agent', task, 'integration-browser'), { executablePath: process.env.MOE4ALL_BROWSER_EXE, headless: true, downloadsPath: path.join(work, 'tmp', 'agent', task, 'integration-downloads'), viewport: { width: 1440, height: 1000 }, args: ['--disable-gpu', '--no-proxy-server', '--disk-cache-size=1048576', '--media-cache-size=1048576'] });
  const page = await browser.newPage(); page.on('pageerror', error => pageErrors.push(error.message));
  await page.route('**/*', route => {
    const url = route.request().url();
    if (!url.startsWith(server.origin + '/') && !url.startsWith('blob:') && !url.startsWith('data:')) { external.push({ origin: new URL(url).origin, method: route.request().method() }); return route.abort(); }
    return route.continue();
  });
  for (const url of urls) {
    await page.goto(url); await page.waitForFunction(() => document.querySelectorAll('.receipt-row').length > 0);
    assert.equal(new URL(page.url()).hash, '#receipts');
  }
  assert.equal(await page.locator('.receipt-row').count(), 2);
  assert.equal((await server.app.store.one('SELECT count(*) AS n FROM reports WHERE publication_consent IS NOT NULL AND armor IS NOT NULL')).n, 0);
  checks.push('Browser credential handoff clears the URL, validates the server response, persists and deduplicates both private receipts; cloud-buffer simulation releases verified bodies');
  await page.screenshot({ path: path.join(output, 'receipts-desktop.png'), fullPage: true, animations: 'disabled' });
  await page.evaluate(() => localStorage.removeItem('moe4all-submission-receipts-v1'));
  await page.goto(server.origin + '/community/index.html#receipts');
  await page.reload();
  const backups = await fs.readdir(path.join(privateDir, 'submission-receipts'));
  await page.locator('#receipt-file').setInputFiles(path.join(privateDir, 'submission-receipts', backups[0]));
  await page.waitForFunction(() => document.querySelectorAll('.receipt-row').length === 1);
  const bad = { receipt_id: 'rc_fixture', receipt_token: 'invalid-token', api_base: 'https://evil.example/v1' };
  await page.locator('#receipt-file').setInputFiles({ name: 'wrong.private-receipt.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(bad)) });
  await page.getByText('回执属于其他上传服务，不能向当前服务发送凭证。').waitFor();
  assert.equal(await page.locator('.receipt-row').count(), 1);
  for (const width of [320, 390, 768, 1440, 3840]) { await page.setViewportSize({ width, height: 1000 }); assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)); }
  await page.setViewportSize({ width: 390, height: 1000 }); await page.screenshot({ path: path.join(output, 'receipts-mobile.png'), fullPage: true, animations: 'disabled' });
  checks.push('Private JSON receipt recovery, wrong-origin credential rejection, responsive 320/390/768/1440/3840 receipt layouts');
  for (const [kind, original] of [['benchmark', benchmarkFile], ['error', errorFile]]) {
    const file = path.join(clientDir, kind + '-database', 'v1', '2026-10', path.basename(original));
    await page.goto(server.origin + '/community/upload.html?kind=' + kind);
    await page.locator('#file').setInputFiles(file);
    await page.getByText('文件校验完成').waitFor();
    await page.locator('#consent').check(); await page.locator('#upload-button').click();
    await page.locator('.receipt-big h2').getByText('这份报告已经收到。').waitFor();
    const downloaded = page.waitForEvent('download'); await page.locator('[data-action="download-receipt"]').click();
    const download = await downloaded, backup = path.join(runtime, kind + '.browser-receipt.json'); await download.saveAs(backup);
    const receipt = JSON.parse(await fs.readFile(backup, 'utf8')); assert.equal(receipt.kind, kind); assert.ok(receipt.receipt_token);
  }
  assert.equal((await server.app.store.one('SELECT count(*) AS n FROM reports WHERE publication_consent IS NOT NULL')).n, 2);
  checks.push('Both browser file-upload routes validate real CLI reports, require consent, deduplicate CMD submissions and download recoverable private receipts');
  const decoded = await decodeSubmission(await fs.readFile(benchmarkFile));
  const sessionResponse = await fetch(server.origin + '/v1/upload-sessions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: 'benchmark', report_id: decoded.id, file_sha256: decoded.fileSha256, size_bytes: decoded.sizeBytes, summary: decoded.summary.slice(0, 8) }) });
  assert.equal(sessionResponse.status, 201); const session = await sessionResponse.json();
  await page.goto(session.verification_url); await page.locator('#confirmation-consent').waitFor(); assert.equal(new URL(page.url()).hash, '');
  await page.locator('#confirmation-consent').check(); await page.locator('#confirmation-button').click();
  await page.getByText('已授权，请回到 CMD 继续上传。').waitFor();
  const authorized = await (await fetch(server.origin + '/v1/upload-sessions/' + session.session_id, { headers: { Authorization: 'Bearer ' + session.session_token } })).json();
  assert.equal(authorized.state, 'ready');
  checks.push('Actual browser CMD confirmation clears authorization fragments and grants only the bound upload session, without claiming the file has uploaded');
  const archive = path.join(runtime, 'reviewed-git-fixture'); await fs.mkdir(archive);
  const gitEnv = { ...process.env, GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null', GIT_CONFIG_SYSTEM: process.platform === 'win32' ? 'NUL' : '/dev/null', GIT_TERMINAL_PROMPT: '0' };
  const git = args => run('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', ...args], { cwd: archive, env: gitEnv });
  await git(['init', '--initial-branch=main']);
  for (const [kind, file] of [['benchmark', benchmarkFile], ['error', errorFile]]) { const target = path.join(archive, kind + '-database', 'v1', '2026-10', path.basename(file)); await fs.mkdir(path.dirname(target), { recursive: true }); await fs.copyFile(path.join(clientDir, kind + '-database', 'v1', '2026-10', path.basename(file)), target); }
  await git(['add', '.']); await git(['commit', '-m', 'fixture: reviewed reports']);
  const artifacts = await buildFromGit({ directory: archive, python: process.env.MOE4ALL_PYTHON, decoder: path.join(engine, 'scripts/moe4all_submission.py'), output: path.join(runtime, 'compact-index') });
  const index = decodeIndex(JSON.parse(artifacts.json)); assert.equal(index.reports.length, 1); assert.equal(indexRows(index).length, 1);
  const ranked = indexRows(index)[0]; assert.equal(ranked.pcie_generation, 4); assert.equal(ranked.pcie_width, 8); assert.equal(ranked.storage_bus, 'NVMe');
  checks.push('Immutable Git fixture with both report kinds generates one ranked benchmark through the independent Python decoder; errors remain archived but unranked');
  assert.deepEqual(pageErrors, []); assert.ok(external.every(request => request.origin === 'https://api.github.com' && request.method === 'GET'));
  await fs.writeFile(path.join(output, 'integration-results.json'), JSON.stringify({ passed: true, checks, runtime, pageErrors, blockedExternalRequests: external, cloudWrites: false, gpuInference: false, github: 'fixture', actualHttp: 'loopback' }, null, 2));
  console.log(JSON.stringify({ passed: true, checks: checks.length, cloudWrites: false, gpuInference: false }));
} finally { if (browser) await browser.close(); await server.close(); }
