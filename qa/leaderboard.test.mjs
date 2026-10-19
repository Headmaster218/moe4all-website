import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { gunzipSync, brotliDecompressSync } from 'node:zlib';
import { benchmarkFixture, packFixture } from '../backend/fixtures.mjs';
import { FIELDS, INDEX_LIMITS, assembleIndex, encodeIndex, decodeIndex, validateIndex, validateManifest, indexRows, provenanceLinks } from '../community/leaderboard-model.mjs';
import { indexArtifacts, artifactsFromIndex, writeIndexArtifacts, readSnapshot, buildFromGit } from '../scripts/build-leaderboard.mjs';
import { loadLeaderboard } from '../community/leaderboard-loader.mjs';
import { filterRows, rangeBounds } from '../community/ui-model.mjs';

const source = { repository: 'Headmaster218/MoE4All', commit: 'a'.repeat(40), path_version: 1 };
const options = { source, generatedAt: '2026-10-19T00:00:00Z' };
const entry = i => ({ payload: benchmarkFixture(i) });
const build = (...entries) => indexArtifacts(entries.length ? entries : [entry(0)], options);
const clone = structuredClone;

test('report, context and concurrency projections preserve facts without inventing actual settings', () => {
  const e = entry(0), p = e.payload;
  Object.assign(p.configuration, { configured_ubatch: 3072, configured_threads: 10, configured_ram_budget: '48GiB', decode_repetitions: 4 });
  Object.assign(p.hardware.gpu, { pcie_generation: 4, pcie_width: 8, pcie_max_width: 16 });
  p.hardware.ram.modules = [{ configured_speed_mt_s: 6000 }, { configured_speed_mt_s: 4800 }];
  p.hardware.model_storage = { model: 'Disk', read_probe: { sequential: { mib_per_second: 1234.5678 }, cache_disposition: 'mostly_cached', physical_read_fraction: .02 } };
  const { index } = build(e), r = index.reports[0], rows = indexRows(index);
  assert.equal(rows.length, 9); assert.equal(indexRows(index, 'prefill').length, 3);
  assert.equal(r.configured_ubatch, 3072); assert.equal(r.actual_ubatch, null); assert.equal(rows[0].ubatch, null);
  assert.equal(r.configured_threads, 10); assert.equal(r.threads, 16);
  assert.equal(r.ram_budget, '48GiB'); assert.equal(r.actual_ram_budget, null);
  assert.equal(r.pcie_width, 8); assert.equal(r.pcie_max_width, 16);
  assert.deepEqual(r.ram_speeds, [4800, 6000]); assert.equal(r.storage_seq, 1234.5678);
  assert.equal(r.storage_cache, 'mostly_cached'); assert.equal(r.storage_physical_fraction, .02);
  assert.equal(r.quant, null); assert.equal(r.mtp, false);
  assert.equal(rows[0].rounds, 3); assert.equal(rows[0].requested_rounds, 4); assert.equal(rows[0].status, 'partial');
  assert.equal(rows[0].prompt_min, 6144); assert.equal(rows[0].start_min, 6656);
  assert.deepEqual(decodeIndex(encodeIndex(index)), index);
});

test('manual Prefill-only and Decode reports retain unknown concurrency and independent configuration strategy', () => {
  for (const kind of ['decode', 'prefill']) {
    const p = benchmarkFixture(0, true); p.configuration.auto_profile = null;
    for (const c of p.contexts) c.manual_result.kind = kind;
    const { index } = build({ payload: p }), rows = indexRows(index, kind);
    assert.equal(rows.length, 3); assert.equal(indexRows(index, kind === 'decode' ? 'prefill' : 'decode').length, 0);
    assert.ok(rows.every(r => r.slots === null && r.sections === null && r.auto_profile === null));
  }
  const invalid = benchmarkFixture(0, true); invalid.contexts[0].manual_result.kind = 'unknown';
  assert.throws(() => build({ payload: invalid }));
});

