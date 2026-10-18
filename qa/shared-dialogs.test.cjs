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
