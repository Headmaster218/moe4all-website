import { readFile, writeFile, mkdir, cp } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import hardware from '../hardware.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const releases = JSON.parse(await readFile(path.join(root, 'content/releases.json'), 'utf8'));
const benchmarks = JSON.parse(await readFile(path.join(root, 'content/benchmarks.json'), 'utf8'));
const benchmarkCatalog = benchmarks.catalog;
const gpuSpecs = JSON.parse(await readFile(path.join(root, 'content/gpu-specs.json'), 'utf8'));
const benchmarkDatasets = {};
if (benchmarkCatalog.schema !== 1 || !benchmarkCatalog.records.length || gpuSpecs.schema !== 1) throw new Error('Invalid hardware catalog schema.');
const recordIds = new Set();
for (const record of benchmarkCatalog.records) {
  if (!/^[a-z0-9-]+$/.test(record.id) || recordIds.has(record.id) || !/^[a-zA-Z0-9_/-]+\.json$/.test(record.file) || record.file.split('/').includes('..') || record.file.startsWith('/') || !['maintainer', 'community'].includes(record.origin) || !['unverified', 'reviewed', 'reproduced'].includes(record.verification) || !record.contributor?.trim()) throw new Error('Invalid benchmark catalog entry.');
  const source = new URL(record.source);
  if (source.protocol !== 'https:' || source.username || source.password) throw new Error('Invalid evidence URL.');
  recordIds.add(record.id);
  if (record.file !== 'benchmarks.json') benchmarkDatasets[record.file] = JSON.parse(await readFile(path.join(root, 'content', record.file), 'utf8'));
}
const site = JSON.parse(await readFile(path.join(root, 'content/site.json'), 'utf8'));
const demo = JSON.parse(await readFile(path.join(root, 'content/demo.json'), 'utf8'));
if (site.schema !== 1 || demo.schema !== 1 || demo.fictional !== true || [site.engineRepository, site.agentRepository].some(repository => !/^[\w.-]+\/[\w.-]+$/.test(repository))) throw new Error('Invalid site or demo content.');
if (releases.schema !== 1 || benchmarks.schema !== 1) throw new Error('Unsupported content schema.');
if (benchmarks.metric !== 'mean_aggregate_decode_tokens_per_second') throw new Error('Unexpected benchmark metric.');
for (const dataset of [benchmarks, ...Object.values(benchmarkDatasets)]) {
if (dataset.schema !== 1 || dataset.metric !== benchmarks.metric || !dataset.hardware?.gpu || !dataset.hardware?.os || ![dataset.hardware.vramBudgetGiB, dataset.hardware.ramBudgetGiB].every(value => Number.isFinite(value) && value > 0) || !dataset.models?.length || !dataset.contexts?.length || !dataset.settings || !dataset.version || !dataset.measuredOn) throw new Error('Invalid benchmark dataset.');
for (const model of dataset.models) {
  if (!model.id || !model.quantization || !model.name) throw new Error('Missing model identity or quantization.');
  for (const context of dataset.contexts) {
    const result = model.results[context];
    if (!result) continue;
    const values = result.prefill === undefined ? result.decode : [...result.decode, result.prefill];
    if (result.decode.length !== 3 || values.some(value => !Number.isFinite(value) || value <= 0)) throw new Error(`Invalid benchmark data: ${model.id}/${context}`);
  }
}
}
for (const gpu of gpuSpecs.gpus) {
  if (!gpu.name || !['amd', 'nvidia', 'intel'].includes(gpu.vendor) || typeof gpu.architecture !== 'string' || [gpu.vramGiB, gpu.fp32Tflops, gpu.bandwidthGBs].some(value => !Number.isFinite(value) || value <= 0)) throw new Error(`Invalid GPU specification: ${gpu.name}`);
}
if (hardware.estimatableGpus(gpuSpecs.gpus).length !== gpuSpecs.gpus.length) throw new Error('Duplicate or ambiguous GPU configuration.');
const data = 'window.MOE4ALL_DATA = ' + JSON.stringify({ site, releases, benchmarks, demo, benchmarkCatalog, benchmarkDatasets, gpuSpecs: { ...gpuSpecs, gpus: hardware.estimatableGpus(gpuSpecs.gpus) } }, null, 2).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029') + ';\n';
if (process.argv.includes('--preview')) {
  await writeFile(path.join(root, 'site-data.js'), data);
  console.log('Updated local site-data.js');
} else {
  const destination = path.resolve(process.env.MOE4ALL_SITE_OUTPUT || path.join(root, '_site'));
  await mkdir(destination, { recursive: true });
  for (const file of ['index.html', 'technical.html', 'styles.css', 'app.js', 'hardware.js', 'memory-model.js', 'memory.js', 'agent-showcase.css', 'agent-showcase.js', 'release-model.js', 'site-ui.js', 'analytics.js', 'everyday.html', 'everyday.css', 'everyday.js', 'demo.html', 'demo.css', 'demo.js']) await cp(path.join(root, file), path.join(destination, file));
  await cp(path.join(root, 'assets'), path.join(destination, 'assets'), { recursive: true });
  await writeFile(path.join(destination, 'site-data.js'), data);
  await writeFile(path.join(destination, '.nojekyll'), '');
  console.log(`Built ${destination} with synchronized releases and manually maintained benchmarks.`);
}