test('failed conditions are retained with null rates rather than silently dropped or ranked as zero', () => {
  const p = benchmarkFixture(0), c = p.contexts[0];
  c.decode = c.decode.slice(0, 1); c.failures = [{ stage: 'decode', parallel: 2 }, { stage: 'prefill' }];
  p.contexts[1].prefill = null; p.contexts[1].decode = []; p.contexts[1].failures = [{ stage: 'prefill' }];
  const { index } = build({ payload: p }), rows = indexRows(index);
  const missing = rows.find(r => r.context === 6144 && r.slots === 2);
  assert.equal(missing.status, 'failed'); assert.equal(missing.decode, null); assert.equal(missing.rounds, 0);
  assert.equal(rows.find(r => r.context === 6144 && r.slots === 1).failure_count, 0);
  assert.equal(indexRows(index, 'prefill').find(r => r.context === 30720).status, 'failed');
});

test('lossless compact columns retain nulls, arrays and unrounded rates; empty tables are valid', () => {
  const { index } = build(entry(0), entry(1), entry(2));
  index.measurements[0].rate = 49.12345678901234;
  assert.deepEqual(decodeIndex(encodeIndex(index)), index);
  assert.deepEqual(decodeIndex(encodeIndex(assembleIndex([]))), assembleIndex([]));
  assert.equal(build(entry(1), entry(0)).manifest.version, build(entry(0), entry(1)).manifest.version);
});

test('compact decoder rejects malformed tables, references, dictionary indices, limits and duplicate identities', () => {
  const encoded = encodeIndex(build().index);
  const reject = change => { const bad = clone(encoded); change(bad); assert.throws(() => decodeIndex(bad)); };
  reject(x => { x.reports.n = INDEX_LIMITS.reports + 1; });
  reject(x => { x.contexts.c[0] = { k: 99 }; });
  reject(x => { x.measurements.c[1] = { d: ['decode'], v: Array(9).fill(5) }; });
  reject(x => { x.reports.c[0] = { k: 'id', v: [] }; });
  reject(x => { x.reports.c[0].__proto_key = true; });
  reject(x => { x.reports.c[FIELDS.reports.indexOf('failure_stages')] = { k: null }; });
  reject(x => { x.reports.c[FIELDS.reports.indexOf('date')] = { k: '2026-02-30T00:00:00Z' }; });
  const index = clone(build().index); index.measurements.push(clone(index.measurements[0])); assert.throws(() => validateIndex(index));
  assert.throws(() => build(entry(0), entry(0)));
});

test('production rejects demo data and source-less reports; Git links use a fixed commit and original UTC month', () => {
  assert.throws(() => indexArtifacts([{ ...entry(0), demo: true }], options));
  assert.throws(() => indexArtifacts([entry(0)]));
  const { index } = build(), row = indexRows(index)[0], links = provenanceLinks(index, row);
  assert.equal(links.view, `https://github.com/Headmaster218/MoE4All/blob/${source.commit}/benchmark-database/v1/2026-10/example-benchmark-00.m4b`);
  assert.ok(links.download.startsWith('https://raw.githubusercontent.com/Headmaster218/MoE4All/' + source.commit));
  assert.equal(provenanceLinks({ ...index, mode: 'preview' }, row), null);
  assert.equal(provenanceLinks(index, { report_id: 'absent' }), null);
});

test('Brotli and gzip resources decode to exactly the same content and validated manifest', () => {
  const a = build();
  assert.deepEqual(brotliDecompressSync(a.packages.brotli.bytes), a.json);
  assert.deepEqual(gunzipSync(a.packages.gzip.bytes), a.json);
  assert.equal(validateManifest(a.manifest), a.manifest);
  for (const mutate of [m => { m.source.repository = 'other/repo'; }, m => { m.packages.gzip.url = '../bad'; }, m => { m.decoded_bytes = INDEX_LIMITS.decodedBytes + 1; }, m => { m.counts.reports = -1; }, m => { m.mode = 'preview'; }]) {
    const m = clone(a.manifest); mutate(m); assert.throws(() => validateManifest(m));
  }
});

