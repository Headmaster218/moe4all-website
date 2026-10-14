const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe' });
  const errors = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, reducedMotion: 'no-preference' });
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
      const raf = window.requestAnimationFrame.bind(window); let time = 0;
      window.requestAnimationFrame = callback => raf(() => callback(time += 80));
    });
    await page.goto(pathToFileURL(path.join(__dirname, '../index.html')).href);
    await page.locator('.memory-visual').evaluate(element => window.scrollTo(0, scrollY + element.getBoundingClientRect().top - 95));
    await page.waitForFunction(() => {
      const flight = document.querySelector('.token-flight');
      if (!flight || Number(flight.dataset.progress) < .2) return false;
      document.querySelector('#memory-toggle').click(); return true;
    });
    assert.equal(await page.locator('#memory-toggle').getAttribute('aria-pressed'), 'true');
    await page.locator('#language-toggle').click();
    assert.equal(await page.locator('.token-flight').innerText(), 'Unlock');
    await page.locator('#memory-toggle').click();
    await page.waitForFunction(() => document.querySelector('#generated-phrase').dataset.length === '1');
    assert.equal(await page.locator('.generated-phrase .shown').innerText(), 'Unlock', 'English must emit the whole word, including during a language change');
    await page.waitForFunction(() => document.querySelector('#generated-phrase').dataset.length === '4', null, { timeout: 40000 });
    assert.equal((await page.locator('.generated-phrase .shown').allTextContents()).join(''), 'Unlock your hardware.');
    await page.waitForFunction(() => Number(document.querySelector('.memory-visual').dataset.batch) >= 25, null, { timeout: 40000 });
    assert.equal(await page.locator('.compute-slot').count(), 4);
    assert.equal(await page.locator('.memory-cell').count(), 48 + 96 + 192);
    assert.ok(await page.locator('.expert-flight').count() <= 4);
    assert.ok(await page.locator('.expert-eviction').count() <= 4);
    const ssd = await page.locator('.ssd-grid .memory-cell').evaluateAll(elements => elements.map(element => Number(element.dataset.expert)).sort((a, b) => a - b));
    assert.deepEqual(ssd, Array.from({ length: 192 }, (_, id) => id));
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(150);
    const offscreen = await page.locator('.memory-visual').getAttribute('data-batch');
    await page.waitForTimeout(700);
    assert.equal(await page.locator('.memory-visual').getAttribute('data-batch'), offscreen, 'Offscreen cache stories must stop advancing');
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ status: 'passed', languageChangeDuringOutput: true, completeSentence: true, cycles: 25, boundedAnimationNodes: true, offscreenPause: true, errors }, null, 2));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
