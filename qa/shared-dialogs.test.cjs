const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const root = path.resolve(__dirname, '..');
const site = JSON.parse(fs.readFileSync(path.join(root, 'content/site.json'), 'utf8'));

test('both pages use one shared dialog implementation without eager QR images', () => {
  for (const file of ['index.html', 'technical.html']) {
    const html = fs.readFileSync(path.join(root, file), 'utf8');
    assert.ok(html.includes('src="site-dialogs.js"'));
    assert.ok(html.includes('href="site-dialogs.css"'));
    assert.ok(!html.includes('id="download-dialog"'));
    assert.ok(!html.includes('src="assets/wechat-'));
    assert.ok(html.includes('data-contact'));
    assert.ok(html.includes('data-support'));
    assert.ok(html.includes('>Apple</span>'));
  }
  const bytes = ['site-dialogs.js', 'site-dialogs.css'].reduce((n, file) => n + zlib.gzipSync(fs.readFileSync(path.join(root, file))).length, 0);
  assert.ok(bytes < 10 * 1024, 'Shared dialogs must remain lightweight');
});

test('contact destinations are maintained explicitly, not invented social profile IDs', () => {
  assert.equal(site.contact.bilibili, 'https://space.bilibili.com/437077277');
  assert.equal(site.contact.buyMeACoffee, 'https://buymeacoffee.com/headmaster218');
  const douyin = new URL(site.contact.douyinSearch);
  assert.equal(douyin.hostname, 'www.douyin.com');
  assert.equal(decodeURIComponent(douyin.pathname), '/search/' + site.contact.douyinHandle);
  assert.equal(site.contact.instagram, undefined);
  for (const key of ['wechatImage', 'supportImage']) {
    const data = fs.readFileSync(path.join(root, site.contact[key]));
    assert.ok(data.length < 100 * 1024);
  }
});

test('the public audio section links to the audio project rather than Agent downloads', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const audio = html.slice(html.indexOf('<section class="future-section'), html.indexOf('<section class="closing-section'));
  assert.ok(audio.includes('https://github.com/Headmaster218/long-audio-backend'));
  assert.ok(!audio.includes('data-agent-download'));
});

test('both QR images use compact WebP assets and matching download filenames', () => {
  const previewData = fs.readFileSync(path.join(root, 'site-data.js'), 'utf8');
  for (const [key, name, ceiling] of [['wechatImage', 'wechat-contact', 27 * 1024], ['supportImage', 'wechat-support', 12 * 1024]]) {
    const file = `assets/${name}.webp`;
    assert.equal(site.contact[key], file);
    assert.ok(previewData.includes(`"${key}": "${file}"`));
    const bytes = fs.readFileSync(path.join(root, file));
    assert.equal(bytes.toString('ascii', 0, 4), 'RIFF');
    assert.equal(bytes.toString('ascii', 8, 12), 'WEBP');
    assert.ok(bytes.length < ceiling);
  }
  const script = fs.readFileSync(path.join(root, 'site-dialogs.js'), 'utf8');
  assert.ok(script.includes('"MoE4All-WeChat.webp"'));
  assert.ok(script.includes('"MoE4All-Support.webp"'));
  assert.ok(!script.includes('MoE4All-WeChat.png'));
});

test('installation destinations are explicit and no unverified app-install protocol is advertised', () => {
  assert.equal(site.pluginInstall.repository, 'Headmaster218/dsh-llm-moe4all');
  assert.equal(site.pluginInstall.catalog, 'https://awesome-dsh-plugin.com/p/Headmaster218/dsh-llm-moe4all/');
  assert.equal(site.pluginInstall.community, 'https://www.dsh.so/artifact/dsh-llm-moe4all/');
  const js = fs.readFileSync(path.join(root, 'site-dialogs.js'), 'utf8');
  assert.ok(!js.includes('download-architecture'));
  assert.ok(!js.includes('dsh://'));
  assert.ok(js.includes('arch: "x86_64"'));
  assert.ok(js.includes('site-install-menu'));
});

