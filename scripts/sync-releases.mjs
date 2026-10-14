import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { validateReleaseEvent, validateAnnouncedRelease } from './release-event.mjs';

export function compareVersions(left, right) {
  const parse = value => {
    const [core, suffix] = value.split(/-(.*)/s);
    return { core: core.split('.').map(Number), suffix };
  };
  const a = parse(left), b = parse(right);
  for (let i = 0; i < 3; i++) if (a.core[i] !== b.core[i]) return a.core[i] - b.core[i];
  if (!a.suffix || !b.suffix) return a.suffix ? -1 : b.suffix ? 1 : 0;
  const aa = a.suffix.split('.'), bb = b.suffix.split('.');
  for (let i = 0; i < Math.max(aa.length, bb.length); i++) {
    if (aa[i] === bb[i]) continue;
    if (aa[i] === undefined) return -1;
    if (bb[i] === undefined) return 1;
    const an = /^\d+$/.test(aa[i]), bn = /^\d+$/.test(bb[i]);
    if (an && bn) return Number(aa[i]) - Number(bb[i]);
    if (an !== bn) return an ? -1 : 1;
    return aa[i].localeCompare(bb[i]);
  }
  return 0;
}

export function selectReleases(releases, repository = 'Headmaster218/MoE4All') {
  const eligible = releases.filter(release => !release.draft && release.published_at && release.html_url?.startsWith(`https://github.com/${repository}/releases/tag/`) && release.assets?.some(asset => asset.state === 'uploaded' && asset.size > 0 && !/\.(?:sha256|txt)$/i.test(asset.name)));
  const pick = (pattern, prerelease) => eligible.filter(release => pattern.test(release.tag_name) && (prerelease === undefined || release.prerelease === prerelease)).map(release => ({ version: release.tag_name.match(pattern)[1], tag: release.tag_name, url: release.html_url, prerelease: release.prerelease, publishedAt: release.published_at })).sort((a, b) => compareVersions(b.version, a.version) || b.publishedAt.localeCompare(a.publishedAt))[0] ?? null;
  const engine = pick(/^(?:release-|v)(\d+\.\d+\.\d+)$/, false);
  if (!engine) throw new Error('No uploaded stable Engine release found; keeping the existing manifest.');
  const preview = pick(/^(?:release-|v)(\d+\.\d+\.\d+-[0-9A-Za-z.-]+)$/, true);
  return { schema: 1, engine, enginePreview: preview && compareVersions(preview.version, engine.version) > 0 ? preview : null, agent: pick(/^agent-v(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/) };
}

async function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const { productRepository } = JSON.parse(await readFile(path.join(root, 'content/site.json'), 'utf8'));
  if (!/^[\w.-]+\/[\w.-]+$/.test(productRepository)) throw new Error('Invalid product repository.');
  const notification = process.env.RELEASE_EVENT_PATH ? validateReleaseEvent(JSON.parse(await readFile(process.env.RELEASE_EVENT_PATH, 'utf8')), productRepository) : null;
  const fixtureArg = process.argv.indexOf('--fixture');
  let releases;
  if (fixtureArg !== -1) {
    releases = JSON.parse(await readFile(process.argv[fixtureArg + 1], 'utf8'));
  } else {
    const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'MoE4All-website', 'X-GitHub-Api-Version': '2022-11-28' };
    if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
    releases = [];
    for (let page = 1; page <= 5; page++) {
      const response = await fetch(`https://api.github.com/repos/${productRepository}/releases?per_page=100&page=${page}`, { headers, signal: AbortSignal.timeout(30000) });
      if (!response.ok) throw new Error(`GitHub releases returned HTTP ${response.status}; keeping the existing manifest.`);
      const batch = await response.json();
      if (!Array.isArray(batch)) throw new Error('Invalid GitHub release response.');
      releases.push(...batch);
      if (batch.length < 100) break;
    }
  }
  validateAnnouncedRelease(releases, notification);
  const selected = selectReleases(releases, productRepository);
  const destination = path.join(root, 'content', 'releases.json');
  const previous = JSON.parse(await readFile(destination, 'utf8'));
  if (JSON.stringify(previous) !== JSON.stringify(selected)) await writeFile(destination, JSON.stringify(selected, null, 2) + '\n');
  console.log(JSON.stringify({ event: notification?.action, announcedTag: notification?.tag, engine: selected.engine.version, preview: selected.enginePreview?.version, agent: selected.agent?.version, changed: JSON.stringify(previous) !== JSON.stringify(selected) }));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
