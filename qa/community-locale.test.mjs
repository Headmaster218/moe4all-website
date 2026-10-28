import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { preferredLanguage, createLocale } from '../community/locale.mjs';

test('leaderboard shares the site language preference and handles unavailable storage', () => {
  const storage = value => ({ getItem: () => value });
  assert.equal(preferredLanguage({ language: 'en-US' }, storage('zh')), 'zh');
  assert.equal(preferredLanguage({ language: 'zh-CN' }, storage('en')), 'en');
  assert.equal(preferredLanguage({ languages: ['zh-TW'] }, storage('invalid')), 'zh');
  assert.equal(preferredLanguage({ languages: ['de-DE', 'zh-CN'] }), 'en');
  assert.equal(preferredLanguage({ language: 'en-US' }, { getItem() { throw Error('denied'); } }), 'en');
});

test('only UI template fragments are translated; interpolated data and URLs are unchanged', () => {
  let language = 'en';
  const { text, html } = createLocale(() => language);
  const name = '模型 · 完成 · 内存', url = 'https://example.com/模型';
  assert.equal(text('上下文 / 条件'), 'Context / conditions');
  assert.equal(text('RAM / VRAM 配置预算'), 'RAM / VRAM budgets');
  assert.equal(html`<p>模型 ${name}</p><a href="${url}">查看原件</a>`, `<p>Model ${name}</p><a href="${url}">View original</a>`);
  language = 'zh';
  assert.equal(html`模型 ${name}`, `模型 ${name}`);
});

test('all authored leaderboard loader errors have English translations', async () => {
  const { text } = createLocale(() => 'en');
  const source = await readFile(new URL('../community/leaderboard-loader.mjs', import.meta.url), 'utf8');
  for (const match of source.matchAll(/(?:fail|Error)\('([^']*[\p{Script=Han}][^']*)'\)/gu)) {
    assert.equal(/\p{Script=Han}/u.test(text(match[1])), false, match[1]);
  }
});

test('public brand links return to the homepage, not the current-page fragment', async () => {
  for (const name of ['index.html', 'technical.html']) {
    const source = await readFile(new URL('../' + name, import.meta.url), 'utf8');
    const brands = [...source.matchAll(/<a class="brand" href="([^"]+)"/g)];
    assert.equal(brands.length, 2);
    assert.ok(brands.every(match => match[1] === 'index.html'));
  }
  const source = await readFile(new URL('../community/app.mjs', import.meta.url), 'utf8');
  assert.match(source, /class="brand" href="\.\.\/index\.html"/);
  const build = await readFile(new URL('../scripts/build-site.mjs', import.meta.url), 'utf8');
  assert.ok(build.includes("'locale.mjs'"));
  assert.ok(!build.includes("'insights'"));
});
