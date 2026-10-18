const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const assert = require('node:assert/strict');

(async () => {
  const root = path.resolve(__dirname, '..');
  assert.ok(process.env.MOE4ALL_EVIDENCE_DIR, 'Set MOE4ALL_EVIDENCE_DIR under the shared work root');
  const shots = path.join(process.env.MOE4ALL_EVIDENCE_DIR, 'website-screenshots');
  fs.mkdirSync(shots, { recursive: true });
  const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.BROWSER_PATH || (fs.existsSync(edge) ? edge : undefined),
  });
  const errors = [];
  const page = await browser.newPage({ reducedMotion: 'reduce', deviceScaleFactor: 1, locale: 'zh-CN' });
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  const reports = [];
  const url = pathToFileURL(path.join(root, 'technical.html')).href;
  const benchmarks = JSON.parse(fs.readFileSync(path.join(root, 'content/benchmarks.json'), 'utf8'));
  const shortContext = benchmarks.contexts[0];

  try {
    for (const viewport of [{ width: 1440, height: 960 }, { width: 1920, height: 1080 }, { width: 3840, height: 2160 }, { width: 768, height: 1024 }, { width: 390, height: 844 }, { width: 320, height: 700 }]) {
      await page.setViewportSize(viewport);
      await page.goto(url);
      await page.waitForFunction(() => window.lucide && document.querySelectorAll('.expert-cell').length === 48);
      assert.equal(await page.locator('[data-model][aria-pressed="true"]').getAttribute('data-model'), 'qwen35');
      assert.equal(await page.locator('[data-context][aria-pressed="true"]').getAttribute('data-context'), String(shortContext));
      assert.deepEqual(await page.locator('[data-model]').evaluateAll(buttons => buttons.map(button => button.dataset.model)), ['qwen35', 'flashnext']);
      await page.evaluate(async () => {
        await Promise.all([...document.querySelectorAll('img[src]')].map(img => {
          img.loading = 'eager';
          return img.decode();
        }));
      });
      const metrics = await page.evaluate(() => {
        const width = document.documentElement.clientWidth;
        const overflow = [...document.querySelectorAll('body *')].filter(element => {
          if (element.closest('dialog') || element.matches('.skip-link') || getComputedStyle(element).display === 'none') return false;
          const r = element.getBoundingClientRect();
          return r.width > 0 && (r.right > width + 1 || r.left < -1);
        }).map(element => `${element.tagName}.${element.className}`);
        return { width, bodyWidth: document.documentElement.scrollWidth, overflow, icons: document.querySelectorAll('svg.lucide').length, missingImages: [...document.querySelectorAll('img[src]')].filter(img => !img.naturalWidth).map(img => img.src) };
      });
      assert.equal(metrics.bodyWidth, viewport.width, `Horizontal overflow at ${viewport.width}: ${metrics.overflow.join(', ')}`);
      assert.equal(metrics.missingImages.length, 0, 'Missing image');
      assert.ok(metrics.icons > 40, 'Icons did not initialize');
      const readingSize = await page.locator('.section-description').first().evaluate(element => Number.parseFloat(getComputedStyle(element).fontSize));
      assert.ok(readingSize >= (viewport.width >= 1600 ? 21 : viewport.width > 650 ? 19 : 17), 'Body copy is too small');
      await page.screenshot({ path: path.join(shots, `${viewport.width}-zh-first.png`) });
      if (viewport.width === 1440 || viewport.width === 390) {
        await page.screenshot({ path: path.join(shots, `${viewport.width}-zh-full.png`), fullPage: true });
      }
      for (const model of benchmarks.models) {
        await page.locator(`[data-model="${model.id}"]`).click();
        for (const context of benchmarks.contexts) {
          if (!model.results[context]) continue;
          await page.locator(`[data-context="${context}"]`).click();
          const values = await page.locator('[data-decode-speed]').allTextContents();
          assert.deepEqual(values.map(value => Number.parseFloat(value)), model.results[context].decode);
          assert.equal(await page.locator('#prefill-speed').innerText(), Number.isFinite(model.results[context].prefill) ? model.results[context].prefill.toFixed(2) : '—');
          const maximum = Math.max(...benchmarks.models.flatMap(item => Object.entries(item.results)
            .filter(([depth]) => (depth === String(shortContext)) === (context === shortContext)).flatMap(([, result]) => result.decode)));
          const widths = await page.locator('[data-decode-bar]').evaluateAll(bars => bars.map(bar => parseFloat(bar.style.width)));
          widths.forEach((width, index) => assert.ok(Math.abs(width - model.results[context].decode[index] / maximum * 100) < .001, 'Short and long-context chart scales must be independent'));
        }
      }
      await page.locator('#benchmark-details').click();
      assert.equal(await page.locator('#benchmark-table tr').count(), benchmarks.models.reduce((count, model) => count + Object.keys(model.results).length, 0));
      if (viewport.width === 390) await page.screenshot({ path: path.join(shots, '390-benchmark-details.png') });
      await page.keyboard.press('Escape');
      await page.locator('[data-model="qwen35"]').click();
      await page.locator(`[data-context="${shortContext}"]`).click();
      await page.locator('.benchmark').screenshot({ path: path.join(shots, `benchmark-${viewport.width}-zh.png`) });
      await page.locator('[data-model="flashnext"]').click();
      assert.equal(await page.locator(`[data-context="${shortContext}"]`).isVisible(), false);
      await page.locator('[data-context="30000"]').click();
      assert.equal(await page.locator('#memory-toggle').getAttribute('aria-pressed'), 'true');
      assert.equal(await page.locator('.compute-slot').count(), 4);
      assert.equal(await page.locator('#memory-operation').innerText(), '4 VRAM HITS');
      assert.equal(await page.locator('[data-tier-activity="gpu"]').innerText(), '热 24 / 48');
      assert.equal(await page.locator('#generated-phrase').getAttribute('data-length'), '0');
      assert.equal(await page.locator('#expert-grid').evaluate(element => getComputedStyle(element).gridAutoFlow), 'column');

      const nextPeek = await page.locator('.agent-gallery-window').evaluate(element => {
        const bounds = element.getBoundingClientRect(), next = element.querySelectorAll('.agent-slide')[1].getBoundingClientRect();
        return Math.min(next.right, bounds.right) - Math.max(next.left, bounds.left);
      });
      assert.ok(nextPeek > 5, 'Next Agent slide should be visible before interaction');
      for (const view of ['workspace', 'models', 'memory', 'remote']) {
        await page.locator(`[data-view="${view}"]`).click();
        assert.equal(await page.locator('.agent-gallery').getAttribute('data-current-view'), view);
        const frame = page.frameLocator(`[data-slide="${view}"] iframe`);
        await frame.locator(`body[data-view="${view}"]`).waitFor();
        assert.ok((await frame.locator('.demo-main').innerText()).length > 150);
        assert.equal(await frame.locator('.demo-label').innerText(), '演示工作区');
        if (view === 'models') assert.equal(await frame.locator('.models-list>div').count(), 3);
        if (view === 'memory') assert.equal(await frame.locator('.memory-list article').count(), 4);
      }
      await page.locator('#agent-next').click();
      assert.equal(await page.locator('.agent-gallery').getAttribute('data-current-view'), 'workspace');
      await page.locator('#agent-prev').click();
      assert.equal(await page.locator('.agent-gallery').getAttribute('data-current-view'), 'remote');
      await page.locator('#expand-gallery').click();
      assert.equal(await page.locator('#image-dialog').isVisible(), true);
      await page.frameLocator('#expanded-agent').locator('body[data-view="remote"]').waitFor();
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('#image-dialog').isVisible(), false);
      await page.locator('[data-view="remote"]').press('Home');
      assert.equal(await page.locator('.agent-gallery').getAttribute('data-current-view'), 'workspace');
      assert.equal(await page.locator('#agent-play').getAttribute('aria-pressed'), 'true');
      await page.locator('.agent-gallery').screenshot({ path: path.join(shots, `agent-${viewport.width}-zh.png`) });

      await page.locator('[data-filter="work"]').click();
      assert.equal(await page.locator('.plugin:visible').count(), 2);
      await page.locator('[data-filter="connect"]').click();
      assert.equal(await page.locator('.plugin:visible').count(), 3);
      await page.locator('[data-filter="all"]').click();
      assert.equal(await page.locator('.plugin:visible').count(), 8);

      await page.locator('.hero [data-download]').click();
      assert.equal(await page.locator('#download-dialog').isVisible(), true);
      const expectedDownloads = await page.evaluate(() => 3 + Number(Boolean(window.MOE4ALL_DATA.releases.enginePreview)));
      assert.equal(await page.locator('#download-dialog .site-product').count(), expectedDownloads);
      if (viewport.width === 390) await page.screenshot({ path: path.join(shots, '390-download.png') });
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('#download-dialog').isVisible(), false);

      if (viewport.width < 900) {
        await page.locator('#menu-toggle').click();
        assert.equal(await page.locator('#main-nav').isVisible(), true);
        await page.locator('#main-nav a[href="#ecosystem"]').click();
        assert.equal(await page.locator('#menu-toggle').getAttribute('aria-expanded'), 'false');
      }
      await page.locator('#language-toggle').click();
      assert.equal(await page.locator('html').getAttribute('lang'), 'en');
      await page.locator('[data-model="qwen35"]').click();
      await page.locator(`[data-context="${shortContext}"]`).click();
      await page.locator('.benchmark').screenshot({ path: path.join(shots, `benchmark-${viewport.width}-en.png`) });
      const englishWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      assert.equal(englishWidth, viewport.width, `English horizontal overflow at ${viewport.width}`);
      const newest = await page.evaluate(() => window.MOE4ALL_DATA.releases.enginePreview || window.MOE4ALL_DATA.releases.engine);
      assert.ok((await page.locator('[data-release-announcement]').innerText()).includes(newest.version));
      assert.match(await page.locator('#memory-status').innerText(), /Check four experts/);
      assert.equal(await page.locator('[data-tier-activity="gpu"]').innerText(), 'Hot 24 / 48');
      for (const view of ['workspace', 'models', 'memory', 'remote']) {
        await page.locator(`[data-view="${view}"]`).click();
        const frame = page.frameLocator(`[data-slide="${view}"] iframe`);
        await frame.locator('html[lang="en"]').waitFor();
        assert.equal(await frame.locator('.demo-label').innerText(), 'Demo workspace');
      }
      assert.equal(await page.locator('#agent-next').getAttribute('aria-label'), 'Next slide');
      if (viewport.width === 1440 || viewport.width === 390) await page.locator('.agent-gallery').screenshot({ path: path.join(shots, `agent-${viewport.width}-en.png`) });
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({ path: path.join(shots, `${viewport.width}-en-first.png`) });
      if (viewport.width === 390) await page.screenshot({ path: path.join(shots, '390-en-full.png'), fullPage: true });
      await page.locator('#language-toggle').click();
      assert.equal(await page.locator('html').getAttribute('lang'), 'zh-CN');
      reports.push({ viewport, metrics, interactions: 'passed', englishWidth });
    }
    assert.equal(errors.length, 0, `Browser errors: ${errors.join('\n')}`);
    fs.writeFileSync(path.join(process.env.MOE4ALL_EVIDENCE_DIR, 'website-results.json'), JSON.stringify({ status: 'passed', reports, errors }, null, 2));
    console.log(JSON.stringify({ status: 'passed', viewports: reports.map(r => r.viewport.width), screenshots: shots, errors }, null, 2));
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
