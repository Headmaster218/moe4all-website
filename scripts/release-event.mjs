const engineTag = /^(?:release-|v)\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const agentTag = /^agent-v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

export function validateReleaseEvent(event, repository) {
  const action = event.action ?? event.event_type;
  if (!['engine-release', 'agent-release', 'product-release'].includes(action)) throw new Error('Unsupported release event.');
  const payload = event.client_payload ?? {};
  if (typeof payload !== 'object' || Array.isArray(payload)) throw new Error('Invalid release payload.');
  if (payload.repository !== undefined && payload.repository !== repository) throw new Error('Release repository does not match site configuration.');
  if ('version' in payload || 'url' in payload) throw new Error('Release notifications cannot override versions or URLs. Send the published tag instead.');
  const tag = payload.tag ?? null;
  if (action !== 'product-release' && !tag) throw new Error('Engine and Agent release events require a tag.');
  if (tag !== null) {
    if (typeof tag !== 'string' || tag.length > 128) throw new Error('Invalid release tag.');
    const matches = action === 'engine-release' ? engineTag.test(tag) : action === 'agent-release' ? agentTag.test(tag) : engineTag.test(tag) || agentTag.test(tag);
    if (!matches) throw new Error('Release tag does not match its component.');
  }
  return { action, repository, tag };
}

export function validateAnnouncedRelease(releases, notification) {
  if (!notification?.tag) return;
  const release = releases.find(item => item.tag_name === notification.tag);
  if (!release || release.draft || !release.published_at || !release.html_url?.startsWith(`https://github.com/${notification.repository}/releases/tag/`) || !release.assets?.some(asset => asset.state === 'uploaded' && asset.size > 0 && !/\.(?:sha256|txt)$/i.test(asset.name))) throw new Error('Announced release is not published with downloadable assets yet; keeping the existing manifest.');
}
