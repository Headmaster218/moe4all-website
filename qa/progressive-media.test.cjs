const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../media.js'), 'utf8');

function setup(fails = false) {
  const events = {}, paints = [], downloads = [];
  const image = { complete: false, naturalWidth: 0, src: 'preview.webp', dataset: { fullSrc: 'full.webp' }, addEventListener: (name, callback) => { events[name] = callback; } };
  let observer;
  const document = { hidden: false, querySelectorAll: () => [image], addEventListener: (name, callback) => { events[name] = callback; } };
  class FullImage {
    constructor() { downloads.push(this); }
    decode() { return fails ? Promise.reject(new Error('offline')) : Promise.resolve(); }
  }
  const context = {
    document, Image: FullImage,
    requestAnimationFrame: callback => paints.push(callback), requestIdleCallback: callback => callback(),
    IntersectionObserver: class { constructor(callback) { observer = callback; } observe() {} }
  };
  context.window = context;
  vm.runInNewContext(source, context);
  return { image, events, paints, downloads, document, near: value => observer([{ target: image, isIntersecting: value }]) };
}

test('full image starts only after a visible decoded preview has painted', async () => {
  const s = setup();
  s.near(true);
  assert.equal(s.downloads.length, 0);
  s.image.complete = true; s.image.naturalWidth = 1024; s.events.load();
  assert.equal(s.downloads.length, 0);
  s.paints.shift()(); s.paints.shift()();
  assert.equal(s.downloads.length, 1);
  assert.equal(s.downloads[0].fetchPriority, 'low');
  assert.equal(s.image.src, 'preview.webp');
  await new Promise(setImmediate);
  assert.equal(s.image.src, 'full.webp');
  assert.equal(s.image.dataset.quality, 'full');
  s.events.load(); s.near(true);
  assert.equal(s.downloads.length, 1);
});

test('a failed full-image download leaves the preview visible', async () => {
  const s = setup(true);
  s.image.complete = true; s.image.naturalWidth = 1024; s.near(true);
  s.paints.shift()(); s.paints.shift()();
  await new Promise(setImmediate);
  assert.equal(s.image.src, 'preview.webp');
  assert.equal(s.image.dataset.quality, 'preview');
});

test('offscreen and hidden images do not start high-quality downloads', () => {
  const s = setup();
  s.image.complete = true; s.image.naturalWidth = 1024; s.events.load();
  assert.equal(s.paints.length, 0);
  s.document.hidden = true; s.near(true);
  s.paints.shift()(); s.paints.shift()();
  assert.equal(s.downloads.length, 0);
  s.document.hidden = false; s.events.visibilitychange();
  assert.equal(s.paints.length, 1);
});
