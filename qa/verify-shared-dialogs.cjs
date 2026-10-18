const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '..');

(async () => {
  const out = process.env.MOE4ALL_EVIDENCE_DIR;
  assert.ok(out, 'Set MOE4ALL_EVIDENCE_DIR under the shared work root');
  const shots = path.join(out, 'screenshots'); fs.mkdirSync(shots, { recursive: true });
  const browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', args: ['--no-proxy-server', '--disable-gpu'] });
  const reports = [], errors = [];
  try {
    for (const file of ['index.html', 'technical.html']) {
      const page = await browser.newPage({ locale: 'zh-CN', reducedMotion: 'reduce', viewport: { width: 1440, height: 960 } });
      page.on('pageerror', error => errors.push(error.message));
      const requests = []; page.on('request', request => requests.push(request.url()));
      await page.goto(pathToFileURL(path.join(root, file)).href);
      await page.waitForSelector('#download-dialog', { state: 'attached' });
      assert.equal(await page.locator('#download-dialog').count(), 1);
      assert.ok(!requests.some(url => url.includes('assets/wechat-')));
      const home = file === 'index.html';
      for (const width of [1440, 3840, 1150, 1101, 768, 390, 320]) {
        await page.setViewportSize({ width, height: width === 3840 ? 2160 : width < 650 ? 844 : 960 });
        await page.evaluate(() => scrollTo(0, 0));
        for (const language of ['zh', 'en']) {
          const current = await page.locator('html').getAttribute('lang');
          if ((language === 'en') !== (current === 'en')) await page.locator('#language-toggle').click();
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width, `Page overflow ${file}/${width}/${language}`);
          const header = await page.locator('.nav-inner').evaluate(element => [...element.children].filter(child => getComputedStyle(child).display !== 'none').map(child => { const r = child.getBoundingClientRect(); return { left: r.left, right: r.right }; }));
          header.slice(1).forEach((r, index) => assert.ok(header[index].right <= r.left + 1, `Header overlap ${file}/${width}/${language}`));
          const action = page.locator(home ? '[data-agent-download]:visible' : '[data-download]:visible').first();
          await action.click();
          await page.locator('#download-dialog[open]').waitFor();
          assert.equal(await page.locator('#download-dialog [data-system]').count(), 3);
          assert.equal(await page.locator('#download-architecture').count(), 0);
          assert.equal(await page.locator('#download-dialog [data-product]').first().getAttribute('data-product'), 'agent');
          const layout = await page.locator('#download-dialog').evaluate(d => ({ width: d.clientWidth, scroll: d.scrollWidth, height: d.getBoundingClientRect().height, maxHeight: innerHeight, primary: d.querySelector('.site-product-primary').getBoundingClientRect().height, engine: d.querySelector('[data-product="engine"]').getBoundingClientRect().height }));
          assert.ok(layout.scroll <= layout.width, `Dialog overflow ${file}/${width}/${language}`);
          assert.ok(layout.height < layout.maxHeight);
          assert.ok(layout.primary > layout.engine);
          for (const os of ['linux', 'macos', 'windows']) {
            await page.locator(`[data-system="${os}"]`).click();
            assert.equal(await page.locator(`[data-system="${os}"]`).getAttribute('aria-pressed'), 'true');
            assert.equal(await page.locator('#download-dialog').evaluate(d => d.scrollWidth <= d.clientWidth), true, `Platform switch overflow ${file}/${width}/${language}/${os}`);
            const href = await page.locator('[data-package="engine"]').getAttribute('href');
            assert.ok(href.startsWith('https://github.com/Headmaster218/MoE4All/releases'));
            if (os === 'linux') assert.ok(href.includes('Linux-x86_64'));
          }
          if ([1440, 390].includes(width)) await page.screenshot({ path: path.join(shots, `${home ? 'public' : 'technical'}-${width}-${language}-download.png`) });
          await page.locator('#download-dialog [data-shared-close]').click();
          assert.ok(!requests.some(url => url.includes('assets/wechat-')), 'Download dialog must not request QR codes');
          for (const kind of ['contact', 'support']) {
            if (!(await page.locator(`#main-nav [data-${kind}]`).isVisible())) await page.locator('#menu-toggle').click();
            await page.locator(`#main-nav [data-${kind}]`).click();
            const dialog = page.locator(`#${kind}-dialog`);
            await dialog.locator('img').evaluate(image => image.decode());
            const qr = await dialog.locator('img').evaluate(i => ({ width: i.naturalWidth, height: i.naturalHeight }));
            assert.equal(qr.width, 480);
            assert.ok(await dialog.locator('[download]').isVisible());
            assert.equal(await dialog.evaluate(d => d.scrollWidth <= d.clientWidth), true);
            if ([1440, 390].includes(width)) await page.screenshot({ path: path.join(shots, `${home ? 'public' : 'technical'}-${width}-${language}-${kind}.png`) });
            await dialog.locator('[data-shared-close]').click();
          }
          requests.length = 0;
        }
        reports.push({ file, width, languages: ['zh', 'en'], passed: true });
      }
      await page.evaluate(() => {
        const repository = window.MOE4ALL_DATA.site.agentRepository, tag = 'agent-v9.9.9';
        window.MOE4ALL_DATA.releases.agent = { version: '9.9.9', tag, url: `https://github.com/${repository}/releases/tag/${tag}`, assets: ['Windows-x86_64.zip', 'Linux-x86_64.tar.gz', 'macOS-arm64.dmg', 'macOS-x86_64.dmg'].map(platform => ({ name: `MoE4All-Agent-${platform}`, size: 1024, url: `https://github.com/${repository}/releases/download/${tag}/MoE4All-Agent-${platform}` })) };
      });
      await page.locator(home ? '[data-agent-download]:visible' : '[data-download]:visible').first().click();
      for (const [os, suffix] of [['windows', 'Windows-x86_64.zip'], ['linux', 'Linux-x86_64.tar.gz'], ['macos', 'macOS-x86_64.dmg']]) {
        await page.locator(`[data-system="${os}"]`).click();
        assert.ok((await page.locator('[data-package="agent"]').getAttribute('href')).endsWith(suffix));
        assert.equal(await page.locator('[data-package="agent"]').getAttribute('data-direct'), 'true');
      }
      await page.evaluate(() => { window.MOE4ALL_DATA.releases.agent.assets = window.MOE4ALL_DATA.releases.agent.assets.filter(asset => asset.name.includes('arm64')); window.dispatchEvent(new Event('moe-releases-updated')); });
      assert.equal(await page.locator('[data-package="agent"]').getAttribute('data-direct'), 'false');
      assert.ok((await page.locator('[data-package="agent"]').getAttribute('href')).endsWith('/releases/tag/agent-v9.9.9'));
      const market = page.locator('.site-plugin-split > a');
      assert.equal(await market.getAttribute('href'), 'https://awesome-dsh-plugin.com/p/Headmaster218/dsh-llm-moe4all/');
      const menu = page.locator('.site-install-menu');
      await menu.locator('summary').click();
      assert.equal(await menu.getAttribute('open'), '');
      assert.equal(await menu.locator('a').count(), 3);
      assert.ok(await menu.locator('a[href="https://github.com/Headmaster218/dsh-llm-moe4all"]').isVisible());
      assert.ok(await menu.locator('a[href="https://www.dsh.so/artifact/dsh-llm-moe4all/"]').isVisible());
      assert.equal(await menu.evaluate(d => { const r = d.querySelector('.site-install-options').getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth; }), true);
      await page.keyboard.press('Escape');
      assert.equal(await menu.getAttribute('open'), null);
      assert.ok(await page.locator('#download-dialog').evaluate(d => d.open));
      await menu.locator('summary').click();
      await page.locator('#download-dialog h2').click();
      assert.equal(await menu.getAttribute('open'), null);
      await page.close();
    }
    assert.deepEqual(errors, []);
    fs.writeFileSync(path.join(out, 'shared-dialogs-results.json'), JSON.stringify({ status: 'passed', reports, fixturePackageSelection: true, errors }, null, 2));
    console.log(JSON.stringify({ status: 'passed', viewportsPerPage: 7, languages: 2, pages: 2, fixturePackageSelection: true, errors }));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
