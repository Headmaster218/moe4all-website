const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');

test('both pages use original-resolution WebP assets without thumbnail downloads', () => {
  for (const file of ['index.html', 'technical.html']) {
    const html = fs.readFileSync(path.join(root, file), 'utf8');
    assert.ok(html.includes('assets/hardware-hero.webp'));
    assert.ok(!html.includes('assets/hardware-hero.png'));
    assert.ok(!html.includes('srcset='));
    assert.ok(html.includes('fetchpriority="high"'));
  }
  const home = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  assert.ok(home.includes('assets/everyday-desk-blank.webp'));
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
