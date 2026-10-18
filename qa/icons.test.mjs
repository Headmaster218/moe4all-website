import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';
import zlib from 'node:zlib';
import { usedIcons } from '../scripts/optimize-site.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pascal = value => value.split('-').map(part => part[0].toUpperCase() + part.slice(1)).join('');

test('the vendored subset covers static, conditional and modal icons without platform strings', async () => {
  const names = await usedIcons(root);
  assert.ok(names.includes('play') && names.includes('pause'));
  assert.ok(names.includes('code-xml') && names.includes('store'));
  assert.ok(!names.includes('windows') && !names.includes('linux'));
  const source = readFileSync(path.join(root, 'assets/lucide.min.js'));
  const context = {};
  vm.runInNewContext(source.toString(), context);
  assert.deepEqual(Object.keys(context.lucide.icons).sort(), names.map(pascal).sort());
  assert.equal(typeof context.lucide.createIcons, 'function');
  assert.ok(zlib.gzipSync(source).length < 10 * 1024, 'Only used Lucide icons should ship');
  assert.match(source.toString(), /license|ISC|Lucide/i);
});

test('publication minifies JavaScript and CSS without adding a browser decompressor', () => {
  const build = readFileSync(path.join(root, 'scripts/build-site.mjs'), 'utf8');
  const optimize = readFileSync(path.join(root, 'scripts/optimize-site.mjs'), 'utf8');
  assert.match(build, /await optimizeSite/);
  assert.match(optimize, /esbuild\.transform/);
  assert.match(optimize, /minify: true/);
  assert.doesNotMatch(readFileSync(path.join(root, 'index.html'), 'utf8'), /\.br["']|DecompressionStream/);
});
