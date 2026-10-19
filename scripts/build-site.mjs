import { readFile, writeFile, mkdir, cp } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { optimizeSite } from './optimize-site.mjs';
import { readSnapshot, writeIndexArtifacts } from './build-leaderboard.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const releases = JSON.parse(await readFile(path.join(root, 'content/releases.json'), 'utf8'));
const benchmarks = JSON.parse(await readFile(path.join(root, 'content/benchmarks.json'), 'utf8'));
const site = JSON.parse(await readFile(path.join(root, 'content/site.json'), 'utf8'));
const demo = JSON.parse(await readFile(path.join(root, 'content/demo.json'), 'utf8'));
if (site.schema !== 1 || demo.schema !== 1 || demo.fictional !== true || [site.engineRepository, site.agentRepository].some(repository => !/^[\w.-]+\/[\w.-]+$/.test(repository))) throw new Error('Invalid site or demo content.');
if (releases.schema !== 1 || benchmarks.schema !== 1) throw new Error('Unsupported content schema.');
if (benchmarks.metric !== 'mean_aggregate_decode_tokens_per_second') throw new Error('Unexpected benchmark metric.');
for (const model of benchmarks.models) {
  for (const context of benchmarks.contexts) {
    const result = model.results[context];
    if (!result) continue;
    const values = result.prefill === undefined ? result.decode : [...result.decode, result.prefill];
    if (result.decode.length !== 3 || values.some(value => !Number.isFinite(value) || value <= 0)) throw new Error(`Invalid benchmark data: ${model.id}/${context}`);
  }
}
const data = 'window.MOE4ALL_DATA = ' + JSON.stringify({ site, releases, benchmarks, demo }, null, 2).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029') + ';\n';
if (process.argv.includes('--preview')) {
  await writeFile(path.join(root, 'site-data.js'), data);
  console.log('Updated local site-data.js');
} else {
  const destination = path.resolve(process.env.MOE4ALL_SITE_OUTPUT || path.join(root, '_site'));
  await mkdir(destination, { recursive: true });
  const files = ['index.html', 'technical.html', 'styles.css', 'app.js', 'memory-model.js', 'memory.js', 'agent-showcase.css', 'agent-showcase.js', 'release-model.js', 'site-ui.js', 'site-dialogs.js', 'site-dialogs.css', 'analytics.js', 'media.js', 'everyday.html', 'everyday.css', 'everyday.js', 'demo.html', 'demo.css', 'demo.js'];
  for (const file of files) await cp(path.join(root, file), path.join(destination, file));
  const communityFiles = ['index.html', 'upload.html', 'app.mjs', 'ui-model.mjs', 'leaderboard-model.mjs', 'leaderboard-loader.mjs', 'submission-limits.mjs', 'submission-codec.mjs', 'styles.css', 'config.js', 'vendor/gzip.mjs', 'vendor/pako-LICENSE', 'vendor/pako-ZLIB-LICENSE'];
  for (const file of communityFiles) {
    await mkdir(path.dirname(path.join(destination, 'community', file)), { recursive: true });
    await cp(path.join(root, 'community', file), path.join(destination, 'community', file));
  }
  const leaderboard = await readSnapshot(path.join(root, 'content/leaderboard/snapshot.json'));
  if (leaderboard.index.source && leaderboard.index.source.repository !== site.engineRepository) throw new Error('Unexpected leaderboard source repository');
  await writeIndexArtifacts(path.join(destination, 'community/data'), leaderboard);
  await cp(path.join(root, 'assets'), path.join(destination, 'assets'), { recursive: true });
  await writeFile(path.join(destination, 'site-data.js'), data);
  const icons = await optimizeSite(root, destination, [...files.filter(file => /\.(?:js|css)$/.test(file)), 'site-data.js', ...communityFiles.filter(file => /\.(?:mjs|js|css)$/.test(file)).map(file => 'community/' + file)], { community: true });
  await writeFile(path.join(destination, '.nojekyll'), '');
  console.log(`Built ${destination}: minified JS/CSS, ${icons.names.length} Lucide icons (${icons.bytes} bytes), synchronized releases and manually maintained benchmarks.`);
}
