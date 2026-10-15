const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const root = path.resolve(__dirname, '..');
const evidence = process.env.MOE4ALL_EVIDENCE_DIR;
assert.ok(evidence && process.env.MOE4ALL_QA_TMP, 'Set evidence and temporary directories under the shared work root');
const live = process.argv.includes('--live');
const prefix = '/moe4all-website/';
const origin = 'https://headmaster218.github.io';
const beacon = 'https://static.cloudflareinsights.com/beacon.min.js';
const token = '018ded73fd29484c99e6b72140098d8e';
const results = [];
const manifest = {
  task: path.basename(evidence), purpose: 'Website analytics integration verification',
  mode: live ? 'live' : 'offline', started: new Date().toISOString(), status: 'running', repository: root,
  commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  dirty: execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim(),
  sources: Object.fromEntries(['analytics.js', 'index.html', 'technical.html'].map(file => [file, createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex')])),
  paths: { evidence, temporary: process.env.MOE4ALL_QA_TMP }, results
};
fs.mkdirSync(evidence, { recursive: true });
const save = () => fs.writeFileSync(path.join(evidence, live ? 'manifest-live.json' : 'manifest.json'), JSON.stringify(manifest, null, 2));
save();

(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    proxy: live && process.env.MOE4ALL_QA_PROXY ? { server: process.env.MOE4ALL_QA_PROXY } : undefined
  });
  try {
    for (const blocked of live ? [false] : [false, true]) {
      const context = await browser.newContext({ locale: 'zh-CN', reducedMotion: 'reduce', viewport: { width: 1440, height: 960 } });
      if (!live) await context.route('**/*', route => {
        const url = new URL(route.request().url());
        if (url.href === beacon) return blocked ? route.abort() : route.fulfill({ contentType: 'application/javascript', headers: { 'Access-Control-Allow-Origin': '*' }, body: 'window.__analyticsLoaded = true;' });
        if (url.hostname === 'api.github.com') return route.fulfill({ status: 403, json: {} });
        assert.equal(url.origin, origin);
        const relative = url.pathname.slice(prefix.length) || 'index.html';
        assert.ok(url.pathname.startsWith(prefix));
        const file = path.resolve(root, relative);
        assert.ok(file.startsWith(root + path.sep));
        const contentType = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' }[path.extname(file)] || 'application/octet-stream';
        return route.fulfill({ contentType, body: fs.readFileSync(file) });
      });
      const page = await context.newPage();
      const errors = [], requests = [], responses = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('request', request => {
        if (request.url() === beacon) requests.push({ url: request.url(), mainFrame: request.frame() === page.mainFrame() });
      });
      page.on('response', response => {
        if (response.url().includes('cloudflareinsights.com/')) responses.push({ url: response.url(), status: response.status(), method: response.request().method() });
      });
      for (const file of ['index.html', 'technical.html']) {
        requests.length = 0; responses.length = 0;
        await page.goto(origin + prefix + file, { waitUntil: 'load' });
        await page.waitForFunction(() => window.MoeSite?.getPreferredLanguage);
        assert.equal(await page.locator('script[data-cf-beacon]').count(), 1);
        assert.equal(JSON.parse(await page.locator('script[data-cf-beacon]').getAttribute('data-cf-beacon')).token, token);
        assert.deepEqual(requests.map(request => request.mainFrame), [true], 'Only the main document loads analytics');
        for (const language of ['zh', 'en']) {
          assert.equal(await page.locator('html').getAttribute('lang'), language === 'zh' ? 'zh-CN' : 'en');
          assert.equal(/[\u3400-\u9fff]/.test(await page.locator('[data-analytics-notice]').innerText()), language === 'zh');
          for (const width of [1440, 320]) {
            await page.setViewportSize({ width, height: 960 });
            await page.locator('footer').scrollIntoViewIfNeeded();
            assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width);
            if (!blocked) await page.locator('footer').screenshot({ path: path.join(evidence, `${live ? 'live' : 'offline'}-${file}-${language}-${width}.png`) });
          }
          await page.locator('#language-toggle').click();
        }
        if (live) {
          const report = page.waitForResponse(response => response.url().includes('cloudflareinsights.com/cdn-cgi/rum') && response.request().method() === 'POST', { timeout: 20000 });
          const other = await context.newPage();
          await other.bringToFront();
          const response = await report;
          assert.ok(response.ok(), 'Cloudflare accepts the analytics report');
          await other.close();
          await page.bringToFront();
        }
        assert.deepEqual(errors, []);
        results.push({ file, blocked, mainFrameOnly: true, responses: [...responses], passed: true });
        save();
      }
      await context.close();
    }
    manifest.status = 'passed';
    console.log(JSON.stringify({ status: 'passed', mode: manifest.mode, results, evidence }));
  } catch (error) {
    manifest.status = 'failed'; manifest.error = error.message; throw error;
  } finally {
    await browser.close(); manifest.finished = new Date().toISOString(); save();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
