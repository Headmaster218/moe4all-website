const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

(async () => {
  assert.ok(process.env.MOE4ALL_EVIDENCE_DIR, 'Set MOE4ALL_EVIDENCE_DIR under the shared work root');
  const browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', args: ['--no-proxy-server', '--disable-gpu'] });
  const reports = [], errors = [];
  try {
    for (const file of ['index.html', 'technical.html']) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, locale: 'zh-CN', reducedMotion: 'reduce' });
      await context.route('https://api.github.com/**', route => route.fulfill({ contentType: 'application/json', body: '[]' }));
      const page = await context.newPage(), requests = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('request', request => requests.push(request.url()));
      const url = process.env.MOE4ALL_BASE_URL ? new URL(file === 'index.html' ? './' : file, process.env.MOE4ALL_BASE_URL).href : pathToFileURL(path.join(__dirname, '..', file)).href;
      await page.goto(url);
      const home = file === 'index.html', gallery = home ? '.product-carousel' : '.agent-gallery';
      const modal = home ? '#expanded-product' : '#expanded-agent';
      await page.waitForFunction(() => window.MoeSite && document.querySelector('svg.lucide'));
      const hero = page.locator(home ? '.hero-scene' : '.hero-image');
      await hero.evaluate(image => image.decode());
      assert.deepEqual(await hero.evaluate(image => [image.naturalWidth, image.naturalHeight]), home ? [1860, 846] : [1536, 1024]);
      assert.ok((await hero.getAttribute('src')).endsWith('.webp'));
      assert.equal(await page.locator(modal).getAttribute('src'), null, 'Closed modal must not load');
      assert.equal(await page.locator(`${gallery} iframe[src]`).count(), 0, 'Far-offscreen gallery must not load');
      assert.equal(requests.filter(url => url.includes('demo.html')).length, home ? 1 : 0);
      await page.locator('#language-toggle').click();
      await page.locator(gallery).scrollIntoViewIfNeeded();
      await page.frameLocator('[data-slide="workspace"] iframe').locator('body[data-view="workspace"]').waitFor();
      await page.frameLocator('[data-slide="models"] iframe').locator('body[data-view="models"]').waitFor();
      await page.frameLocator('[data-slide="models"] iframe').locator('html[lang="en"]').waitFor();
      for (const view of ['memory', 'remote', 'models', 'workspace']) {
        await page.locator(`${gallery} [data-view="${view}"]`).click();
        await page.frameLocator(`[data-slide="${view}"] iframe`).locator(`body[data-view="${view}"]`).waitFor();
      }
      await page.locator(`${gallery} [data-view="remote"]`).click();
      await page.locator(home ? '#expand-product' : '#expand-gallery').click();
      await page.frameLocator(modal).locator('body[data-view="remote"]').waitFor();
      await page.frameLocator(modal).locator('html[lang="en"]').waitFor();
      await page.locator(home ? '#close-product' : '#image-dialog [data-close-dialog]').click();
      assert.ok(!requests.some(url => /(?:everyday-desk-blank|hardware-hero)\.png(?:$|\?)/.test(url)));
      reports.push({ file, originalDimensions: true, deferredGallery: true, nextSlidePrepared: true, deferredModal: true, lateFrameLanguage: true, views: 4, noPngRequests: true });
      await context.close();
    }
    assert.deepEqual(errors, []);
    const result = { status: 'passed', reports, errors };
    fs.writeFileSync(path.join(process.env.MOE4ALL_EVIDENCE_DIR, process.env.MOE4ALL_BASE_URL ? 'media-live-results.json' : 'media-results.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result, null, 2));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
