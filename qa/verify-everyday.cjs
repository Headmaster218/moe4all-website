const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const sharp = require(process.env.SHARP_MODULE || (process.env.PLAYWRIGHT_MODULE ? path.join(path.dirname(process.env.PLAYWRIGHT_MODULE), 'sharp') : 'sharp'));
(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe' });
  const errors = [], reports = [], externalRequests = [];
  assert.ok(process.env.MOE4ALL_EVIDENCE_DIR, 'Set MOE4ALL_EVIDENCE_DIR under the shared work root');
  const shots = path.join(process.env.MOE4ALL_EVIDENCE_DIR, 'website-screenshots'); fs.mkdirSync(shots, { recursive: true });
  try {
    const page = await browser.newPage({ reducedMotion: 'reduce', locale: 'zh-CN' });
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    page.on('request', request => { if (/^https?:/.test(request.url())) externalRequests.push(request.url()); });
    for (const width of [1440, 1920, 3840, 768, 390, 320]) {
      await page.setViewportSize({ width, height: width === 3840 ? 2160 : width === 320 ? 700 : width < 650 ? 844 : 960 });
      await page.goto(pathToFileURL(path.join(__dirname, '../index.html')).href);
      await page.waitForFunction(() => document.querySelector('#scenario-prompt').textContent.length > 10);
      await page.evaluate(async () => Promise.all([...document.images].map(image => { image.loading = 'eager'; return image.decode(); })));
      await page.locator('#hero-play').click();
      assert.equal(await page.locator('#carousel-play').getAttribute('aria-pressed'), 'false');
      await page.locator('#hero-play').click();
      assert.equal(await page.locator('#carousel-play').getAttribute('aria-pressed'), 'true');
      for (const lang of ['zh', 'en']) {
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width, `Overflow ${lang}/${width}`);
        assert.ok(await page.locator('.hero-stage').evaluate(element => element.getBoundingClientRect().bottom < innerHeight), `No next-section hint ${lang}/${width}`);
        assert.ok(await page.locator('svg.lucide').count() > 35);
        assert.equal(await page.locator('img').evaluateAll(images => images.every(image => image.naturalWidth > 0)), true);
        for (const scenario of ['past', 'future', 'remote', 'private']) {
          await page.locator(`[data-scenario="${scenario}"]`).click();
          assert.equal(await page.locator('#scenario-panel').getAttribute('data-scene'), scenario);
          assert.equal(await page.locator(`[data-scenario="${scenario}"]`).getAttribute('aria-selected'), 'true');
          assert.ok((await page.locator('#scenario-prompt').innerText()).length > 15);
        }
        await page.locator('[data-scenario="private"]').press('Home');
        assert.equal(await page.locator('[data-scenario="past"]').getAttribute('aria-selected'), 'true');
        assert.equal(await page.locator('.scenario-tabs .tab-arrow').count(), 0);
        const scenarioNext = page.locator('#scenario-next');
        assert.equal(await scenarioNext.evaluate(element => element.tagName), 'BUTTON');
        assert.equal(await scenarioNext.getAttribute('aria-label'), lang === 'en' ? 'Next scenario' : '下一场景');
        await scenarioNext.scrollIntoViewIfNeeded();
        const scenarioScroll = await page.evaluate(() => ({ y: scrollY, hash: location.hash }));
        for (const scenario of ['future', 'remote', 'private', 'past']) {
          await scenarioNext.click();
          assert.equal(await page.locator('#scenario-panel').getAttribute('data-scene'), scenario);
          assert.equal(await page.locator(`[data-scenario="${scenario}"]`).getAttribute('aria-selected'), 'true');
          assert.equal(await page.evaluate(() => location.hash), scenarioScroll.hash);
          assert.ok(Math.abs(await page.evaluate(() => scrollY) - scenarioScroll.y) <= 2, `Scenario scroll jump ${lang}/${width}/${scenario}`);
        }
        await scenarioNext.press('Enter');
        assert.equal(await page.locator('#scenario-panel').getAttribute('data-scene'), 'future');
        await scenarioNext.press('Space');
        assert.equal(await page.locator('#scenario-panel').getAttribute('data-scene'), 'remote');
        await page.locator('[data-scenario="remote"]').press('Home');
        const nextPeek = await page.locator('.carousel-window').evaluate(window => {
          const w = window.getBoundingClientRect(), second = window.querySelectorAll('.demo-slide')[1].getBoundingClientRect();
          return Math.min(second.right, w.right) - Math.max(second.left, w.left);
        });
        assert.ok(nextPeek > 5, `Next slide not visible before interaction: ${width}`);
        for (const view of ['workspace', 'models', 'memory', 'remote']) {
          await page.locator(`[data-view="${view}"]`).click();
          assert.equal(await page.locator('.product-carousel').getAttribute('data-current-view'), view);
          const frame = page.frameLocator(`[data-slide="${view}"] iframe`);
          await frame.locator(`body[data-view="${view}"]`).waitFor();
          await frame.locator(`html[lang="${lang === 'en' ? 'en' : 'zh-CN'}"]`).waitFor();
          assert.ok((await frame.locator('.demo-main').innerText()).length > 150);
          assert.equal(await frame.locator('.demo-label').innerText(), lang === 'en' ? 'Demo workspace' : '演示工作区');
          const hero = page.frameLocator('#hero-screen');
          await hero.locator(`body[data-view="${view}"]`).waitFor();
          await hero.locator(`html[lang="${lang === 'en' ? 'en' : 'zh-CN'}"]`).waitFor();
          assert.equal(await hero.locator('.demo-main').innerText(), await frame.locator('.demo-main').innerText(), 'Hero and gallery content diverged');
          if (view === 'memory') assert.equal(await frame.locator('.memory-list article').count(), 4);
          if (view === 'models') assert.equal(await frame.locator('.models-list>div').count(), 3);
          if (width === 1440) await page.locator('.product-carousel').screenshot({ path: path.join(shots, `demo-${view}-${lang}.png`) });
        }
        await page.locator('#carousel-next').click();
        assert.equal(await page.locator('.product-carousel').getAttribute('data-current-view'), 'workspace');
        await page.locator('#carousel-prev').click();
        assert.equal(await page.locator('.product-carousel').getAttribute('data-current-view'), 'remote');
        await page.locator('#expand-product').click();
        assert.ok(await page.locator('#product-dialog').isVisible());
        await page.frameLocator('#expanded-product').locator('body[data-view="remote"]').waitFor();
        await page.keyboard.press('Escape');
        assert.equal(await page.locator('#product-dialog').isVisible(), false);
        await page.locator('[data-view="remote"]').press('Home');
        assert.equal(await page.locator('.product-carousel').getAttribute('data-current-view'), 'workspace');
        assert.equal(await page.locator('#carousel-play').getAttribute('aria-pressed'), 'true');
        assert.equal(await page.locator('[data-agent-download]').evaluateAll(links => links.every(link => link.href === window.MoeSite.getDownload("agent").url)), true);
        if (await page.evaluate(() => !window.MOE4ALL_DATA.releases.agent)) assert.equal(await page.locator('[data-agent-download]').first().innerText(), lang === 'en' ? 'Get MoE4All' : '下载 MoE4All');
        await page.locator('details').first().locator('summary').click();
        assert.equal(await page.locator('details').first().getAttribute('open'), '');
        if (lang === 'en') {
          assert.equal(await page.locator('details').first().locator('summary').innerText(), 'Can I use it without knowing how to code?');
          assert.match(await page.locator('details').first().locator('p').innerText(), /^Yes\./);
        }
        await page.locator('details').first().locator('summary').click();
        if (width === 1440) await page.locator('#privacy').screenshot({ path: path.join(shots, `privacy-${lang}.png`) });
        await page.evaluate(() => scrollTo(0, 0));
        await page.waitForTimeout(250);
        const firstShot = await page.screenshot({ path: path.join(shots, `everyday-${width}-${lang}-first.png`) });
        if (width >= 1440) {
          const rect = await page.locator('#hero-screen').boundingBox();
          const region = { left: Math.floor(rect.x + rect.width * .15), top: Math.floor(rect.y + rect.height * .15), width: Math.floor(rect.width * .7), height: Math.floor(rect.height * .7) };
          const { data, info } = await sharp(firstShot).extract(region).raw().toBuffer({ resolveWithObject: true });
          let brightPixels = 0;
          for (let i = 0; i < data.length; i += info.channels) if (data[i] > 150 && data[i+1] > 150 && data[i+2] > 150) brightPixels++;
          assert.ok(brightPixels > 100, `Embedded hero screen rendered blank: ${lang}/${width}`);
        }
        if (width === 1440 || width === 390) await page.screenshot({ path: path.join(shots, `everyday-${width}-${lang}-full.png`), fullPage: true });
        await page.locator('#language-toggle').click();
      }
      if (width <= 768) {
        await page.locator('#menu-toggle').click(); assert.ok(await page.locator('#main-nav').isVisible());
        await page.locator('#main-nav [data-contact]').click();
        assert.equal(await page.locator('#menu-toggle').getAttribute('aria-expanded'), 'false');
        await page.keyboard.press('Escape');
      }
      reports.push({ width, languages: ['zh', 'en'], sharedContent: true, interactions: 'passed' });
    }
    assert.equal(externalRequests.length, 0, 'Demo should not call a backend or any external service');
    assert.equal(errors.length, 0, errors.join('\n'));
    fs.writeFileSync(path.join(process.env.MOE4ALL_EVIDENCE_DIR, 'everyday-results.json'), JSON.stringify({ status: 'passed', reports, errors, externalRequests }, null, 2));
    console.log(JSON.stringify({ status: 'passed', reports, errors, externalRequests }, null, 2));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
