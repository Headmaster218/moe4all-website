import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareVersions, selectReleases } from '../scripts/sync-releases.mjs';

function release(tag, prerelease = false, options = {}) {
  return { tag_name: tag, draft: false, prerelease, published_at: '2026-10-13T02:00:00Z', html_url: `https://github.com/Headmaster218/MoE4All/releases/tag/${tag}`, assets: [{ name: 'package.zip', state: 'uploaded', size: 1024 }], ...options };
}

test('separates stable Engine, Engine candidate and Agent preview', () => {
  const selected = selectReleases([release('agent-v0.10.0-preview.3', true), release('release-0.11.0-rc.1', true), release('release-0.10.0'), release('release-0.9.0')]);
  assert.equal(selected.engine.version, '0.10.0');
  assert.equal(selected.enginePreview.version, '0.11.0-rc.1');
  assert.equal(selected.agent.version, '0.10.0-preview.3');
});

test('ignores drafts, uploads in progress and checksum-only releases', () => {
  const selected = selectReleases([release('release-0.11.0', false, { draft: true }), release('release-0.12.0', false, { assets: [] }), release('release-0.13.0', false, { assets: [{ name: 'package.zip', size: 0, state: 'starter' }] }), release('release-0.14.0', false, { assets: [{ name: 'package.zip.sha256', size: 64, state: 'uploaded' }] }), release('release-0.10.0')]);
  assert.equal(selected.engine.version, '0.10.0');
});

test('orders numeric versions independently of the API list order', () => {
  const selected = selectReleases([release('release-0.9.0'), release('release-0.11.0'), release('release-0.10.0'), release('agent-v0.10.0-preview.2', true), release('agent-v0.10.0-preview.10', true)]);
  assert.equal(selected.engine.version, '0.11.0');
  assert.equal(selected.agent.version, '0.10.0-preview.10');
});

test('drops a superseded Engine candidate once the stable version exists', () => {
  assert.equal(selectReleases([release('release-0.11.0'), release('release-0.11.0-rc.1', true)]).enginePreview, null);
});

test('rejects unrelated release URLs and an empty stable release set', () => {
  assert.throws(() => selectReleases([release('release-0.10.0', false, { html_url: 'https://example.com/release' })]), /No uploaded stable/);
  assert.throws(() => selectReleases([release('release-0.11.0-rc.1', true)]), /No uploaded stable/);
});

test('stable versions outrank prereleases and numeric suffixes compare numerically', () => {
  assert.ok(compareVersions('0.11.0', '0.11.0-rc.9') > 0);
  assert.ok(compareVersions('0.11.0-rc.10', '0.11.0-rc.2') > 0);
  assert.ok(compareVersions('0.11.0-rc.2', '0.11.0-rc.2.1') < 0);
});

test('reads release URLs from the configured product repository', () => {
  const repository = 'sample-org/local-ai';
  const selected = selectReleases([release('release-1.2.3', false, { html_url: `https://github.com/${repository}/releases/tag/release-1.2.3` })], repository);
  assert.equal(selected.engine.version, '1.2.3');
  assert.throws(() => selectReleases([release('release-1.2.3')], repository), /No uploaded stable/);
});
