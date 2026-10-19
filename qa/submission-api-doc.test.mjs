import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createService } from '../backend/service.mjs';
import { MAX_ARMOR_BYTES, MAX_DECODED_BYTES } from '../community/submission-codec.mjs';

const document = await fs.readFile(new URL('../integrations/submission-api-v1.md', import.meta.url), 'utf8');
const examples = [...document.matchAll(/```json\s*\n([\s\S]*?)\n```/g)].map(match => JSON.parse(match[1]));

test('public API reference excludes internal history, deployment instructions and workstation paths', () => {
  assert.doesNotMatch(document, /[A-Za-z]:\\|127\.0\.0\.1|localhost|local-work/i);
  assert.doesNotMatch(document, /leaderboard-data-plan\.md|submission-compatibility\.md/);
  assert.doesNotMatch(document, /^#{1,6}\s+.*(?:踩坑|决策|部署|迁移|测试记录|待办|路线图)/m);
});

test('API reference JSON examples parse and its endpoint inventory covers the current public contract', () => {
  assert.ok(examples.length >= 2);
  const endpoints = [...document.matchAll(/^\| `?(GET|POST)`? \| `([^`]+)` \|/gm)].map(match => `${match[1]} ${match[2]}`).sort();
  assert.deepEqual(endpoints, [
    'GET /health', 'GET /benchmarks', 'POST /upload-sessions',
    'GET /upload-sessions/{id}', 'GET /upload-sessions/{id}/confirmation',
    'POST /upload-sessions/{id}/authorize', 'POST /upload-sessions/{id}/cancel',
    'POST /upload-sessions/{id}/report', 'GET /receipts/{id}',
    'POST /integrations/github/import'
  ].sort());
});

test('health exposes implementation limits and the API reference records the v1 limits', async () => {
  const service = createService({ DB: {}, MODE: 'production', REVIEW_MODE: 'github_pr', ARCHIVE: { mode: 'github' } });
  const response = await service.fetch(new Request('https://api.example/v1/health'));
  assert.equal(response.status, 200);
  const actual = await response.json();
  assert.equal(actual.protocol, 'MOE4ALL-SUBMISSION/1');
  assert.equal(actual.max_upload_bytes, MAX_ARMOR_BYTES);
  assert.equal(actual.max_decoded_bytes, MAX_DECODED_BYTES);
  assert.match(document, /封装文件最大 128 KiB/);
  assert.match(document, /解压后 JSON 最大 128 KiB/);
});

test('documented delivery lifecycle covers both report kinds and durable receipt states', () => {
  assert.match(document, /benchmark-database\/v1\/YYYY-MM\/<id>\.m4b/);
  assert.match(document, /error-database\/v1\/YYYY-MM\/<id>\.m4e/);
  for (const state of ['forwarding', 'pending_review', 'published', 'rejected', 'delivery_failed']) {
    assert.match(document, new RegExp('`' + state + '`'));
  }
  assert.match(document, /PR head 复核成功后立即删除正文/);
  assert.match(document, /24小时内最多成功提交50份报告/);
});
