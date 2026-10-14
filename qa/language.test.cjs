const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../site-ui.js'), 'utf8');

function load(navigator = {}, saved = null, blocked = false) {
  const writes = [];
  const window = {
    MoeReleaseModel: require('../release-model.js'),
    MOE4ALL_DATA: { site: {}, releases: {} }
  };
  vm.runInNewContext(source, {
    window, navigator, document: { querySelectorAll: () => [] },
    location: { protocol: 'file:' }, addEventListener() {},
    localStorage: {
      getItem() { if (blocked) throw new Error('Storage denied'); return saved; },
      setItem(key, value) { if (blocked) throw new Error('Storage denied'); writes.push([key, value]); }
    }
  });
  return { site: window.MoeSite, writes };
}

test('Chinese language variants use Chinese; all other languages use English', () => {
  for (const locale of ['zh', 'zh-CN', 'zh-TW', 'zh-Hant', 'ZH-HK']) {
    assert.equal(load({ languages: [locale] }).site.getPreferredLanguage(), 'zh');
  }
  for (const locale of ['en-US', 'de-DE', 'ja-JP', 'zhang']) {
    assert.equal(load({ languages: [locale] }).site.getPreferredLanguage(), 'en');
  }
});

test('uses the first preferred browser language, then navigator.language', () => {
  assert.equal(load({ languages: ['en-US', 'zh-CN'], language: 'zh-CN' }).site.getPreferredLanguage(), 'en');
  assert.equal(load({ languages: [], language: 'zh-CN' }).site.getPreferredLanguage(), 'zh');
  assert.equal(load().site.getPreferredLanguage(), 'en');
});

test('manual preference wins, invalid preference is ignored, detection is not persisted', () => {
  assert.equal(load({ language: 'en' }, 'zh').site.getPreferredLanguage(), 'zh');
  assert.equal(load({ language: 'zh' }, 'en').site.getPreferredLanguage(), 'en');
  const { site, writes } = load({ language: 'zh' }, 'invalid');
  assert.equal(site.getPreferredLanguage(), 'zh');
  assert.deepEqual(writes, []);
  site.rememberLanguage('en');
  site.rememberLanguage('invalid');
  assert.deepEqual(writes, [['moe4all-language', 'en']]);
});

test('blocked storage cannot break automatic detection or manual switching', () => {
  const { site } = load({ language: 'zh-TW' }, null, true);
  assert.equal(site.getPreferredLanguage(), 'zh');
  assert.doesNotThrow(() => site.rememberLanguage('en'));
});
