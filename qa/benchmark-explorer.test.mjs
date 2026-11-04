import test from 'node:test';
import assert from 'node:assert/strict';
import { modelKey, modelOptions, filterRows, resultPage, gpuGroups, gpuGroup, engineBudget, rowConcurrency } from '../community/ui-model.mjs';

test('filename and extension-free model reports share one option and retain every result', () => {
  const name = 'Qwen3.6-35B-A3B-APEX-I-Balanced';
  const rows = [
    { id: 'name', model: name, quant: 'APEX-I-Balanced' },
    { id: 'filename', model: name + '.gguf', quant: null },
    { id: 'upper-extension', model: name + '.GGUF', quant: 'F32 + Q5_K + Q6_K + Q8_0' },
    { id: 'different-quant', model: 'Qwen3.6-35B-A3B-Q8_0.gguf' },
    { id: 'different-revision', model: name + '-V2.gguf' }
  ];
  assert.equal(modelOptions(rows).length, 3);
  assert.deepEqual(modelOptions(rows).find(([key]) => key === name), [name, name]);
  for (const selected of [name, name + '.gguf']) {
    assert.deepEqual(filterRows(rows, { model: [selected] }).map(row => row.id), ['name', 'filename', 'upper-extension']);
  }
  assert.equal(rows[1].model, name + '.gguf');
  assert.equal(rows[2].quant, 'F32 + Q5_K + Q6_K + Q8_0');
  assert.notEqual(modelKey('model-Q4_K.gguf'), modelKey('model-Q8_0.gguf'));
  assert.notEqual(modelKey('model-00001-of-00002.gguf'), modelKey('model.gguf'));
});

test('grouped model filtering still composes with hardware and measurement conditions', () => {
  const rows = [
    { id: 'a', model: 'model-Q4.gguf', gpu: 'GPU A', context: 2048 },
    { id: 'b', model: 'model-Q4', gpu: 'GPU B', context: 8192 },
    { id: 'c', model: 'model-Q8.gguf', gpu: 'GPU A', context: 2048 }
  ];
  assert.deepEqual(filterRows(rows, { model: ['model-Q4'], gpu: ['GPU B'], contextMode: 'range', contextMin: 4096 }).map(row => row.id), ['b']);
  assert.deepEqual(filterRows(rows, { model: ['model-Q4', 'model-Q8'] }).map(row => row.id), ['a', 'b', 'c']);
});

test('25-result pages cover all rows once and clamp after a filter shrinks results', () => {
  const rows = Array.from({ length: 51 }, (_, id) => ({ id }));
  const pages = [1, 2, 3].map(page => resultPage(rows, page));
  assert.deepEqual(pages.map(page => page.rows.length), [25, 25, 1]);
  assert.deepEqual(pages.flatMap(page => page.rows), rows);
  assert.deepEqual(pages.map(page => [page.offset, page.end]), [[0, 25], [25, 50], [50, 51]]);
  assert.equal(pages[0].hasPrevious, false);
  assert.equal(pages[1].hasNext, true);
  assert.equal(pages[2].hasNext, false);
  assert.equal(resultPage(rows.slice(0, 7), 3).pageNumber, 1);
  assert.deepEqual(resultPage([], 9), { pageNumber: 1, offset: 0, rows: [], end: 0, hasPrevious: false, hasNext: false });
});

test('GPU vendor groups preserve filter values and keep Apple and unknown devices in Other', () => {
  const names = ['AMD Radeon RX 7900 XTX', 'Radeon(TM) Graphics', 'NVIDIA GeForce RTX 4090', 'Intel(R) Arc(TM) A770 Graphics', 'Apple M4 Max', '未提供 GPU 型号'];
  const groups = gpuGroups(names.map(name => [name, name]));
  assert.deepEqual(groups.map(group => group.id), ['amd', 'nvidia', 'intel', 'other']);
  assert.deepEqual(groups.map(group => group.options.length), [2, 1, 1, 2]);
  assert.deepEqual(groups.flatMap(group => group.options).map(([key]) => key).sort(), [...names].sort());
  assert.equal(gpuGroup('Arc A770'), 'intel');
  assert.equal(gpuGroup('Apple M4 Max'), 'other');
  assert.equal(gpuGroup(null), 'other');
  const rows = names.map((gpu, id) => ({ id, gpu, model: 'model.gguf' }));
  assert.deepEqual(filterRows(rows, { gpu: [groups[0].options[0][0]] }).map(row => row.gpu), [names[0]]);
});

