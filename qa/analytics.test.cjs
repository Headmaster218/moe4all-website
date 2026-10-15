const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'analytics.js'), 'utf8');

function run(protocol, hostname, embedded = false) {
  const appended = [], window = {};
  window.self = window;
  window.top = embedded ? {} : window;
  vm.runInNewContext(source, {
    window, location: { protocol, hostname },
    document: {
      createElement: tag => ({ tag, dataset: {} }),
      body: { append: script => appended.push(script) }
    }
  });
  return appended;
}

test('loads the provided module beacon once on the production hostname', () => {
  const [script, ...rest] = run('https:', 'headmaster218.github.io');
  assert.equal(rest.length, 0);
  assert.equal(script.tag, 'script');
  assert.equal(script.type, 'module');
  assert.equal(script.src, 'https://static.cloudflareinsights.com/beacon.min.js');
  assert.deepEqual(JSON.parse(script.dataset.cfBeacon), { token: '018ded73fd29484c99e6b72140098d8e' });
});

test('does not send analytics from previews, local files or embedded pages', () => {
  for (const args of [['file:', ''], ['http:', 'localhost'], ['https:', 'moe4all.test'], ['http:', 'headmaster218.github.io'], ['https:', 'headmaster218.github.io', true]]) {
    assert.equal(run(...args).length, 0);
  }
});

test('only real pages include analytics and disclose it in both languages', () => {
  for (const file of ['index.html', 'technical.html']) {
    const html = fs.readFileSync(path.join(root, file), 'utf8');
    assert.equal((html.match(/src="analytics.js"/g) || []).length, 1);
    assert.match(html, /data-analytics-notice data-en="Website visits are measured by Cloudflare Web Analytics/);
  }
  for (const file of ['demo.html', 'everyday.html']) {
    assert.doesNotMatch(fs.readFileSync(path.join(root, file), 'utf8'), /analytics.js|cloudflareinsights/);
  }
  assert.match(fs.readFileSync(path.join(root, 'scripts/build-site.mjs'), 'utf8'), /'analytics.js'/);
});
