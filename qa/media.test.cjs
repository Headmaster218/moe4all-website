const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');

test('both pages show a small preview before the original-resolution WebP', () => {
  for (const file of ['index.html', 'technical.html']) {
    const html = fs.readFileSync(path.join(root, file), 'utf8');
    assert.ok(html.includes('assets/hardware-hero.webp'));
    assert.ok(html.includes('src="assets/hardware-preview.webp"'));
    assert.ok(html.includes('data-full-src="assets/hardware-hero.webp"'));
    assert.ok(html.includes('src="media.js"'));
    assert.ok(!html.includes('assets/hardware-hero.png'));
    assert.ok(!html.includes('srcset='));
    assert.ok(html.includes('fetchpriority="high"'));
  }
  const home = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  assert.ok(home.includes('src="assets/everyday-desk-preview.webp"'));
  assert.ok(home.includes('data-full-src="assets/everyday-desk-blank.webp"'));
  assert.ok(home.includes('width="1860" height="846"'));
  assert.ok(home.includes('loading="lazy" fetchpriority="low"'));
  const technical = fs.readFileSync(path.join(root, 'technical.html'), 'utf8');
  assert.ok(technical.includes('width="1536" height="1024"'));
  for (const [name, ceiling] of [['everyday-desk-blank', 80 * 1024], ['hardware-hero', 260 * 1024]]) {
    const data = fs.readFileSync(path.join(root, 'assets', name + '.webp'));
    assert.equal(data.toString('ascii', 0, 4), 'RIFF');
    assert.equal(data.toString('ascii', 8, 12), 'WEBP');
    assert.ok(data.length < ceiling);
  }
  for (const [name, ceiling] of [['everyday-desk-preview', 11 * 1024], ['hardware-preview', 42 * 1024]]) {
    const preview = fs.readFileSync(path.join(root, 'assets', name + '.webp'));
    assert.equal(preview.toString('ascii', 0, 4), 'RIFF');
    assert.equal(preview.toString('ascii', 8, 12), 'WEBP');
    assert.ok(preview.length < ceiling, 'Q30 previews should remain compact');
  }
  const script = fs.readFileSync(path.join(root, 'media.js'), 'utf8');
  assert.ok(script.includes('await full.decode()'));
  assert.ok(script.includes('IntersectionObserver'));
  assert.ok(script.includes('full.fetchPriority = "low"'));
});

test('gallery and modal demos are deferred instead of loading hidden documents', () => {
  for (const file of ['index.html', 'technical.html']) {
    const html = fs.readFileSync(path.join(root, file), 'utf8');
    const eager = [...html.matchAll(/<iframe\b[^>]*\ssrc="demo\.html/g)];
    const deferred = [...html.matchAll(/<iframe\b[^>]*\sdata-src="demo\.html/g)];
    assert.equal(eager.length, file === 'index.html' ? 1 : 0);
    assert.equal(deferred.length, 5);
  }
});
