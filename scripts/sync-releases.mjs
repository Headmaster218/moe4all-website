import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { validateReleaseEvent, validateAnnouncedRelease } from './release-event.mjs';

import releaseModel from '../release-model.js';
export const { compareVersions, selectReleases } = releaseModel;

async function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const sources = JSON.parse(await readFile(path.join(root, 'content/site.json'), 'utf8'));
  const { engineRepository, agentRepository } = sources;
  if ([engineRepository, agentRepository].some(repository => !/^[\w.-]+\/[\w.-]+$/.test(repository))) throw new Error('Invalid product repositories.');
  const notification = process.env.RELEASE_EVENT_PATH ? validateReleaseEvent(JSON.parse(await readFile(process.env.RELEASE_EVENT_PATH, 'utf8')), sources) : null;
  const fixtureArg = process.argv.indexOf('--fixture');
  let releases, agentReleases;
  if (fixtureArg !== -1) {
    const fixture = JSON.parse(await readFile(process.argv[fixtureArg + 1], 'utf8'));
    releases = Array.isArray(fixture) ? fixture : fixture.engine;
    agentReleases = Array.isArray(fixture) ? fixture : fixture.agent;
  } else {
    const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'MoE4All-website', 'X-GitHub-Api-Version': '2022-11-28' };
    if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
    async function fetchReleases(repository) {
      const items = [];
      for (let page = 1; page <= 5; page++) {
        const response = await fetch(`https://api.github.com/repos/${repository}/releases?per_page=100&page=${page}`, { headers, signal: AbortSignal.timeout(30000) });
        if (!response.ok) throw new Error(`GitHub releases for ${repository} returned HTTP ${response.status}; keeping the existing manifest.`);
        const batch = await response.json();
        if (!Array.isArray(batch)) throw new Error('Invalid GitHub release response.');
        items.push(...batch);
        if (batch.length < 100) break;
      }
      return items;
    }
    releases = await fetchReleases(engineRepository);
    agentReleases = agentRepository === engineRepository ? releases : await fetchReleases(agentRepository);
  }
  validateAnnouncedRelease(notification?.repository === agentRepository ? agentReleases : releases, notification);
  const selected = selectReleases(releases, engineRepository, { agentReleases, agentRepository });
  const destination = path.join(root, 'content', 'releases.json');
  const previous = JSON.parse(await readFile(destination, 'utf8'));
  if (JSON.stringify(previous) !== JSON.stringify(selected)) await writeFile(destination, JSON.stringify(selected, null, 2) + '\n');
  console.log(JSON.stringify({ event: notification?.action, announcedTag: notification?.tag, engine: selected.engine.version, preview: selected.enginePreview?.version, agent: selected.agent?.version, changed: JSON.stringify(previous) !== JSON.stringify(selected) }));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
