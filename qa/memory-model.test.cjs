const { test } = require('node:test');
const assert = require('node:assert/strict');
const { create } = require('../memory-model.js');

test('cycles through full hits, RAM misses, SSD misses and mixed misses', () => {
  const model = create();
  for (const [mode, sources] of [['all-hit', ['vram', 'vram', 'vram', 'vram']], ['ram-miss', ['vram', 'vram', 'ram', 'ram']], ['ssd-miss', ['vram', 'vram', 'ssd', 'ssd']], ['mixed-miss', ['vram', 'vram', 'ram', 'ssd']]]) {
    const story = model.request();
    assert.equal(story.mode, mode); assert.deepEqual(story.experts.map(item => item.source), sources);
    model.dispatch(story);
    for (const item of story.experts) {
      if (item.source === 'ssd') model.fill('ram', item.id);
      if (item.source !== 'vram') model.fill('vram', item.id);
    }
  }
});

test('promotes called experts to the head and reserves red gaps until arrival', () => {
  const model = create();
  model.dispatch(model.request());
  const story = model.request(), before = [...model.caches.vram];
  const evicted = model.dispatch(story), called = story.experts.map(item => item.id);
  assert.deepEqual(evicted.vram, before.slice(-2).reverse());
  assert.deepEqual(model.caches.vram.slice(0, 4).map(item => typeof item === 'number' ? item : item.wanted), called);
  assert.equal(model.caches.vram.filter(item => typeof item !== 'number').length, 2);
  assert.throws(() => model.request(), /before its missing experts arrive/);
  for (const item of story.experts.filter(item => item.source === 'ram')) model.fill('vram', item.id);
  assert.deepEqual(model.caches.vram.slice(0, 4), called);
  assert.equal(model.replacements, 2);
});

test('1000 cycles preserve queue sizes, unique experts, host copies and complete SSD weights', () => {
  const model = create();
  let replacements = 0;
  for (let i = 0; i < 1000; i++) {
    const story = model.request(); model.dispatch(story);
    for (const item of story.experts) {
      if (item.source === 'ssd') model.fill('ram', item.id);
      if (item.source !== 'vram') { model.fill('vram', item.id); ++replacements; }
    }
    for (const [tier, size] of [['vram', 48], ['ram', 96], ['ssd', 192]]) {
      assert.equal(model.caches[tier].length, size); assert.equal(new Set(model.caches[tier]).size, size);
    }
    assert.deepEqual(model.caches.vram.slice(0, 4), story.experts.map(item => item.id));
    assert.deepEqual(model.caches.ram.slice(0, 4), story.experts.map(item => item.id));
    assert.ok(model.caches.vram.every(id => model.caches.ram.includes(id)));
    assert.deepEqual([...model.caches.ssd].sort((a, b) => a - b), Array.from({ length: 192 }, (_, id) => id));
  }
  assert.equal(model.replacements, replacements);
});
