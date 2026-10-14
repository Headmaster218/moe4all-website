import { readFile, writeFile, mkdir, cp } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const releases = JSON.parse(await readFile(path.join(root, 'content/releases.json'), 'utf8'));
const benchmarks = JSON.parse(await readFile(path.join(root, 'content/benchmarks.json'), 'utf8'));
const site = JSON.parse(await readFile(path.join(root, 'content/site.json'), 'utf8'));
const demo = JSON.parse(await readFile(path.join(root, 'content/demo.json'), 'utf8'));
if (site.schema !== 1 || demo.schema !== 1 || demo.fictional !== true || !/^[\w.-]+\/[\w.-]+$/.test(site.productRepository)) throw new Error('Invalid site or demo content.');
if (releases.schema !== 1 || benchmarks.schema !== 1) throw new Error('Unsupported content schema.');
if (benchmarks.metric !== 'mean_aggregate_decode_tokens_per_second') throw new Error('Unexpected benchmark metric.');
for (const model of benchmarks.models) {
  for (const context of benchmarks.contexts) {
    const result = model.results[context];
    if (!result || result.decode.length !== 3 || [...result.decode, result.prefill].some(value => !Number.isFinite(value) || value <= 0)) throw new Error(`Invalid benchmark data: ${model.id}/${context}`);
  }
}
const data = 'window.MOE4ALL_DATA = ' + JSON.stringify({ site, releases, benchmarks, demo }, null, 2).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029') + ';\n';
if (process.argv.includes('--preview')) {
  await writeFile(path.join(root, 'site-data.js'), data);
  console.log('Updated local site-data.js');
} else {
  const destination = path.join(root, '_site');
  await mkdir(destination, { recursive: true });
  for (const file of ['index.html', 'styles.css', 'app.js', 'memory-model.js', 'memory.js', 'agent-showcase.css', 'agent-showcase.js', 'site-ui.js', 'everyday.html', 'everyday.css', 'everyday.js', 'demo.html', 'demo.css', 'demo.js']) await cp(path.join(root, file), path.join(destination, file));
  await cp(path.join(root, 'assets'), path.join(destination, 'assets'), { recursive: true });
  await writeFile(path.join(destination, 'site-data.js'), data);
  await writeFile(path.join(destination, '.nojekyll'), '');
  console.log('Built _site with synchronized releases and manually maintained benchmarks.');
}