test('artifact writes are idempotent and snapshots cannot turn preview data into production', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'leaderboard-')); t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const a = build(); await writeIndexArtifacts(dir, a); await writeIndexArtifacts(dir, a);
  assert.equal((await fs.readdir(dir)).length, 3);
  const filename = path.join(dir, 'snapshot.json');
  await fs.writeFile(filename, JSON.stringify({ generated_at: a.manifest.generated_at, index: encodeIndex(a.index) }));
  assert.equal((await readSnapshot(filename)).manifest.version, a.manifest.version);
  const preview = assembleIndex([{ ...entry(0), demo: true }], { mode: 'preview' });
  await fs.writeFile(filename, JSON.stringify({ generated_at: a.manifest.generated_at, index: encodeIndex(preview) }));
  await assert.rejects(readSnapshot(filename));
  await fs.writeFile(path.join(dir, a.manifest.packages.gzip.url), 'corrupt');
  await assert.rejects(writeIndexArtifacts(dir, a));
});

test('Git generator reads immutable .m4b originals, verifies path month/identity and never silently drops legacy JSON', async () => {
  const p = benchmarkFixture(0), armor = Buffer.from(await packFixture('benchmark', p));
  let tree = `benchmark-database/v1/2026-10/${p.id}.m4b\0`, shown = 0;
  const gitCommand = args => {
    if (args[0] === 'rev-parse') return 'b'.repeat(40);
    if (args[0] === 'log') return source.commit;
    if (args[0] === 'ls-tree') { assert.equal(args[4], source.commit); return tree; }
    if (args[0] === 'show' && args[1] === '-s') return options.generatedAt;
    if (args[0] === 'show') { shown++; assert.ok(args[1].startsWith(source.commit + ':')); return armor; }
    throw new Error('Unexpected Git command');
  };
  const args = { directory: path.resolve('.'), gitCommand };
  if (process.env.MOE4ALL_INDEPENDENT_DECODER) Object.assign(args, { decoder: process.env.MOE4ALL_INDEPENDENT_DECODER, python: process.env.MOE4ALL_PYTHON || 'python' });
  assert.equal((await buildFromGit(args)).index.reports.length, 1); assert.equal(shown, 1);
  for (const bad of [`benchmark-database/v1/2026-09/${p.id}.m4b\0`, 'benchmark-database/v1/2026-10/other.m4b\0', 'benchmark-database/v1/old.json\0', tree + tree]) {
    tree = bad; await assert.rejects(buildFromGit(args));
  }
});

class MemoryCache {
  values = new Map();
  async match(key) { return this.values.get(key.url || key)?.clone(); }
  async put(key, response) { this.values.set(key.url || key, response.clone()); }
  async delete(key) { return this.values.delete(key.url || key); }
  async keys() { return [...this.values.keys()].map(url => new Request(url)); }
}
function transport(artifacts = build()) {
  const url = 'https://example.test/community/data/manifest.json', cache = new MemoryCache(), calls = [];
  const control = { artifacts, offline: false, corrupt: false, brFail: false };
  const fetcher = async (target, init) => {
    calls.push(target); assert.equal(init.credentials, 'omit'); assert.equal(init.redirect, 'error');
    if (control.offline) throw new Error('offline');
    if (target === url) return Response.json(control.artifacts.manifest);
    const p = Object.values(control.artifacts.packages).find(p => target.endsWith('/' + p.descriptor.url));
    if (control.brFail && target.endsWith('.br.bin')) return new Response('unavailable', { status: 503 });
    return p ? new Response(control.corrupt ? Buffer.alloc(p.bytes.length) : p.bytes) : new Response('missing', { status: 404 });
  };
  const settings = { fetcher, cacheStorage: { open: async () => cache }, supportsBrotli: () => false };
  return { url, cache, calls, control, settings, load: more => loadLeaderboard(url, { ...settings, ...more }) };
}

test('browser loads one package per data version, reuses verified cache and fetches a changed version', async () => {
  const a = transport();
  assert.equal((await a.load()).cacheHit, false); assert.equal(a.calls.length, 2);
  assert.equal((await a.load()).cacheHit, true); assert.equal(a.calls.length, 3);
  a.control.artifacts = build(entry(0), entry(1));
  assert.equal((await a.load()).index.reports.length, 2); assert.equal(a.calls.length, 5);
  assert.equal(a.cache.values.size, 2);
});

