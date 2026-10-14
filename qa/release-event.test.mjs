import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateReleaseEvent, validateAnnouncedRelease } from '../scripts/release-event.mjs';
import { selectReleases } from '../scripts/sync-releases.mjs';
const repository = 'Headmaster218/MoE4All';
const event = (action, tag, extra = {}) => ({ action, client_payload: { repository, ...(tag ? { tag } : {}), ...extra } });
const release = (tag, extra = {}) => ({ tag_name: tag, draft: false, published_at: '2026-10-15T00:00:00Z', prerelease: tag.includes('-rc.') || tag.includes('-preview.'), html_url: `https://github.com/${repository}/releases/tag/${tag}`, assets: [{ name: 'package.zip', state: 'uploaded', size: 1024 }], ...extra });

test('accepts Engine stable, candidate and Agent hooks plus the legacy generic hook', () => {
  for (const [action, tag] of [['engine-release', 'release-0.11.0'], ['engine-release', 'v0.12.0-rc.1'], ['agent-release', 'agent-v0.11.0-preview.1'], ['product-release', null]]) {
    assert.deepEqual(validateReleaseEvent(event(action, tag), repository), { action, repository, tag });
  }
});
test('rejects unknown sources, mismatched components, missing tags and version injection', () => {
  for (const input of [event('unknown', 'release-0.11.0'), event('engine-release', 'agent-v0.11.0'), event('agent-release', 'release-0.11.0'), event('agent-release', null), event('engine-release', 'release-0.11.0', { repository: 'someone/other' }), event('engine-release', 'release-0.11.0', { version: '999.0.0' }), event('engine-release', 'release-0.11.0', { url: 'https://example.com' }), event('engine-release', 'release-0.11.0; echo bad')]) {
    assert.throws(() => validateReleaseEvent(input, repository));
  }
});
test('requires a real published release with uploaded downloadable assets', () => {
  const notification = validateReleaseEvent(event('engine-release', 'release-0.11.0'), repository);
  assert.doesNotThrow(() => validateAnnouncedRelease([release(notification.tag)], notification));
  for (const releases of [[], [release(notification.tag, { draft: true })], [release(notification.tag, { assets: [] })], [release(notification.tag, { assets: [{ name: 'package.sha256', state: 'uploaded', size: 64 }] })], [release(notification.tag, { html_url: 'https://example.com/release' })]]) assert.throws(() => validateAnnouncedRelease(releases, notification), /not published/);
});
test('an old notification cannot pin a version backwards or overwrite another component', () => {
  const releases = [release('release-0.10.0'), release('release-0.11.0'), release('agent-v0.11.0-preview.2')];
  validateAnnouncedRelease(releases, validateReleaseEvent(event('engine-release', 'release-0.10.0'), repository));
  const selected = selectReleases(releases, repository);
  assert.equal(selected.engine.version, '0.11.0');
  assert.equal(selected.agent.version, '0.11.0-preview.2');
});

test('routes Agent notifications only to the configured independent Agent repository', () => {
  const sources = { engineRepository: repository, agentRepository: 'Headmaster218/MoE4All-Agent' };
  const notification = validateReleaseEvent(event('agent-release', 'agent-v0.11.0-preview.1', { repository: sources.agentRepository }), sources);
  assert.equal(notification.repository, sources.agentRepository);
  assert.throws(() => validateReleaseEvent(event('agent-release', 'agent-v0.11.0-preview.1'), sources), /component/);
  assert.doesNotThrow(() => validateAnnouncedRelease([release(notification.tag, { html_url: `https://github.com/${sources.agentRepository}/releases/tag/${notification.tag}` })], notification));
  assert.throws(() => validateAnnouncedRelease([], notification), /not published/);
});
