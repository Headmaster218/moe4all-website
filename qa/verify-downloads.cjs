const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const bundled = JSON.parse(fs.readFileSync(path.join(root, 'content/releases.json'), 'utf8'));
const agentRepo = 'Headmaster218/MoE4All-Agent';
const engineRepo = 'Headmaster218/MoE4All';
const release = (repository, tag, packages = []) => ({ tag_name: tag, prerelease: false, published_at: '2026-10-15T03:00:00Z', html_url: `https://github.com/${repository}/releases/tag/${tag}`, assets: packages.map(name => ({ name, size: 1024, state: 'uploaded', browser_download_url: `https://github.com/${repository}/releases/download/${tag}/${name}` })) });
const engine = release(engineRepo, 'release-1.2.3', ['MoE4All-Windows-x86_64-v1.2.3.zip']);
const agent = release(agentRepo, 'agent-v1.2.3', ['MoE4All-Agent-Windows-x86_64-v1.2.3.zip', 'MoE4All-Agent-Linux-x86_64-v1.2.3.tar.gz']);

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe' });
  const reports = [];
  try {
    for (const scenario of [
      { name: 'windows', ua: 'Windows NT 10.0; Win64; x64', expected: '.zip' },
      { name: 'linux', ua: 'X11; Linux x86_64', expected: '.tar.gz' },
      { name: 'mobile', ua: 'Linux; Android 14', fallback: true },
      { name: 'no-package', ua: 'Windows NT 10.0; Win64; x64', noPackage: true, fallback: true },
      { name: 'api-unavailable', ua: 'Windows NT 10.0; Win64; x64', failApi: true, expected: '.zip' }
    ]) {
      const context = await browser.newContext({ userAgent: scenario.ua, reducedMotion: 'reduce', acceptDownloads: true });
      await context.addInitScript(() => {
        Object.defineProperty(navigator, 'platform', { get: () => '' });
        Object.defineProperty(navigator, 'userAgentData', { get: () => undefined });
      });
      let apiRequests = 0;
      await context.route('**/*', async route => {
        const url = new URL(route.request().url());
        if (url.hostname === 'api.github.com') {
          apiRequests++;
          if (scenario.failApi) return route.fulfill({ status: 403, json: { message: 'Rate limited' } });
          return route.fulfill({ json: url.pathname.includes('MoE4All-Agent') ? [{ ...agent, assets: scenario.noPackage ? [] : agent.assets }] : [engine] });
        }
        if (url.hostname === 'github.com') return route.fulfill(url.pathname.includes('/download/') ? { contentType: 'application/octet-stream', headers: { 'Content-Disposition': 'attachment; filename="package-test.bin"' }, body: 'download fixture' } : { contentType: 'text/html', body: '<title>Release fallback</title>Release fallback' });
        assert.equal(url.hostname, 'moe4all.test');
        const file = path.resolve(root, '.' + (url.pathname === '/' ? '/index.html' : url.pathname));
        assert.ok(file.startsWith(root + path.sep));
        const type = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml' }[path.extname(file)] || 'application/octet-stream';
        return route.fulfill({ contentType: type, body: fs.readFileSync(file) });
      });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto('http://moe4all.test/');
      await page.waitForFunction(() => window.MoeSite && document.querySelector('.hero-stage'));
      if (!scenario.failApi) await page.waitForFunction(() => document.querySelector('[data-agent-version]').textContent.includes('1.2.3'));
      else await page.waitForTimeout(200);
      assert.ok(!/AI.GENERATED|AI \u751f\u6210/.test(await page.locator('body').innerText()));
      const button = page.locator('[data-agent-download]').first();
      assert.equal(await button.getAttribute('data-download-state'), scenario.fallback ? 'fallback' : 'direct');
      await button.click();
      await page.locator('#download-dialog[open]').waitFor();
      if (scenario.name === 'mobile') await page.locator('[data-system="macos"]').click();
      const packageLink = page.locator('[data-package="agent"]');
      if (scenario.fallback) {
        assert.match(await packageLink.getAttribute('href'), /\/releases(?:\/tag\/agent-v1\.2\.3)?$/);
        await packageLink.click();
        await page.waitForURL('https://github.com/**');
        assert.equal(await page.title(), 'Release fallback');
      } else {
        assert.ok((await packageLink.getAttribute('href')).endsWith(scenario.expected));
        const download = page.waitForEvent('download');
        await packageLink.click();
        assert.equal((await download).suggestedFilename(), 'package-test.bin');
        await page.locator('#download-dialog [data-shared-close]').click();
        await page.locator('[data-view="models"]').click();
        await page.frameLocator('[data-slide="models"] iframe').locator('.engine-row small').filter({ hasText: scenario.failApi ? bundled.engine.version : '1.2.3' }).waitFor();
        if (!scenario.failApi) {
          await page.evaluate(() => window.MoeSite.refreshReleases());
          assert.equal(apiRequests, 2, 'Cached refresh must not consume additional API requests');
        }
      }
      assert.deepEqual(errors, []);
      reports.push({ scenario: scenario.name, passed: true, apiRequests });
      await context.close();
    }
    console.log(JSON.stringify({ status: 'passed', reports }));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
