import test from 'node:test';
import assert from 'node:assert/strict';
import { modelKey, modelOptions, filterRows, resultPage } from '../community/ui-model.mjs';

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