test('browser discards corrupt cache, validates network bytes and retains last verified offline version', async () => {
  const a = transport(); await a.load();
  const packageURL = a.calls[1]; a.cache.values.set(packageURL, new Response('corrupt'));
  assert.equal((await a.load()).cacheHit, false);
  a.control.offline = true;
  const saved = await a.load(); assert.equal(saved.stale, true); assert.equal(saved.cacheHit, true);
  a.control.offline = false; a.control.artifacts = build(entry(1)); a.control.corrupt = true;
  assert.equal((await a.load()).stale, true);
  const b = transport(); b.control.corrupt = true; await assert.rejects(b.load(), /校验/);
});

test('Brotli failure falls back to gzip; lack of CacheStorage does not prevent reading', async () => {
  const a = transport(); a.control.brFail = true;
  assert.equal((await a.load({ supportsBrotli: () => true })).format, 'gzip'); assert.equal(a.calls.length, 3);
  assert.equal((await a.load({ cacheStorage: undefined })).index.reports.length, 1);
  assert.equal((await a.load({ cacheStorage: { open: async () => { throw new Error('denied'); } } })).index.reports.length, 1);
  const b = transport();
  const result = await b.load({ supportsBrotli: () => true, decompressBytes: async (bytes, format) => format === 'brotli' ? brotliDecompressSync(bytes) : gunzipSync(bytes) });
  assert.equal(result.format, 'brotli'); assert.equal(b.calls.length, 2);
});

test('manifest/payload mismatch, decoding limits and preview manifests are rejected', async () => {
  const a = transport(); a.control.artifacts.manifest.counts.reports++;
  await assert.rejects(a.load(), /不一致/);
  const b = transport(); await assert.rejects(b.load({ decompressBytes: async () => new Uint8Array(1) }), /校验/);
  const c = transport(indexArtifacts([{ ...entry(0), demo: true }], { mode: 'preview' }));
  await assert.rejects(c.load()); assert.equal((await c.load({ preview: true })).index.mode, 'preview');
  await assert.rejects(c.load());
  const d = transport(); d.control.artifacts.manifest.decoded_bytes = INDEX_LIMITS.decodedBytes + 1;
  await assert.rejects(d.load()); assert.equal(d.calls.length, 1);
  const bad = clone(build().index); bad.measurements[0].rate = null;
  assert.throws(() => artifactsFromIndex(bad));
});

test('one full index supports GPU, memory and arbitrary context combinations without model-specific downloads', () => {
  const rows = indexRows(build(entry(0), entry(1), entry(2)).index);
  assert.deepEqual(rangeBounds(rows, 'context'), { min: 6144, max: 153600 });
  const found = filterRows(rows, { gpu: ['AMD Radeon RX 7900 XTX', 'NVIDIA GeForce RTX 4090'], ramMin: 64, ramMax: 96, contextMode: 'range', contextMin: 10000, contextMax: 40000, slots: [2] });
  assert.equal(found.length, 2); assert.ok(found.every(r => r.context === 30720));
});

test('static CI refresh dispatch is distinct from release events and source snapshot has no fictional reports', async () => {
  const refresh = await fs.readFile(new URL('../.github/workflows/leaderboard.yml', import.meta.url), 'utf8');
  assert.match(refresh, /scripts\/build-leaderboard.mjs/); assert.match(refresh, /--python python3/);
  assert.match(refresh, /git add -- content\/leaderboard\/snapshot.json/); assert.match(refresh, /leaderboard-data-ready/);
  assert.doesNotMatch(refresh, /git push.*--force/);
  const pages = await fs.readFile(new URL('../.github/workflows/pages.yml', import.meta.url), 'utf8');
  assert.match(pages, /types:.*leaderboard-data-ready/);
  assert.match(pages, /contains\(fromJSON/);
  const snapshot = await readSnapshot(new URL('../content/leaderboard/snapshot.json', import.meta.url));
  assert.ok(snapshot.index.reports.every(r => !r.demo));
});
