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