test('English navigation and corrected examples preserve their intended meaning', () => {
  for (const file of ['index.html', 'technical.html']) {
    const html = fs.readFileSync(path.join(root, file), 'utf8');
    assert.ok(html.includes('data-support data-en="Support us"'));
    assert.ok(!html.includes('data-en="Support"'));
  }
  const technical = fs.readFileSync(path.join(root, 'technical.html'), 'utf8');
  assert.ok(technical.includes('href="index.html" data-en="Home"'));
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  assert.ok(html.includes('Can I use it without knowing how to code?'));
  assert.ok(html.includes('data-en="Yes. Everyday use'));
  const demo = JSON.parse(fs.readFileSync(path.join(root, 'content/demo.json'), 'utf8'));
  assert.ok(demo.future.question.en.includes('meeting materials'));
  assert.ok(demo.future.answer.en.includes('materials'));
});

function renderMacDownload(names, lang = 'en') {
  const vm = require('node:vm');
  const { downloadFor } = require('../release-model.js');
  const repository = site.engineRepository, tag = 'release-1.0.3';
  const release = { version: '1.0.3', tag, url: `https://github.com/${repository}/releases/tag/${tag}`, assets: names.map(name => ({ name, size: 1024, url: `https://github.com/${repository}/releases/download/${tag}/${name}` })) };
  const listeners = {}, dialogs = [];
  const document = {
    currentScript: { src: 'https://moe4all.test/site-dialogs.js' }, documentElement: { lang },
    querySelector: () => null, querySelectorAll: () => [],
    body: { append: dialog => dialogs.push(dialog), classList: { add() {} } },
    addEventListener: (name, listener) => { listeners[name] = listener; },
    createElement: () => ({ open: false, addEventListener() {}, setAttribute() {}, showModal() { this.open = true; } })
  };
  const window = {
    MOE4ALL_DATA: { site, releases: { engine: release } },
    MoeSite: { getPlatform: () => ({ os: 'macos', arch: 'unknown' }), getDownload: (kind, platform) => downloadFor(kind === 'engine' ? release : null, repository, platform) },
    addEventListener() {}
  };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'site-dialogs.js'), 'utf8'), { window, document, URL, MutationObserver: class { observe() {} } });
  listeners.DOMContentLoaded();
  listeners.click({ target: { closest: () => ({ hasAttribute: name => name === 'data-download' }) }, button: 0, preventDefault() {} });
  const html = dialogs.find(dialog => dialog.id === 'download-dialog').innerHTML;
  assert.ok(html.includes('data-system="macos" aria-pressed="true"'));
  return html.match(/<article[^>]*data-product="engine">.*?<\/article>/s)[0];
}

test('macOS downloads expose ARM and Intel packages explicitly instead of assuming x86_64', () => {
  const arm = 'MoE4All-macOS-arm64-v1.0.3.tar.gz', intel = 'MoE4All-macOS-x86_64-v1.0.3.tar.gz';
  for (const [names, labels] of [[[arm], ['Apple Silicon']], [[intel], ['Intel Mac']], [[arm, intel], ['Apple Silicon', 'Intel Mac']]]) {
    const html = renderMacDownload(names);
    for (const name of names) assert.ok(html.includes(name));
    for (const label of labels) assert.ok(html.includes(`Download for ${label}`));
    assert.equal((html.match(/data-direct="true"/g) || []).length, names.length);
    assert.ok(!html.includes('No package for this operating system'));
  }
  assert.ok(renderMacDownload([arm], 'zh').includes('下载 Apple Silicon 版'));
});

test('macOS universal packages need no CPU guess and missing packages still fall back to Releases', () => {
  const universal = 'MoE4All-macOS-universal-v1.0.3.dmg';
  const html = renderMacDownload([universal, 'MoE4All-macOS-arm64-v1.0.3.tar.gz']);
  assert.ok(html.includes(universal));
  assert.ok(html.includes('Download for macOS (Universal)'));
  assert.equal((html.match(/data-direct="true"/g) || []).length, 1);
  const missing = renderMacDownload([]);
  assert.ok(missing.includes('data-direct="false"'));
  assert.ok(missing.includes('No package for this operating system'));
});
