const { test } = require('node:test');
const assert = require('node:assert/strict');
const { detectPlatform, downloadFor, selectReleases } = require('../release-model.js');
const repository = 'Headmaster218/MoE4All-Agent';
const tag = 'agent-v1.0.0';
const asset = name => ({ name, size: 1024, state: 'uploaded', url: 'https://api.github.com/repos/' + repository + '/releases/assets/1', browser_download_url: `https://github.com/${repository}/releases/download/${tag}/${name}` });
const item = assets => selectReleases([{ tag_name: 'release-1.0.0', html_url: 'https://github.com/Headmaster218/MoE4All/releases/tag/release-1.0.0', published_at: '2026-10-15', prerelease: false, assets: [] }], 'Headmaster218/MoE4All', { agentRepository: repository, agentReleases: [{ tag_name: tag, html_url: `https://github.com/${repository}/releases/tag/${tag}`, published_at: '2026-10-15', prerelease: false, assets }] }).agent;

test('detects Windows, Linux, macOS and mobile without assuming mobile is desktop', () => {
  assert.deepEqual(detectPlatform({ platform: 'Win32', userAgent: 'Windows NT 10.0; Win64; x64' }), { os: 'windows', arch: 'x86_64' });
  assert.deepEqual(detectPlatform({ platform: 'Linux aarch64' }), { os: 'linux', arch: 'arm64' });
  assert.deepEqual(detectPlatform({ platform: 'Linux x86_64' }), { os: 'linux', arch: 'x86_64' });
  assert.equal(detectPlatform({ platform: 'MacIntel' }).os, 'macos');
  assert.equal(detectPlatform({ platform: 'MacIntel', maxTouchPoints: 5 }).os, 'unknown');
  assert.equal(detectPlatform({ userAgent: 'Android Linux' }).os, 'unknown');
});

test('selects the matching uploaded Windows and Linux packages', () => {
  const release = item([asset('MoE4All-Agent-Windows-x86_64-v1.0.0.zip'), asset('MoE4All-Agent-Linux-x86_64-v1.0.0.tar.gz'), asset('MoE4All-Agent-Linux-arm64-v1.0.0.tar.gz')]);
  for (const [os, arch, suffix] of [['windows', 'x86_64', '.zip'], ['linux', 'x86_64', '.tar.gz'], ['linux', 'arm64', '.tar.gz']]) {
    const result = downloadFor(release, repository, { os, arch });
    assert.equal(result.direct, true);
    assert.ok(result.url.endsWith(suffix));
    assert.ok(result.asset.toLowerCase().includes(arch));
  }
});

test('does not treat checksums, sources, partial uploads or cross-repository URLs as packages', () => {
  const release = item([asset('MoE4All-Agent-Windows-x86_64.zip.sha256'), asset('MoE4All-Agent-Windows-x86_64-sources.zip'), { ...asset('MoE4All-Agent-Windows-x86_64.zip'), state: 'starter' }, { ...asset('MoE4All-Agent-Windows-x86_64.exe'), browser_download_url: 'https://evil.example/app.exe' }, { ...asset('MoE4All-Agent-Windows-x86_64.msi'), browser_download_url: 'https://github.com/someone/other/releases/download/agent-v1.0.0/MoE4All-Agent-Windows-x86_64.msi' }]);
  assert.equal(downloadFor(release, repository, { os: 'windows', arch: 'x86_64' }).direct, false);
});

test('falls back to Releases for missing packages, architectures and unknown systems', () => {
  const release = item([asset('MoE4All-Agent-Windows-x86_64-v1.0.0.zip')]);
  for (const platform of [{ os: 'linux', arch: 'x86_64' }, { os: 'windows', arch: 'arm64' }, { os: 'windows', arch: 'unknown' }, { os: 'unknown', arch: 'unknown' }]) assert.equal(downloadFor(release, repository, platform).url, release.url);
  assert.equal(downloadFor(null, repository, { os: 'windows', arch: 'x86_64' }).url, `https://github.com/${repository}/releases`);
  assert.equal(downloadFor(item([]), repository, { os: 'windows', arch: 'x86_64' }).direct, false);
});

test('uses an explicit universal macOS package when architecture is unknown', () => {
  const release = item([asset('MoE4All-Agent-macOS-universal-v1.0.0.dmg')]);
  assert.equal(downloadFor(release, repository, { os: 'macos', arch: 'unknown' }).direct, true);
});

test('recognizes independent Agent release tags and prefers stable over preview', () => {
  const stable = item([]);
  assert.equal(stable.version, '1.0.0');
  assert.equal(stable.prerelease, false);
});

test('stale browser cache cannot replace newer bundled Agent metadata when the API fails', async () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const vm = require('node:vm');
  const model = require('../release-model.js');
  const bundled = { schema: 1, engine: { version: '1.0.0' }, agent: { version: '1.9.0' } };
  const stale = { time: Date.now(), releases: { ...bundled, agent: { version: '1.0.0' } } };
  const window = { MoeReleaseModel: model, MOE4ALL_DATA: { site: { engineRepository: 'Headmaster218/MoE4All', agentRepository: repository }, releases: bundled } };
  const context = { window, navigator: {}, document: { querySelectorAll: () => [] }, location: { protocol: 'https:' }, localStorage: { getItem: () => JSON.stringify(stale) }, addEventListener: () => {}, fetch: async () => ({ ok: false, status: 403 }), AbortSignal, URL, console };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../site-ui.js'), 'utf8'), context);
  await window.MoeSite.refreshReleases();
  assert.equal(window.MOE4ALL_DATA.releases.agent.version, '1.9.0');
});