test('engine budgets distinguish resolved targets/ceilings, configured values and missing data', () => {
  const GiB = 1073741824;
  const row = { ram_bytes: 96 * GiB, vram_bytes: 24 * GiB, actual_ram_budget: 32 * GiB, actual_vram_budget: 20 * GiB, ram_budget: '80%', vram_budget: '90%' };
  assert.deepEqual(engineBudget(row), { ram: { bytes: 32 * GiB, text: null, kind: 'target' }, vram: { bytes: 20 * GiB, text: null, kind: 'ceiling' } });
  assert.deepEqual(engineBudget({ ram_budget: '75%', vram_budget: String(8 * GiB) }), { ram: { bytes: null, text: '75%', kind: 'configured' }, vram: { bytes: 8 * GiB, text: null, kind: 'configured' } });
  assert.deepEqual(engineBudget({ ram_bytes: 96 * GiB, vram_bytes: 24 * GiB }), { ram: { bytes: null, text: null, kind: 'missing' }, vram: { bytes: null, text: null, kind: 'missing' } });
  assert.equal(engineBudget({ actual_ram_budget: 0 }).ram.bytes, 0);
  assert.equal(engineBudget({ actual_ram_budget: -1 }).ram.kind, 'missing');
});

test('concurrency is explicit for decode and never copied into a Prefill measurement', () => {
  assert.equal(rowConcurrency({ kind: 'decode', slots: 4 }), 4);
  assert.equal(rowConcurrency({ kind: 'manual_decode', slots: 2 }), 2);
  assert.equal(rowConcurrency({ kind: 'prefill', slots: 4, setup_slots: 4 }), null);
  assert.equal(rowConcurrency({ kind: 'manual_prefill', slots: 4 }), null);
  assert.equal(rowConcurrency({ kind: 'decode', slots: null }), null);
});

test('legacy Rust budget values display known bytes and missing options without Debug wrappers', () => {
  const missing = { bytes: null, text: null, kind: 'missing' };
  for (const value of ['None', 'Some(None)', 'Some(Some(None))', '  Some( None )  ']) {
    assert.deepEqual(engineBudget({ ram_budget: value }).ram, missing);
  }
  assert.deepEqual(engineBudget({ ram_budget: 'Some(Bytes(17179869184))' }).ram, { bytes: 17179869184, text: null, kind: 'configured' });
  assert.deepEqual(engineBudget({ ram_budget: 'Some(FrozenAutomaticBytes(54668058624))' }).ram, { bytes: 54668058624, text: null, kind: 'configured' });
  assert.deepEqual(engineBudget({ vram_budget: 'Bytes(0)' }).vram, { bytes: 0, text: null, kind: 'configured' });
  assert.deepEqual(engineBudget({ ram_budget: '48g', vram_budget: '24g' }), { ram: { bytes: 48 * 1073741824, text: null, kind: 'configured' }, vram: { bytes: 24 * 1073741824, text: null, kind: 'configured' } });
  assert.equal(engineBudget({ ram_budget: '1.5GiB' }).ram.bytes, 1610612736);
  assert.deepEqual(engineBudget({ ram_budget: 'Some(Percent(0.8))' }).ram, { bytes: null, text: '80%', kind: 'configured' });
  assert.equal(engineBudget({ vram_budget: 'Some(Percent(1.25))' }).vram.text, '125%');
  assert.equal(engineBudget({ ram_budget: 'Some(Percent(1e-3))' }).ram.text, '0.1%');
  // A resolved budget remains authoritative, even if the old text says None.
  assert.equal(engineBudget({ actual_ram_budget: 1073741824, ram_budget: 'None' }).ram.bytes, 1073741824);
});

test('invalid or unknown legacy budget values remain configuration text, without unsafe numeric coercion', () => {
  for (const value of ['Some(Bytes(9007199254740992))', 'Some(Bytes(-1))', 'Some(Percent(NaN))', 'Some(Percent(1e309))', 'Some(Percent(-0.8))', '48kg', 'Some(Custom(<img src=x>))']) {
    assert.deepEqual(engineBudget({ ram_budget: value }).ram, { bytes: null, text: value, kind: 'configured' });
  }
});
