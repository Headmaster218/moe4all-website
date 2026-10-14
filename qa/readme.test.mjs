import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = file => readFileSync(path.join(root, file), 'utf8');
const readme = read('README.md');

test('promotional README includes all product views and the cache animation', () => {
  for (const file of ['welcome.jpg', 'workspace.png', 'models.png', 'memory.png', 'remote.png', 'expert-flow.gif']) {
    const relative = `assets/readme/${file}`;
    assert.ok(readme.includes(relative), `Missing showcase: ${file}`);
    assert.ok(existsSync(path.join(root, relative)), `Missing asset: ${file}`);
    assert.ok(readFileSync(path.join(root, relative)).length > 10000);
  }
  assert.equal(readFileSync(path.join(root, 'assets/readme/expert-flow.gif')).subarray(0, 6).toString(), 'GIF89a');
  assert.ok(!readme.includes('node scripts/'), 'Keep build commands outside the promotional front page');
  assert.ok(read('.gitignore').split(/\r?\n/).includes('maintenance/'), 'Maintenance notes must stay local');
});

test('README local images and website anchors resolve', () => {
  for (const [, target] of readme.matchAll(/\]\(([^)\s]+)\)/g)) {
    if (!target.startsWith('https://')) {
      assert.ok(existsSync(path.join(root, target)), `Broken local link: ${target}`);
    } else if (target.startsWith('https://headmaster218.github.io/moe4all-website/')) {
      const url = new URL(target);
      const file = url.pathname.slice('/moe4all-website/'.length) || 'index.html';
      assert.ok(existsSync(path.join(root, file)), `Broken page: ${file}`);
      if (url.hash) assert.ok(read(file).includes(`id="${url.hash.slice(1)}"`), `Broken anchor: ${target}`);
    }
  }
});

test('README benchmark highlights match the maintained snapshot and metric', () => {
  const data = JSON.parse(read('content/benchmarks.json'));
  assert.ok(readme.includes('30K'));
  for (const model of data.models) {
    for (const speed of model.results['30000'].decode) assert.ok(readme.includes(`${speed.toFixed(2)} tok/s`));
    assert.ok(readme.includes(`${model.results['30000'].prefill.toFixed(2)} tok/s`));
  }
  assert.equal(data.metric, 'mean_aggregate_decode_tokens_per_second');
  assert.ok(readme.includes('\u603b\u541e\u5410\u91cf'));
  assert.ok(readme.includes('MTP \u5173\u95ed'));
});
