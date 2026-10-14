const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
(async () => {
  const root = path.resolve(__dirname, '..');
  const browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe' });
  const errors = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, reducedMotion: 'no-preference', locale: 'zh-CN' });
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(pathToFileURL(path.join(root, 'index.html')).href);
    await page.waitForFunction(() => document.querySelector('.product-carousel').dataset.currentView === 'workspace');
    const firstTransform = await page.locator('.carousel-track').evaluate(element => element.style.transform);
    await page.waitForFunction(() => document.querySelector('.product-carousel').dataset.currentView === 'models', null, { timeout: 10000 });
    assert.notEqual(await page.locator('.carousel-track').evaluate(element => element.style.transform), firstTransform);
    await page.frameLocator('#hero-screen').locator('body[data-view="models"]').waitFor();
    await page.locator('.product-carousel').hover({ position: { x: 10, y: 70 } });
    const hoveredView = await page.locator('.product-carousel').getAttribute('data-current-view');
    await page.waitForTimeout(6500);
    assert.equal(await page.locator('.product-carousel').getAttribute('data-current-view'), hoveredView, 'Hover must stop autoplay');
    await page.mouse.move(1, 1);
    await page.locator('#carousel-play').click();
    assert.equal(await page.locator('#carousel-play').getAttribute('aria-pressed'), 'true');
    const pausedView = await page.locator('.product-carousel').getAttribute('data-current-view');
    await page.waitForTimeout(6500);
    assert.equal(await page.locator('.product-carousel').getAttribute('data-current-view'), pausedView, 'Pause must stop autoplay');
    await page.locator('#carousel-play').click();
    await page.mouse.move(1, 1);
    await page.waitForFunction(value => document.querySelector('.product-carousel').dataset.currentView !== value, pausedView, { timeout: 10000 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.waitForFunction(() => document.querySelector('#carousel-play').getAttribute('aria-pressed') === 'true');
    assert.equal(await page.locator('#carousel-play').getAttribute('aria-pressed'), 'true');

    const mock = await browser.newContext({ viewport: { width: 1440, height: 960 }, reducedMotion: 'reduce', locale: 'zh-CN' });
    await mock.addInitScript(() => {
      let data;
      Object.defineProperty(window, 'MOE4ALL_DATA', {
        configurable: true, get: () => data,
        set: value => {
          value.releases.agent = { version: '9.8.7-preview.6', url: 'https://github.com/Headmaster218/MoE4All-Agent/releases/tag/agent-v9.8.7-preview.6', prerelease: true };
          value.releases.enginePreview = null;
          value.releases.engine.version = '9.8.7';
          value.releases.engine.url = 'https://github.com/Headmaster218/MoE4All/releases/tag/release-9.8.7';
          data = value;
        }
      });
    });
    const versionPage = await mock.newPage();
    versionPage.on('pageerror', error => errors.push(error.message));
    await versionPage.goto(pathToFileURL(path.join(root, 'index.html')).href);
    const versions = await versionPage.locator('[data-agent-version]').allTextContents();
    assert.ok(versions.every(value => value.includes('9.8.7-preview.6')));
    assert.ok(await versionPage.locator('[data-agent-download]').evaluateAll(links => links.every(link => link.href.endsWith('agent-v9.8.7-preview.6'))));
    await versionPage.locator('[data-view="models"]').click();
    const modelFrame = versionPage.frameLocator('[data-slide="models"] iframe');
    await modelFrame.locator('body[data-view="models"]').waitFor();
    assert.ok((await modelFrame.locator('.engine-row').innerText()).includes('9.8.7'));
    await versionPage.frameLocator('#hero-screen').locator('body[data-view="models"]').waitFor();
    assert.ok((await versionPage.frameLocator('#hero-screen').locator('.engine-row').innerText()).includes('9.8.7'));
    await versionPage.goto(pathToFileURL(path.join(root, 'technical.html')).href);
    await versionPage.waitForFunction(() => document.querySelector('[data-release-tag="agent"]').textContent.includes('9.8.7-preview.6'));
    assert.ok((await versionPage.locator('[data-release-announcement]').innerText()).includes('9.8.7'));
    assert.equal(await versionPage.locator('[data-release-link="enginePreview"]').first().isVisible(), false);

    await versionPage.goto(pathToFileURL(path.join(root, 'index.html')).href);
    const futureAgent = await versionPage.evaluate(() => {
      const agent = window.MOE4ALL_DATA.releases.agent;
      window.MOE4ALL_DATA.releases.agent = null;
      window.MoeSite.renderReleases('zh');
      return agent;
    });
    assert.equal(await versionPage.locator('[data-agent-download]').first().innerText(), '下载 MoE4All');
    assert.ok(await versionPage.locator('[data-agent-download]').evaluateAll(links => links.every(link => link.href === 'https://github.com/Headmaster218/MoE4All-Agent/releases')));
    assert.equal(await versionPage.locator('[data-agent-version]').first().innerText(), 'MoE4All v9.8.7');
    await versionPage.evaluate(agent => { window.MOE4ALL_DATA.releases.agent = agent; window.MoeSite.renderReleases('zh'); }, futureAgent);
    assert.ok(await versionPage.locator('[data-agent-download]').evaluateAll(links => links.every(link => link.dataset.downloadState === 'fallback')));
    await versionPage.locator('#language-toggle').click();
    assert.match(await versionPage.locator('#start [data-agent-download]').innerText(), /Download (for|MoE4All)/);
    await versionPage.evaluate(() => { window.MOE4ALL_DATA.releases.agent = null; window.MoeSite.renderReleases('en'); });
    assert.equal(await versionPage.locator('[data-agent-download]').first().innerText(), 'Get MoE4All');

    const native = await browser.newPage({ viewport: { width: 960, height: 620 }, reducedMotion: 'reduce' });
    for (const language of ['zh', 'en']) for (const view of ['workspace', 'models', 'memory', 'remote']) {
      await native.goto(pathToFileURL(path.join(root, 'demo.html')).href + `?lang=${language}&view=${view}`);
      await native.waitForSelector('.demo-app');
      const layout = await native.evaluate(() => {
        const sidebar = document.querySelector('.sidebar-bottom').getBoundingClientRect().bottom;
        const lastChat = document.querySelector('.chat-message:last-child')?.getBoundingClientRect().bottom;
        const composer = document.querySelector('.composer')?.getBoundingClientRect().top;
        const content = [...document.querySelectorAll('.settings-content>*, .phone')].map(element => element.getBoundingClientRect().bottom);
        return { sidebar, lastChat, composer, content, width: document.documentElement.scrollWidth };
      });
      assert.equal(layout.width, 960);
      assert.ok(layout.sidebar <= 620, `Sidebar clipped: ${language}/${view}`);
      assert.ok(layout.content.every(bottom => bottom <= 620), `Content clipped: ${language}/${view}`);
      if (layout.lastChat) assert.ok(layout.lastChat <= layout.composer, `Composer overlaps conversation: ${language}`);
      await native.screenshot({ path: path.join(__dirname, `screenshots/demo-native-${view}-${language}.png`) });
    }
    assert.equal(errors.length, 0, errors.join('\n'));
    const report = { status: 'passed', autoplay: true, hoverPauses: true, userPause: true, reducedMotion: true, sharedReleasePropagation: true, pendingAgentFallbackAndRecovery: true, demoClippingChecks: 8, errors };
    fs.writeFileSync(path.join(__dirname, 'showcase-results.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
    await mock.close();
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
