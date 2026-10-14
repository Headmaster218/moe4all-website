const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const path = require('node:path');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const { spawnSync } = require('node:child_process');
const sharp = require(process.env.SHARP_MODULE || (process.env.PLAYWRIGHT_MODULE ? path.join(path.dirname(process.env.PLAYWRIGHT_MODULE), 'sharp') : 'sharp'));

(async () => {
  const root = path.resolve(__dirname, '..');
  const destination = path.join(root, 'assets', 'readme');
  const frames = path.join(__dirname, 'screenshots', 'readme-frames');
  fs.mkdirSync(destination, { recursive: true });
  fs.mkdirSync(frames, { recursive: true });
  const browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe' });
  const errors = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, reducedMotion: 'reduce', locale: 'zh-CN' });
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(pathToFileURL(path.join(root, 'index.html')).href);
    await page.frameLocator('#hero-screen').locator('body[data-view="workspace"]').waitFor();
    await page.evaluate(async () => Promise.all([...document.images].map(image => { image.loading = 'eager'; return image.decode(); })));
    await page.waitForTimeout(300);
    await page.locator('.hero-stage').screenshot({ path: path.join(destination, 'welcome.jpg'), type: 'jpeg', quality: 90 });

    await page.setViewportSize({ width: 960, height: 620 });
    for (const view of ['workspace', 'models', 'memory', 'remote']) {
      await page.goto(`${pathToFileURL(path.join(root, 'demo.html')).href}?view=${view}&lang=zh`);
      await page.locator(`body[data-view="${view}"]`).waitFor();
      assert.ok((await page.locator('.demo-main').innerText()).length > 150);
      const png = await page.screenshot();
      const metadata = await sharp(png).metadata();
      assert.equal(metadata.width, 960);
      await sharp(png).png({ palette: true }).toFile(path.join(destination, `${view}.png`));
    }

    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.setViewportSize({ width: 1040, height: 1400 });
    await page.clock.install();
    await page.goto(pathToFileURL(path.join(root, 'technical.html')).href);
    const visual = page.locator('.memory-visual');
    await visual.scrollIntoViewIfNeeded();
    await page.clock.pauseAt(new Date(Date.now() + 1000));
    await page.clock.runFor(100);
    const bounds = await visual.boundingBox();
    assert.ok(bounds.width > 500 && bounds.height > 500);
    // Fixed browser-clock steps keep the GIF's pacing independent of capture time.
    const modes = new Set(), routes = new Set();
    let count = 0, finished = false;
    while (count < 320) {
      await page.clock.runFor(125);
      const state = await visual.evaluate(element => ({ mode: element.dataset.mode, batch: Number(element.dataset.batch), tokens: Number(element.querySelector('#generated-phrase').dataset.length), routes: [...element.querySelectorAll('.expert-flight')].map(flight => `${flight.dataset.from}->${flight.dataset.to}`) }));
      modes.add(state.mode);
      state.routes.forEach(route => routes.add(route));
      const frame = await page.screenshot({ clip: bounds });
      await sharp(frame).extend({ top: 24, bottom: 24, left: 24, right: 24, background: '#171c19' }).png().toFile(path.join(frames, `frame-${String(count).padStart(4, '0')}.png`));
      count++;
      if (state.tokens >= 4) { finished = true; break; }
    }
    assert.ok(finished, 'All four cache scenarios must complete');
    assert.equal(modes.size, 4);
    for (const route of ['ssd->ram', 'ram->vram', 'vram->compute']) assert.ok(routes.has(route), route);
    assert.equal(errors.length, 0, errors.join('\n'));
    const result = spawnSync(process.env.FFMPEG_PATH || 'ffmpeg', ['-y', '-loglevel', 'error', '-framerate', '8', '-i', path.join(frames, 'frame-%04d.png'), '-frames:v', String(count), '-filter_complex', '[0:v]split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=3', '-loop', '0', path.join(destination, 'expert-flow.gif')], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.error?.message || result.stderr);
    const gif = await sharp(path.join(destination, 'expert-flow.gif'), { animated: true }).metadata();
    assert.equal(gif.pages, count);
    assert.ok(fs.statSync(path.join(destination, 'expert-flow.gif')).size < 8 * 1024 * 1024, 'Keep README animation under 8 MiB');
    console.log(JSON.stringify({ status: 'passed', frames: count, seconds: count / 8, modes: [...modes], routes: [...routes], gifBytes: fs.statSync(path.join(destination, 'expert-flow.gif')).size }));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
