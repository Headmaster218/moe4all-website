const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'analytics.js'), 'utf8');

function run(protocol, hostname, embedded = false, pathname = '/index.html', twice = false) {
  const appended = [], window = {};
  window.self = window;
  window.top = embedded ? {} : window;
  const context = {
    window, location: { protocol, hostname, pathname },
    document: {
      createElement: tag => ({ tag, dataset: {} }),
      body: { append: script => appended.push(script) }
    }
  };
  vm.runInNewContext(source, context);
  if (twice) vm.runInNewContext(source, context);
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

test('uses the correct token for each of the four hostname/page combinations', () => {
  for (const [hostname, token, prefix] of [
    ['moe4all.com', '7948339a80cb4efc976f546a87bcbf4b', ''],
    ['headmaster218.github.io', '018ded73fd29484c99e6b72140098d8e', '/moe4all-website']
  ]) {
    for (const page of ['/index.html', '/technical.html']) {
      const [script, ...rest] = run('https:', hostname, false, prefix + page, true);
      assert.equal(rest.length, 0);
      assert.equal(JSON.parse(script.dataset.cfBeacon).token, token);
    }
  }
  assert.equal(run('https:', 'moe4all.com', false, '/').length, 1);
  for (const page of ['/demo.html', '/everyday.html', '/unknown.html']) assert.equal(run('https:', 'moe4all.com', false, page).length, 0);
  assert.equal(run('https:', 'moe4all.com', true).length, 0);
});

test('canonical homepage paths keep queries and anchors without another navigation', () => {
  const calls = [], window = { history: { state: { saved: true }, replaceState: (...args) => calls.push(args) } };
  window.self = window; window.top = window;
  vm.runInNewContext(source, {
    window, location: { protocol: 'https:', hostname: 'moe4all.com', pathname: '/index.html', search: '?from=test', hash: '#privacy' },
    document: { createElement: () => ({ dataset: {} }), body: { append() {} } }
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0][2], '/?from=test#privacy');
  assert.equal(calls[0][0], window.history.state);
});

test('production HTTP arrivals upgrade to HTTPS before analytics, retaining the full route', () => {
  const redirects = [], appended = [], window = {};
  window.self = window; window.top = window;
  vm.runInNewContext(source, {
    window, location: { protocol: 'http:', hostname: 'moe4all.com', pathname: '/technical.html', search: '?from=github', hash: '#engine', replace: url => redirects.push(url) },
    document: { createElement: () => ({ dataset: {} }), body: { append: script => appended.push(script) } }
  });
  assert.equal(appended.length, 0);
  assert.equal(redirects[0], 'https://moe4all.com/technical.html?from=github#engine');
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
