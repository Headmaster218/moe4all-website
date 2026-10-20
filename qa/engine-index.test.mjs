import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { loadLeaderboard } from '../community/leaderboard-loader.mjs';
import { FIELDS, decodeIndex, indexRows } from '../community/leaderboard-model.mjs';

test('engine-generated Git index is decoded and displayed by the actual website reader', { skip: !process.env.MOE4ALL_ENGINE_SOURCE }, async t => {
  const engine = path.resolve(process.env.MOE4ALL_ENGINE_SOURCE), python = process.env.MOE4ALL_PYTHON || 'python3';
  const { prepareIndexCommit } = await import(pathToFileURL(path.join(engine, 'scripts/publish-benchmark-index.mjs')));
  const producer = await import(pathToFileURL(path.join(engine, 'scripts/leaderboard/model.mjs')));
  assert.deepEqual(producer.FIELDS, FIELDS);
  const repo = await fs.mkdtemp(path.join(os.tmpdir(), 'engine-index-interop-'));
  t.after(() => fs.rm(repo, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', ...args], { cwd: repo, stdio: ['ignore', 'pipe', 'pipe'] });
  git('init', '--initial-branch=main');
  const payload = JSON.parse(await fs.readFile(path.join(engine, 'scripts/fixtures/submission-vectors.json'), 'utf8')).benchmark;
  const armor = execFileSync(python, ['-c', 'import sys,json;sys.path.insert(0,sys.argv[1]);from test_submission import encode;sys.stdout.write(encode("benchmark",json.load(sys.stdin)))', path.join(engine, 'scripts')], { input: JSON.stringify(payload), env: { ...process.env, PYTHONUTF8: '1', PYTHONDONTWRITEBYTECODE: '1' } });
  const directory = path.join(repo, 'benchmark-database/v1', payload.created_at_utc.slice(0, 7));
  await fs.mkdir(directory, { recursive: true }); await fs.writeFile(path.join(directory, payload.id + '.m4b'), armor);
  git('add', '.'); git('commit', '-m', 'fixture report');
  await prepareIndexCommit({ directory: repo, python });
  const manifest = JSON.parse(await fs.readFile(path.join(repo, 'benchmark-database/index/v1/manifest.json'), 'utf8'));
  const prefix = 'https://raw.githubusercontent.com/Headmaster218/MoE4All/';
  const requests = [];
  const result = await loadLeaderboard(prefix + 'main/benchmark-database/index/v1/manifest.json', {
    supportsBrotli: () => false, cacheStorage: undefined,
    fetcher: async url => {
      requests.push(url);
      if (url === prefix + 'main/benchmark-database/index/v1/manifest.json') return Response.json(manifest);
      assert.ok(url.startsWith(prefix + manifest.package_commit + '/benchmark-database/index/v1/'));
      return new Response(git('show', manifest.package_commit + ':benchmark-database/index/v1/' + url.split('/').at(-1)));
    }
  });
  assert.equal(result.stale, false); assert.equal(result.index.reports[0].id, payload.id);
  const rows = indexRows(result.index);
  assert.equal(rows[0].decode, payload.contexts[0].decode[0].overall_tokens_per_second);
  assert.deepEqual(decodeIndex(producer.encodeIndex(result.index)), result.index);
  assert.equal(requests.length, 2); assert.ok(requests.every(url => url.startsWith(prefix)));
});
