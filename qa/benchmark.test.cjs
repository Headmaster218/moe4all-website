const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const data = JSON.parse(fs.readFileSync(path.join(root, 'content/benchmarks.json'), 'utf8'));

test('Qwen 35B is first and the short-context Prefill retains every measured sample', () => {
  assert.deepEqual(data.models.map(model => model.id), ['qwen35', 'flashnext']);
  const result = data.models[0].results['2000'];
  const measurement = result.measurement.prefill;
  assert.equal(measurement.measuredRounds, 3);
  assert.equal(measurement.samples.length, 3);
  assert.equal(measurement.promptTokens, 2000);
  assert.deepEqual(measurement.cachedTokens, [0, 0, 0]);
  assert.equal(measurement.coldProcessPerRound, true);
  assert.ok(measurement.samples.every(value => Number.isFinite(value) && value > 0));
  assert.equal(measurement.mean, measurement.samples.reduce((a, b) => a + b, 0) / 3);
  assert.equal(measurement.selectedSample, 3);
  assert.equal(result.prefill, Number(measurement.samples[measurement.selectedSample - 1].toFixed(2)));
  measurement.milliseconds.forEach((ms, index) => assert.ok(Math.abs(2000 * 1000 / ms - measurement.samples[index]) < .000001));
});

test('new short-context measurements do not inherit the historical three-round Decode protocol', () => {
  const measurement = data.models[0].results['2000'].measurement;
  assert.equal(measurement.version, '1.0.1');
  assert.equal(measurement.profile, 'aggressive');
  assert.equal(measurement.decode.measuredRoundsPerConcurrency, 1);
  assert.deepEqual(measurement.decode.measuredWindow, [512, 1024]);
  assert.deepEqual(measurement.decode.promptTokensRange, [77, 92]);
  assert.equal(data.version, '0.11.0');
  for (const model of data.models) for (const context of ['30000', '150000']) assert.equal(model.results[context].measurement, undefined);
});

test('the local generated snapshot matches the canonical benchmark content', () => {
  const window = {};
  vm.runInNewContext(fs.readFileSync(path.join(root, 'site-data.js'), 'utf8'), { window });
  assert.deepEqual(JSON.parse(JSON.stringify(window.MOE4ALL_DATA.benchmarks)), data);
});

test('the shared generated snapshot includes the canonical GPU specifications and benchmark catalog', () => {
  const window = {};
  vm.runInNewContext(fs.readFileSync(path.join(root, 'site-data.js'), 'utf8'), { window });
  const { gpuSpecs, benchmarkCatalog, benchmarkDatasets } = window.MOE4ALL_DATA;
  const { estimatableGpus } = require('../hardware.js');
  const canonical = JSON.parse(fs.readFileSync(path.join(root, 'content/gpu-specs.json'), 'utf8'));
  assert.deepEqual(JSON.parse(JSON.stringify(gpuSpecs.gpus)), estimatableGpus(canonical.gpus));
  assert.ok(benchmarkCatalog.records.every(record => record.file === 'benchmarks.json' || benchmarkDatasets[record.file]));
  const html = fs.readFileSync(path.join(root, 'technical.html'), 'utf8');
  assert.ok(html.indexOf('src="site-data.js"') < html.indexOf('src="app.js"'));
});

const { gpuKey, specification, estimatableGpus, matchHardware, findRecords, measurementConditions, estimateFrom7900XTX } = require('../hardware.js');
const { hardware } = data;
const { gpus: specs } = require('../content/gpu-specs.json');

