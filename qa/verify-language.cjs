const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const origin = 'http://moe4all.test';

async function check(page, language, technical) {
  const lang = language === 'zh' ? 'zh-CN' : 'en';
  await page.locator(`html[lang="${lang}"]`).waitFor();
  assert.equal(await page.locator('#language-toggle span').innerText(), language === 'zh' ? 'EN' : '\u4e2d');
  assert.equal(await page.title(), technical
    ? (language === 'zh' ? 'MoE4All \u00b7 \u91ca\u653e\u5361\u4e4b\u6f5c\u529b' : 'MoE4All \u00b7 Unlock your hardware')
    : (language === 'zh' ? 'MoE4All \u00b7 \u8bb0\u5f97\u6628\u5929\uff0c\u5b89\u6392\u660e\u5929' : 'MoE4All \u00b7 Remember yesterday. Plan tomorrow.'));
  const text = await page.locator(technical ? '[data-benchmark-label="heading"]' : '#scenario-description').innerText();
  assert.equal(/[\u3400-\u9fff]/.test(text), language === 'zh');
  const download = await page.locator(technical ? '.text-link[data-release-link="agent"]' : '[data-agent-download]').first().innerText();
  assert.equal(/[\u3400-\u9fff]/.test(download), language === 'zh');
  const view = page.locator('[data-view="models"]');
  await view.click();
  await page.frameLocator('[data-slide="models"] iframe').locator(`html[lang="${lang}"]`).waitFor();
  if (!technical) await page.frameLocator('#hero-screen').locator(`html[lang="${lang}"]`).waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), page.viewportSize().width);
}

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe' });
  const reports = [];
  try {
    for (const scenario of [
      { locale: 'zh-CN', expected: 'zh' },
      { locale: 'zh-TW', expected: 'zh' },
      { locale: 'en-US', expected: 'en' },
      { locale: 'de-DE', expected: 'en' },
      { locale: 'en-US', saved: 'zh', expected: 'zh' },
      { locale: 'zh-CN', saved: 'en', expected: 'en' },
      { locale: 'en-US', saved: 'invalid', expected: 'en' },
      { locale: 'en-US', blocked: true, expected: 'en' }
    ]) {
      const context = await browser.newContext({
        locale: scenario.locale, reducedMotion: 'reduce', viewport: { width: 1440, height: 960 },
        storageState: { cookies: [], origins: scenario.saved ? [{ origin, localStorage: [{ name: 'moe4all-language', value: scenario.saved }] }] : [] }
      });
      if (scenario.blocked) await context.addInitScript(() => {
        Storage.prototype.getItem = Storage.prototype.setItem = () => { throw new Error('Storage denied'); };
      });
      await context.route('**/*', route => {
        const url = new URL(route.request().url());
        if (url.hostname === 'api.github.com') return route.fulfill({ status: 403, json: {} });
        assert.equal(url.origin, origin);
        const file = path.resolve(root, '.' + (url.pathname === '/' ? '/index.html' : url.pathname));
        assert.ok(file.startsWith(root + path.sep));
        const contentType = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' }[path.extname(file)] || 'application/octet-stream';
        return route.fulfill({ contentType, body: fs.readFileSync(file) });
      });
      const page = await context.newPage(), errors = [];
      page.on('pageerror', error => errors.push(error.message));
      for (const technical of [false, true]) {
        await page.goto(origin + (technical ? '/technical.html' : '/'));
        await check(page, scenario.expected, technical);
      }
      const switched = scenario.expected === 'zh' ? 'en' : 'zh';
      await page.locator('#language-toggle').click();
      await check(page, switched, true);
      await page.reload();
      await check(page, scenario.blocked ? scenario.expected : switched, true);
      await page.goto(origin + '/');
      await check(page, scenario.blocked ? scenario.expected : switched, false);
      await page.setViewportSize({ width: 320, height: 800 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 320);
      assert.deepEqual(errors, []);
      reports.push({ ...scenario, passed: true });
      await context.close();
    }
    console.log(JSON.stringify({ status: 'passed', reports }));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
