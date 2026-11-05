const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const data = JSON.parse(fs.readFileSync(path.join(root, 'content/benchmarks.json'), 'utf8'));

test('Qwen 35B is first and the short-context Prefill retains every measured sample', () => {
  assert.deepEqual(data.models.map(model => model.id), ['qwen35', 'flashnext']);
  const result = data.models[0].results['6000'];
  const measurement = result.measurement.prefill;
  assert.equal(measurement.measuredRounds, 3);
  assert.equal(measurement.samples.length, 3);
  assert.equal(measurement.promptTokens, 8192);
  assert.deepEqual(measurement.cachedTokens, [0, 0, 0]);
  assert.equal(measurement.coldProcessPerRound, true);
  assert.ok(measurement.samples.every(value => Number.isFinite(value) && value > 0));
  assert.equal(measurement.mean, measurement.samples.reduce((a, b) => a + b, 0) / 3);
  assert.equal(measurement.selectedSample, 2);
  assert.equal(result.prefill, Number(measurement.samples[measurement.selectedSample - 1].toFixed(2)));
  measurement.milliseconds.forEach((ms, index) => assert.ok(Math.abs(8192 * 1000 / ms - measurement.samples[index]) < .000001));
});

test('new short-context measurements do not inherit the historical three-round Decode protocol', () => {
  const measurement = data.models[0].results['6000'].measurement;
  assert.equal(measurement.version, '1.0.1');
  assert.equal(measurement.profile, 'aggressive');
  assert.equal(measurement.decode.version, '1.3.0');
  assert.equal(measurement.decode.measuredRoundsPerConcurrency, 1);
  assert.equal(measurement.decode.outputTokensPerLane, 1024);
  assert.equal(measurement.decode.warmupTokensPerLane, 512);
  assert.deepEqual(measurement.decode.sectionTokens, [341, 341, 342]);
  assert.deepEqual(measurement.decode.promptTokensRange, [6144, 6144]);
  assert.equal(data.version, '0.11.0');
  for (const model of data.models) for (const context of ['30000', '150000']) assert.equal(model.results[context].measurement, undefined);
});

test('35B Decode matches the latest README through four slots without changing Prefill or FlashNext', () => {
  assert.deepEqual(data.contexts, [6000, 30000, 150000]);
  const qwen = data.models[0].results;
  assert.deepEqual(qwen['6000'].decode, [154.6, 195.3, 229.4, 248.3]);
  assert.deepEqual(qwen['30000'].decode, [125.7, 152, 180.1, 192.2]);
  assert.deepEqual(qwen['150000'].decode, [65.1, 70.5, 78, 81]);
  assert.deepEqual([qwen['6000'].prefill, qwen['30000'].prefill, qwen['150000'].prefill], [3604.71, 2749.06, 1169.4]);
  assert.deepEqual(data.models[1].results['30000'].decode, [50.44, 66.19, 71.2]);
  assert.deepEqual(data.models[1].results['150000'].decode, [44.16, 49.5, 45.47]);
  assert.deepEqual([data.models[1].results['30000'].prefill, data.models[1].results['150000'].prefill], [1414.75, 1445.5]);
});

test('the local generated snapshot matches the canonical benchmark content', () => {
  const window = {};
  vm.runInNewContext(fs.readFileSync(path.join(root, 'site-data.js'), 'utf8'), { window });
  assert.deepEqual(JSON.parse(JSON.stringify(window.MOE4ALL_DATA.benchmarks)), data);
});