test('GPU options rank compute first, then bandwidth, capacity and deterministic names', () => {
  const common = { vendor: 'amd', architecture: 'test', vramGiB: 24, fp32Tflops: 10, bandwidthGBs: 100 };
  const rows = [
    { ...common, name: 'Newest', fp32Tflops: 5, releaseDate: '2026-01-01' },
    { ...common, name: 'Fastest', fp32Tflops: 20, releaseDate: '2020-01-01' },
    { ...common, name: 'Wider', bandwidthGBs: 200 },
    { ...common, name: 'Larger', vramGiB: 32 },
    { ...common, name: 'Tie B' },
    { ...common, name: 'Tie A' }
  ];
  assert.deepEqual(estimatableGpus(rows, 'amd').map(item => item.name), ['Fastest', 'Wider', 'Larger', 'Tie A', 'Tie B', 'Newest']);
});

test('each vendor only lists unambiguous GPUs that can produce both estimates', () => {
  const records = [{ origin: 'maintainer', verification: 'reviewed', data }];
  for (const vendor of ['amd', 'nvidia', 'intel']) {
    const options = estimatableGpus(specs, vendor);
    assert.ok(options.length > 0);
    assert.ok(options.every(item => item.vendor === vendor));
    for (const option of options) {
      const estimate = estimateFrom7900XTX({ gpu: option.name }, records, specs, data.models[0].quantization, '30000', 1);
      assert.ok(Number.isFinite(estimate.compute?.decode) && estimate.compute.decode > 0, option.name);
      assert.ok(Number.isFinite(estimate.bandwidth?.decode) && estimate.bandwidth.decode > 0, option.name);
    }
  }
  const base = { name: 'RX 7900 XTX', vendor: 'amd', architecture: 'RDNA 3', vramGiB: 24, fp32Tflops: 61.39, bandwidthGBs: 960 };
  assert.equal(estimatableGpus([base, { ...base, fp32Tflops: 1 }]).length, 0);
  for (const value of [0, null, undefined, NaN, Infinity, -1]) {
    assert.equal(estimatableGpus([{ ...base, fp32Tflops: value }]).length, 0);
    assert.equal(estimatableGpus([{ ...base, bandwidthGBs: value }]).length, 0);
  }
});

test('normalizes driver strings without confusing GPU suffixes or mobile variants', () => {
  assert.equal(gpuKey('ANGLE (AMD, AMD Radeon RX 7900 XTX (0x0000744C) Direct3D11)'), gpuKey(hardware.gpu));
  assert.equal(matchHardware({ gpu: 'RX7900XTX', vram: 16, ram: 32 }, hardware).kind, 'same');
  assert.equal(matchHardware({ gpu: 'RX 7900 XT' }, hardware, specs).kind, 'architecture');
  assert.equal(matchHardware({ gpu: 'RX 7900 XT' }, hardware), null, 'similar digits alone cannot prove architecture');
  for (const gpu of ['', 'AMD Radeon', 'RTX 4090', 'RX 7900 XTX Laptop']) assert.equal(matchHardware({ gpu }, hardware), null);
  assert.equal(matchHardware({ gpu: 'RX 7800 XT' }, hardware, specs).kind, 'architecture');
});

test('specifications require an unambiguous model', () => {
  assert.equal(specification('RX7900XTX', specs).vramGiB, 24);
  assert.equal(specification('RX 7900 XTX Laptop', specs), null);
  assert.equal(specification('unknown', specs), null);
  assert.equal(specification('RX7900XTX', [...specs, { ...specification('RX7900XTX', specs), vramGiB: 48 }]), null);

});

