const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
const { pathToFileURL } = require('node:url');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

(async () => {
  const root = path.resolve(__dirname, '..'), site = process.env.MOE4ALL_SITE_OUTPUT;
  const output = process.env.MOE4ALL_EVIDENCE_DIR;
  const shared = path.resolve(process.env.MOE4ALL_WORK_ROOT || 'D:/AIinfr/infr/local-work');
  assert.ok(site && path.resolve(site).startsWith(shared + path.sep));
  assert.ok(output && path.resolve(output).startsWith(path.join(shared, 'evidence') + path.sep));
  await fs.mkdir(output, { recursive: true });
  const { benchmarkFixture } = await import(pathToFileURL(path.join(root, 'backend/fixtures.mjs')));
  const { indexArtifacts } = await import(pathToFileURL(path.join(root, 'scripts/build-leaderboard.mjs')));
  const { indexRows } = await import(pathToFileURL(path.join(root, 'community/leaderboard-model.mjs')));
  const artifacts = indexArtifacts([0, 1, 2].map(i => {
    const payload = benchmarkFixture(i);
    if (i === 2) { payload.model.name = 'Qwen3.8-FlashNext-4.27bpw.gguf'; payload.configuration.mtp = true; }
    return { payload };
  }), {
    source: { repository: 'Headmaster218/MoE4All', commit: 'a'.repeat(40), path_version: 1 }, generatedAt: '2026-10-21T00:00:00Z'
  });
  artifacts.manifest.package_commit = 'b'.repeat(40);
  const mime = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp' };
  const server = http.createServer(async (req, res) => {
    try {
      let relative = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      if (relative.endsWith('/')) relative += 'index.html';
      const filename = path.resolve(site, '.' + relative);
      if (!filename.startsWith(path.resolve(site) + path.sep)) { res.writeHead(403); res.end(); return; }
      res.writeHead(200, { 'Content-Type': mime[path.extname(filename)] || 'application/octet-stream' }); res.end(await fs.readFile(filename));
    } catch { res.writeHead(404); res.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', args: ['--disable-gpu'] });
  const errors = [], external = [], releaseRequests = [], dataRequests = [], views = [];
  let offline = false;
  try {
    const context = await browser.newContext({ locale: 'zh-CN', viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
    await context.route('https://api.github.com/repos/*/*/releases*', route => route.fulfill({ json: [] }));
    await context.route('https://raw.githubusercontent.com/**', async route => {
      const url = route.request().url(); dataRequests.push(url);
      const base = 'https://raw.githubusercontent.com/Headmaster218/MoE4All/';
      if (url === base + 'main/benchmark-database/index/v1/manifest.json') {
        await route.fulfill({ status: offline ? 503 : 200, contentType: 'application/json', body: JSON.stringify(artifacts.manifest), headers: { 'Access-Control-Allow-Origin': '*' } }); return;
      }
      assert.ok(url.startsWith(base + artifacts.manifest.package_commit + '/benchmark-database/index/v1/'));
      const name = url.split('/').at(-1), pack = Object.values(artifacts.packages).find(p => p.descriptor.url === name);
      assert.ok(pack);
      await route.fulfill({ contentType: 'application/octet-stream', body: pack.bytes, headers: { 'Access-Control-Allow-Origin': '*' } });
    });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', req => {
      if (/^https:\/\/api\.github\.com\/repos\/Headmaster218\/(MoE4All|MoE4All-Agent)\/releases\?/.test(req.url())) releaseRequests.push(req.url());
      else if (!req.url().startsWith(origin) && !req.url().startsWith('https://raw.githubusercontent.com/')) external.push(req.url());
    });
    await page.goto(origin + '/community/'); await page.locator('[data-row]').first().waitFor();
    const expected = indexRows(artifacts.index).length;
    assert.ok((await page.locator('.table-footer').innerText()).includes(`/ ${expected}`));
    assert.equal(await page.locator('[data-filter]:checked').count(), 0);
    assert.equal(await page.locator('#facet-panel').isVisible(), false);
    const sampleId = () => page.locator('#inspector [data-action="sample"]').getAttribute('data-id');
    const first = await sampleId(), second = await page.locator('[data-row]').nth(1).getAttribute('data-row');
    await page.locator('[data-row]').nth(1).locator('td.number, td').nth(3).click();
    assert.equal(await sampleId(), second); assert.notEqual(first, second);
    assert.equal(await page.locator('dialog[open]').count(), 0);
    assert.equal(await page.locator('[data-row][aria-selected="true"]').getAttribute('data-row'), second);
    await page.locator('[data-row]').nth(2).focus(); await page.keyboard.press('Enter');
    assert.equal(await sampleId(), await page.locator('[data-row]').nth(2).getAttribute('data-row'));
    await page.locator('[data-row]').nth(4).focus(); await page.keyboard.press('Space');
    assert.equal(await sampleId(), await page.locator('[data-row]').nth(4).getAttribute('data-row'));
    await page.locator('[data-row]').nth(3).locator('[data-action="sample"]').click();
    assert.equal(await sampleId(), await page.locator('[data-row]').nth(3).getAttribute('data-row'));
    await page.locator('dialog[open]').waitFor(); await page.locator('dialog [data-action="close"]').click();
    const selected = await sampleId(); await page.locator('[data-compare]').nth(3).check(); assert.equal(await sampleId(), selected);
    await page.locator('[data-compare]').nth(3).uncheck();
    let clicked = 0;
    while (true) {
      for (let i = 0; i < await page.locator('[data-row]').count(); i++) {
        const row = page.locator('[data-row]').nth(i), id = await row.getAttribute('data-row');
        await row.locator('.rank').click(); assert.equal(await sampleId(), id); clicked++;
      }
      if (await page.locator('[data-action="next"]').isDisabled()) break;
      await page.locator('[data-action="next"]').click();
    }
    assert.equal(clicked, expected);
    while (!(await page.locator('[data-action="prev"]').isDisabled())) await page.locator('[data-action="prev"]').click();
    await page.locator('[data-row]').first().locator('.rank').click();
    const assertEnglish = async () => {
      assert.equal(await page.locator('html').getAttribute('lang'), 'en');
      assert.equal(await page.locator('h1').innerText(), 'Performance leaderboard');
      const remaining = await page.evaluate(() => {
        const copy = document.body.cloneNode(true);
        copy.querySelectorAll('#language-toggle,script').forEach(node => node.remove());
        return (copy.textContent || '').match(/[\u3400-\u9fff]+/g) || [];
      });
      assert.deepEqual(remaining, []);
      const attributes = await page.locator('[title],[aria-label],[placeholder]').evaluateAll(nodes => nodes
        .filter(node => node.id !== 'language-toggle')
        .flatMap(node => ['title', 'aria-label', 'placeholder'].map(key => node.getAttribute(key) || ''))
        .filter(value => /[\u3400-\u9fff]/.test(value)));
      assert.deepEqual(attributes, []);
    };
    await page.locator('#language-toggle').click();
    await assertEnglish();
    await page.locator('[data-action="toggle-filters"]').click();
    await assertEnglish();
    await page.locator('input[data-filter="strategy"]').first().check();
    await assertEnglish();
    const strategy = await page.locator('input[data-filter="strategy"]:checked').inputValue();
    await page.locator('#language-toggle').click();
    assert.equal(await page.locator('input[data-filter="strategy"]:checked').inputValue(), strategy);
    await page.locator('#language-toggle').click();
    assert.equal(await page.locator('input[data-filter="strategy"]:checked').inputValue(), strategy);
    await page.locator('[data-action="reset-filters"]').click();
    await page.locator('input[name="context-mode"][value="points"]').check();
    await assertEnglish();
    await page.locator('input[name="context-mode"][value="range"]').check();
    await page.locator('[data-action="toggle-filters"]').click();
    await page.locator('[data-row]').first().locator('[data-action="sample"]').click();
    await page.locator('dialog[open]').waitFor();
    await page.locator('dialog .hardware-details').evaluate(node => { node.open = true; });
    await assertEnglish();
    await page.locator('dialog [data-action="close"]').click();
    await page.locator('[data-compare]').first().check();
    await assertEnglish();
    await page.locator('[data-action="clear-compare"]').click();
    await page.locator('#search').fill('no-matching-device');
    await assertEnglish();
    assert.equal(await page.locator('#run-table .empty h2').innerText(), 'No samples match these conditions');
    await page.locator('[data-action="reset-filters"]').click();
    await page.reload(); await page.locator('[data-row]').first().waitFor();
    await assertEnglish();
    assert.equal(await page.locator('.brand').getAttribute('href'), '../index.html');
    for (const width of [1440, 1024, 768, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.evaluate(() => { document.activeElement?.blur(); scrollTo(0, 0); });
      await page.screenshot({ path: path.join(output, `leaderboard-${width}.png`), fullPage: true });
      const layout = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth, images: [...document.images].every(img => img.complete && img.naturalWidth > 0) }));
      assert.ok(layout.scroll <= width + 2, JSON.stringify(layout)); assert.ok(layout.images);
      views.push(layout);
    }
    assert.equal(dataRequests.length, 3);
    await page.reload(); await page.locator('[data-row]').first().waitFor(); assert.equal(dataRequests.length, 4);
    await page.locator('#language-toggle').click();
    offline = true; await page.reload(); await page.locator('.dataset-status').getByText('离线缓存', { exact: true }).waitFor();
    assert.equal(dataRequests.length, 5);
    await page.locator('#language-toggle').click();
    await page.locator('.dataset-status').getByText('Offline cache', { exact: true }).waitFor();
    await assertEnglish();
    await page.setViewportSize({ width: 1440, height: 1000 });
    for (const route of ['/technical.html', '/community/', '/community/upload.html', '/index.html']) {
      await page.goto(origin + route);
      await page.locator('.brand').first().waitFor();
      await page.locator('.brand').first().click();
      await page.waitForURL(origin + '/index.html');
      assert.equal(await page.locator('html').getAttribute('lang'), 'en');
    }
    const firstVisit = await browser.newContext({ locale: 'en-US', viewport: { width: 1440, height: 1000 } });
    await firstVisit.route('https://api.github.com/**', route => route.fulfill({ json: [] }));
    await firstVisit.route('https://raw.githubusercontent.com/**', route => route.fulfill({ status: 503, body: '' }));
    const firstPage = await firstVisit.newPage();
    await firstPage.goto(origin + '/community/');
    await firstPage.getByRole('heading', { name: 'Leaderboard temporarily unavailable' }).waitFor();
    assert.equal(await firstPage.locator('html').getAttribute('lang'), 'en');
    assert.equal(await firstPage.getByRole('button', { name: 'Retry', exact: true }).count(), 1);
    assert.equal(/[\u3400-\u9fff]/.test((await firstPage.locator('#main').innerText())), false);
    await firstVisit.close();
    assert.deepEqual(errors, []); assert.deepEqual(external, []);
    await fs.writeFile(path.join(output, 'browser-results.json'), JSON.stringify({ status: 'passed', fixture: 'Synthetic benchmark fixtures, not published or real measurements', expected_rows: expected, row_selection: true, unfiltered_defaults: true, keyboard_selection: true, immutable_git_packages: true, offline_cache: true, views, errors, external_requests: external, unrelated_release_queries_mocked: releaseRequests, data_requests: dataRequests }, null, 2));
    console.log(JSON.stringify({ passed: true, expected_rows: expected, views: views.length, data_requests: dataRequests.length }));
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
