const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const path = require('node:path');
const sharp = require(process.env.SHARP_MODULE || (process.env.PLAYWRIGHT_MODULE ? path.join(path.dirname(process.env.PLAYWRIGHT_MODULE), 'sharp') : 'sharp'));
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const assert = require('node:assert/strict');

(async () => {
  const root = path.resolve(__dirname, '..'), shots = path.join(__dirname, 'screenshots');
  fs.mkdirSync(shots, { recursive: true });
  const browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe' });
  const errors = [], reports = [];
  try {
    const page = await browser.newPage({ reducedMotion: 'no-preference', locale: 'zh-CN' });
    page.on('pageerror', error => errors.push(error.message));
    const wait = async predicate => {
      try { await page.waitForFunction(predicate, null, { timeout: 20000 }); }
      catch (error) {
        console.log(JSON.stringify(await page.locator('.memory-visual').evaluate(element => ({ state: { ...element.dataset }, paused: element.classList.contains('is-paused'), top: element.getBoundingClientRect().top, bottom: element.getBoundingClientRect().bottom, viewport: innerHeight, hidden: document.hidden, flights: [...element.querySelectorAll('.expert-flight')].map(flight => ({ ...flight.dataset })) }))));
        throw error;
      }
    };
    const pause = () => page.locator('#memory-toggle').click();
    const snapshot = () => page.locator('.expert-flight').evaluateAll(elements => elements.map(element => ({ ...element.dataset, transform: element.style.transform })));
    const cache = selector => page.locator(`${selector} .memory-cell`).evaluateAll(elements => elements.map(element => ({ id: element.dataset.expert, wanted: element.dataset.wanted, rank: Number(element.dataset.rank), x: element.getBoundingClientRect().x, y: element.getBoundingClientRect().y })));
    for (const width of process.env.FLOW_WIDTHS ? process.env.FLOW_WIDTHS.split(',').map(Number) : [1440, 3840, 390, 320]) {
      await page.setViewportSize({ width, height: width === 3840 ? 2160 : width < 650 ? 844 : 960 });
      await page.goto(pathToFileURL(path.join(root, 'technical.html')).href);
      const visual = page.locator('.memory-visual');
      const shot = async (options = {}) => page.screenshot({ ...options, clip: await visual.boundingBox() });
      await visual.evaluate(element => window.scrollTo(0, scrollY + element.getBoundingClientRect().top - 95));
      await wait(() => document.querySelector('.memory-visual').dataset.phase === 'gpu-hit' && Number(document.querySelector('.expert-flight')?.dataset.progress) > .2);
      await pause();
      assert.equal(await page.locator('.expert-flight[data-from="vram"][data-to="compute"]').count(), 4);
      assert.equal(await page.locator('.memory-cell.missing').count(), 0);
      const called = await page.locator('.compute-slot').evaluateAll(elements => elements.map(element => element.dataset.expert));
      assert.deepEqual((await cache('#expert-grid')).slice(0, 4).map(item => item.id), called, 'Called experts must move to the hot head');
      assert.deepEqual((await cache('.ram-grid')).slice(0, 4).map(item => item.id), called, 'Host recency order must match the same calls');
      assert.ok(await page.locator('#expert-grid .memory-cell').evaluateAll(elements => elements.some(element => element.style.transform.includes('translate'))), 'Queue promotion must physically move tiles');
      const frozenA = await shot({ path: path.join(shots, `cache-${width}-full-hit.png`) });
      await page.waitForTimeout(450);
      const frozenB = await shot();
      assert.equal((await sharp(frozenA).raw().toBuffer()).equals(await sharp(frozenB).raw().toBuffer()), true, 'Pause must freeze promotion, flights and GPU work');
      const before = await snapshot(); await pause(); await page.waitForTimeout(90); const after = await snapshot();
      assert.ok(before.some((item, i) => after[i] && item.transform !== after[i].transform), 'Expert cards must physically travel into the GPU');
      await wait(() => document.querySelector('.memory-visual').dataset.lastMode === 'all-hit');
      const fastMs = Number(await visual.getAttribute('data-cycle-ms'));
      assert.equal(await page.locator('#generated-phrase').getAttribute('data-length'), '1');
      await wait(() => document.querySelector('.memory-visual').dataset.mode === 'ram-miss' && document.querySelectorAll('.expert-flight[data-from="ram"]').length === 2 && Number(document.querySelector('.expert-flight[data-from="ram"]')?.dataset.progress) > .1);
      await pause();
      assert.equal(await page.locator('#expert-grid .missing').count(), 2);
      assert.equal(await page.locator('.ram-grid .missing').count(), 0);
      assert.equal(await page.locator('.compute-slot.done').count(), 0);
      assert.equal(await page.locator('.compute-slot.missing').count(), 2);
      const hostFlights = await snapshot();
      assert.equal(hostFlights.filter(item => item.from === 'ram' && item.to === 'vram').length, 2);
      const holes = (await cache('#expert-grid')).filter(item => item.wanted).map(item => item.wanted);
      assert.deepEqual(hostFlights.filter(item => item.from === 'ram').map(item => item.expert).sort(), holes.sort(), 'RAM fills must target exactly the missing experts');
      await shot({ path: path.join(shots, `cache-${width}-ram-miss.png`) });
      await pause();
      await wait(() => document.querySelector('.memory-visual').dataset.mode === 'ram-miss' && Number(document.querySelector('.memory-visual').dataset.completed) === 2);
      await pause();
      assert.equal(await page.locator('.compute-slot.done').count(), 2);
      assert.equal(await page.locator('#expert-grid .missing').count(), 0);
      await pause();
      await wait(() => document.querySelector('.memory-visual').dataset.lastMode === 'ram-miss');
      const hostMs = Number(await visual.getAttribute('data-cycle-ms'));
      assert.equal(await page.locator('#generated-phrase').getAttribute('data-length'), '2');
      await wait(() => document.querySelector('.memory-visual').dataset.mode === 'ssd-miss' && document.querySelectorAll('.expert-eviction').length === 4 && Number(document.querySelector('.expert-flight[data-from="ssd"]')?.dataset.progress) > .1);
      await pause();
      assert.equal(await page.locator('#expert-grid .missing').count(), 2);
      assert.equal(await page.locator('.ram-grid .missing').count(), 2);
      assert.equal(await page.locator('.expert-dust').count(), 40);
      const diskIds = (await snapshot()).filter(item => item.from === 'ssd').map(item => item.expert).sort();
      const vramGaps = (await cache('#expert-grid')).filter(item => item.wanted).map(item => item.wanted).sort();
      assert.deepEqual(diskIds, vramGaps);
      await shot({ path: path.join(shots, `cache-${width}-eviction.png`) });
      await pause();
      await wait(() => document.querySelector('.memory-visual').dataset.mode === 'ssd-miss' && Number(document.querySelector('.memory-visual').dataset.completed) === 2 && document.querySelectorAll('.expert-flight[data-from="ssd"]').length === 2);
      await pause();
      assert.equal(await page.locator('.compute-slot.done').count(), 2);
      assert.equal(await page.locator('.compute-slot.missing').count(), 2);
      await shot({ path: path.join(shots, `cache-${width}-ssd-wait.png`) });
      await page.evaluate(() => {
        window.observedRamExperts = new Set([...document.querySelectorAll('.expert-flight[data-from="ram"]')].map(node => node.dataset.expert));
        window.ramFlightObserver = new MutationObserver(records => {
          for (const record of records) for (const node of record.addedNodes) {
            if (node.nodeType === 1 && node.matches('.expert-flight[data-from="ram"]')) window.observedRamExperts.add(node.dataset.expert);
          }
        });
        window.ramFlightObserver.observe(document.querySelector('.expert-flight-layer'), { childList: true });
      });
      await pause();
      await wait(() => document.querySelector('.memory-visual').dataset.lastMode === 'ssd-miss');
      const passedThroughRam = await page.evaluate(() => { window.ramFlightObserver.disconnect(); return [...window.observedRamExperts].sort(); });
      assert.deepEqual(passedThroughRam, diskIds, 'Same numbered SSD experts must continue through RAM to VRAM');
      const diskMs = Number(await visual.getAttribute('data-cycle-ms'));
      assert.equal(await page.locator('#generated-phrase').getAttribute('data-length'), '3');
      assert.ok(diskMs > hostMs + 2000 && hostMs > fastMs + 600, 'Slower tiers must produce visibly longer generation cycles');
      assert.ok((await page.locator('#ram-transfer-count').innerText()).includes('0.8s'));
      assert.ok((await page.locator('#ssd-transfer-count').innerText()).includes('2.6s'));
      await wait(() => document.querySelector('.memory-visual').dataset.mode === 'mixed-miss' && Number(document.querySelector('.memory-visual').dataset.completed) === 3 && document.querySelectorAll('.compute-slot.missing').length === 1);
      await pause();
      assert.equal(await page.locator('.compute-slot.done').count(), 3);
      const sorted = await cache('#expert-grid');
      assert.ok(sorted[0].x <= sorted[4].x && sorted[4].x <= sorted[sorted.length - 1].x, 'Hot order must run from left to right, column by column');
      const bounds = await page.locator('#expert-grid .memory-cell').evaluateAll(elements => elements.map(element => ({ h: element.getBoundingClientRect().height, grid: Number.parseFloat(getComputedStyle(element.parentElement).gridTemplateRows.split(' ')[0]) })));
      assert.ok(bounds.every(item => item.h <= item.grid + .5), 'Queue tiles must fit their grid rows');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width);
      await page.locator('#language-toggle').click();
      assert.equal(await page.locator('[data-tier-activity="gpu"]').innerText(), 'Hot 24 / 48');
      assert.equal(await page.locator('#generated-phrase').getAttribute('data-length'), '3');
      const report = { width, fullHit: true, twoMissingSlots: true, coldEvictionParticles: 40, sameExpertsAcrossTiers: true, partialCompute: [2, 3], simulatedTokensEmitted: 3, cycleMs: { vram: fastMs, ram: hostMs, ssd: diskMs }, pause: true };
      reports.push(report); console.log(JSON.stringify(report));
    }
    assert.equal(errors.length, 0, errors.join('\n'));
    const report = { status: 'passed', reports, errors };
    fs.writeFileSync(path.join(__dirname, 'flow-results.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ status: 'passed', viewports: reports.map(item => item.width), errors }, null, 2));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