test('7900 XTX anchors both scenarios and scales the selected measurement without averaging', () => {
  const records = [{ id: 'maintainer', origin: 'maintainer', verification: 'reviewed', data }];
  const model = data.models[0].quantization;
  const identity = estimateFrom7900XTX({ gpu: 'RX7900XTX' }, records, specs, model, '30000', 2);
  assert.equal(identity.compute.decode, 118.34);
  assert.equal(identity.bandwidth.decode, 118.34);
  const estimate = estimateFrom7900XTX({ gpu: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 4090 (0x00002684) Direct3D11)' }, records, specs, model, '30000', 1);
  assert.equal(estimate.compute.decode, 80.49 * (82.58 / 61.4));
  assert.equal(estimate.bandwidth.decode, 80.49 * (1008 / 960));
  assert.equal(estimate.compute.prefill, 2749.06 * (82.58 / 61.4));
  assert.equal(estimateFrom7900XTX({ gpu: 'unknown' }, records, specs, model, '30000', 1).reason, 'spec');
  assert.equal(estimateFrom7900XTX({ gpu: 'RX7900XTX' }, [{ ...records[0], origin: 'community' }], specs, model, '30000', 1).reason, 'baseline');
  assert.equal(estimateFrom7900XTX({ gpu: 'RX7900XTX' }, records, specs, data.models[1].quantization, '2000', 1).reason, 'baseline');
});

test('missing bandwidth or memory never becomes zero throughput or guessed VRAM', () => {
  const gpu = { name: 'Test shared-memory GPU', architecture: 'test', vramGiB: null, fp32Tflops: 2, bandwidthGBs: null };
  assert.equal(gpu.vramGiB, null);
  const estimate = estimateFrom7900XTX({ gpu: gpu.name }, [{ origin: 'maintainer', verification: 'reviewed', data }], [...specs, gpu], data.models[0].quantization, '30000', 1);
  assert.equal(estimate.bandwidth, null);
  assert.ok(estimate.compute.decode > 0);
  assert.notEqual(gpuKey('RX 7900M'), gpuKey('RX 7900 XTX'));
  assert.notEqual(gpuKey('GeForce RTX 4090 Mobile'), gpuKey('GeForce RTX 4090'));
});

test('curated specifications distinguish memory variants', () => {
  assert.equal(new Set(specs.map(spec => gpuKey(spec.name))).size, specs.length);
  assert.equal(specification('RX 9060 XT', specs), null);
  assert.equal(specification('RX 9060 XT 8GB', specs).vramGiB, 8);
  assert.equal(specification('RX 9060 XT 16GB', specs).vramGiB, 16);
  assert.equal(specification('RTX 4060 Ti', specs), null);
  assert.equal(specification('RTX 4060 Ti 16GB', specs).vramGiB, 16);
  assert.equal(specification('Arc A770 8GB', specs).bandwidthGBs, 512);
  assert.equal(specification('Arc A770 16GB', specs).bandwidthGBs, 560);
  assert.equal(specification('RTX 5080 Ti', specs), null);
});

test('community records remain independent and exact GPUs rank above architecture references', () => {
  const community = { id: 'community', contributor: 'tester', origin: 'community', verification: 'unverified', data: { ...data, hardware: { ...hardware, gpu: 'AMD Radeon RX 7900 XT', vramBudgetGiB: 18, ramBudgetGiB: 32 } } };
  const own = { id: 'maintainer', origin: 'maintainer', verification: 'reviewed', data };
  const records = findRecords({ gpu: 'RX 7900 XT', vram: 18, ram: 32, os: 'Windows' }, [own, community], specs);
  assert.deepEqual(records.map(record => record.id), ['community', 'maintainer']);
  assert.equal(records[0].verification, 'unverified');
  assert.equal(records[0].data.hardware.vramBudgetGiB, 18);
  assert.equal(records[1].data.hardware.vramBudgetGiB, 24);
  assert.equal(findRecords({ gpu: 'RTX4090' }, [own, community], specs).length, 0);
});

test('per-result protocols override defaults without inventing missing settings', () => {
  const description = measurementConditions(data, data.models[0].results['2000'], true);
  assert.match(description, /thinking ON/);
  assert.match(description, /thinking OFF/);
  assert.match(description, /selected #3/);
  assert.match(description, /v1\.0\.1/);
  const missing = measurementConditions({ settings: {}, version: '1', measuredOn: '2026-10-16' }, {}, true);
  assert.match(missing, /KV \?/);
  assert.match(missing, /MTP \?/);
  assert.doesNotMatch(missing, /MTP OFF|Q8/);
});
