import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { previewIndex } from '../backend/leaderboard-preview.mjs';
import { indexRows, provenanceLinks, validateIndex } from '../community/leaderboard-model.mjs';

test('fictional preview index is explicitly marked and cannot be published', () => {
  const { index } = previewIndex(), rows = indexRows(index);
  assert.ok(rows.length > 100 && rows.every(row => row.demo));
  assert.equal(provenanceLinks(index, rows[0]), null);
  assert.throws(() => validateIndex({ ...index, mode: 'production' }));
});

test('local presentation includes all three policies and intermediate context lengths', () => {
  const rows = indexRows(previewIndex().index);
  assert.deepEqual([...new Set(rows.map(row => row.auto_profile))].sort(), ['aggressive', 'conservative', 'manual']);
  assert.ok(rows.some(row => row.context === 24576));
  assert.ok(rows.some(row => row.context === 98304));
});

test('technical page exposes shared community entry points without replacing its benchmarks', async () => {
  const html = await fs.readFile(new URL('../technical.html', import.meta.url), 'utf8');
  assert.equal((html.match(/href="community\/"/g) || []).length, 2);
  assert.equal((html.match(/href="community\/upload.html"/g) || []).length, 1);
  assert.ok(html.includes('id="benchmark-details"'));
  assert.ok(html.includes('id="benchmark-dialog"'));
  assert.ok(html.includes('data-en="Community leaderboard"'));
});

test('community pages reuse the same download/contact/support dialogs and remove breadcrumbs', async () => {
  for (const name of ['index.html', 'upload.html', 'admin.html']) {
    const html = await fs.readFile(new URL('../community/' + name, import.meta.url), 'utf8');
    for (const file of ['site-data.js', 'release-model.js', 'site-ui.js', 'site-dialogs.js', 'site-dialogs.css']) assert.ok(html.includes('../' + file));
  }
  const app = await fs.readFile(new URL('../community/app.mjs', import.meta.url), 'utf8');
  assert.ok(app.includes('class="technical-return"'));
  assert.ok(app.includes('data-download'));
  assert.ok(app.includes('data-support'));
  assert.ok(app.includes('data-contact'));
  assert.ok(!app.includes('class="breadcrumbs"'));
});
