import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { oneLine, decodeSubmission, validatePayload, privacyFindings } from '../community/submission-codec.mjs';
import { packFixture } from '../backend/fixtures.mjs';
import { receiptHandoff, receiptCredential, verifiedReceipt } from '../community/receipt-model.mjs';
const text = await fs.readFile(new URL('./fixtures/submission-vectors.json', import.meta.url), 'utf8');
const vectors = JSON.parse(text), encode = text => new TextEncoder().encode(text);

test('production Worker bundles without Node-only runtime imports', async () => {
  const require = createRequire(import.meta.url);
  const esbuild = require(process.env.MOE4ALL_BUILD_MODULES ? path.join(process.env.MOE4ALL_BUILD_MODULES, 'esbuild') : 'esbuild');
  const result = await esbuild.build({ entryPoints: [fileURLToPath(new URL('../backend/worker.mjs', import.meta.url))], bundle: true, platform: 'browser', format: 'esm', write: false, logLevel: 'silent' });
  assert.ok(result.outputFiles[0].contents.length > 0);
});

test('shared Rust/Python/website summary vectors agree including exact boundaries and Unicode White_Space', () => {
  for (const value of vectors.one_line) assert.equal(oneLine(value.text ?? value.unit.repeat(value.count), value.limit), value.expected ?? value.unit.repeat(value.expected_count) + value.suffix, value.name);
});
test('shared payloads and invalid mutations match the upload contract', async () => {
  for (const kind of ['benchmark', 'error']) assert.deepEqual((await decodeSubmission(encode(await packFixture(kind, vectors[kind])))).payload, vectors[kind]);
  for (const value of vectors.invalid) {
    const payload = structuredClone(vectors[value.kind]), keys = value.path.slice(1).split('/');
    const target = keys.slice(0, -1).reduce((value, key) => value[key], payload); target[keys.at(-1)] = value.value;
    let rejected = false; try { validatePayload(value.kind, payload); rejected = privacyFindings(payload).length > 0; } catch { rejected = true; }
    assert.ok(rejected, value.path);
  }
});
test('full envelopes retain normalization boundaries, controls, non-BMP characters and BOM inside text', async () => {
  for (const description of ['x'.repeat(240), '中'.repeat(241), '\u{1f600}'.repeat(240), 'a\0b', '\ufeffdescription\ufeff']) {
    const payload = { ...vectors.error, description };
    const armor = await packFixture('error', payload); assert.deepEqual((await decodeSubmission(encode(armor))).payload, payload);
    if (process.env.MOE4ALL_INDEPENDENT_DECODER) {
      const source = 'import sys;sys.path.insert(0,sys.argv[1]);from moe4all_submission import decode_text;from submission_validation import validate_payload;s=decode_text(sys.stdin.buffer.read().decode("utf-8"));validate_payload(s.kind,s.payload)';
      const result = spawnSync(process.env.MOE4ALL_PYTHON || 'python', ['-B', '-c', source, process.env.MOE4ALL_INDEPENDENT_DECODER.replace(/[\\/][^\\/]+$/, '')], { input: armor, encoding: 'utf8', windowsHide: true });
      assert.equal(result.status, 0, result.stderr);
    }
  }
});
test('engine and website golden vectors stay byte-identical during cross-repo integration', { skip: !process.env.MOE4ALL_INDEPENDENT_DECODER }, async () => {
  const path = process.env.MOE4ALL_INDEPENDENT_DECODER.replace(/[\\/][^\\/]+$/, '') + '/fixtures/submission-vectors.json';
  assert.equal(text.replace(/\r\n/g, '\n'), (await fs.readFile(path, 'utf8')).replace(/\r\n/g, '\n'));
});
test('receipt fragments and private imports never choose the API destination', () => {
  const credential = { receipt_id: 'rc_fixture', receipt_token: 'private-fixture-token' };
  assert.deepEqual(receiptHandoff('#receipt=rc_fixture&token=private-fixture-token'), credential);
  assert.equal(receiptHandoff('#receipts'), null);
  for (const hash of ['#receipt=rc_fixture&token=short', '#receipt=rc_fixture&token=private-fixture-token&api=https://evil.test', '#receipt=rc_fixture&token=private-fixture-token&token=other']) assert.throws(() => receiptHandoff(hash));
  assert.throws(() => receiptCredential({ ...credential, api_base: 'https://evil.test/v1' }, 'https://api.example/v1'));
  const valid = { api_version: 1, receipt_id: 'rc_fixture', kind: 'error', report_id: 'fixture', status: 'forwarding', public_url: null };
  assert.equal(verifiedReceipt(valid, credential, 'example/test').receipt_token, credential.receipt_token);
  assert.throws(() => verifiedReceipt({ ...valid, public_url: 'javascript:alert(1)' }, credential, 'example/test'));
  assert.throws(() => verifiedReceipt({ ...valid, receipt_id: 'rc_other' }, credential, 'example/test'));
});
