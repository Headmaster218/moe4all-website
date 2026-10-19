import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { gzipSync, brotliCompressSync, constants } from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { assembleIndex, encodeIndex, decodeIndex, validateIndex, INDEX_LIMITS, INDEX_SCHEMA } from '../community/leaderboard-model.mjs';
import { decodeSubmission, privacyFindings, MAX_ARMOR_BYTES } from '../community/submission-codec.mjs';

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const reportPath = /^benchmark-database\/v1\/(\d{4}-\d{2})\/([A-Za-z0-9][A-Za-z0-9._-]{0,159})\.m4b$/;
export function indexArtifacts(entries, { source = null, mode = 'production', generatedAt = new Date().toISOString() } = {}) {
  return artifactsFromIndex(assembleIndex(entries, { source, mode }), generatedAt);
}
export function artifactsFromIndex(index, generatedAt = new Date().toISOString()) {
  validateIndex(index);
  const { source, mode } = index, json = Buffer.from(JSON.stringify(encodeIndex(index)));
  if (json.length > INDEX_LIMITS.decodedBytes) throw new Error('排行榜索引超出解码上限');
  const version = sha256(json), packages = {};
  for (const [format, bytes] of [['brotli', brotliCompressSync(json, { params: { [constants.BROTLI_PARAM_QUALITY]: 11, [constants.BROTLI_PARAM_MODE]: constants.BROTLI_MODE_TEXT } })], ['gzip', gzipSync(json, { level: 9 })]]) {
    if (bytes.length > INDEX_LIMITS.compressedBytes) throw new Error('排行榜索引超出压缩包上限');
    const name = `index-${version}.${format === 'brotli' ? 'br' : 'gz'}.bin`;
    packages[format] = { descriptor: { url: name, bytes: bytes.length, sha256: sha256(bytes) }, bytes };
  }
  const manifest = { schema: INDEX_SCHEMA, version, mode, generated_at: generatedAt, source,
    counts: { reports: index.reports.length, contexts: index.contexts.length, measurements: index.measurements.length },
    decoded_bytes: json.length, decoded_sha256: version, packages: Object.fromEntries(Object.entries(packages).map(([format, p]) => [format, p.descriptor])) };
  return { index, json, manifest, packages };
}

export async function writeIndexArtifacts(output, artifacts) {
  if (!path.isAbsolute(output)) throw new Error('排行榜输出目录必须是显式绝对路径');
  await fs.mkdir(output, { recursive: true });
  for (const { descriptor, bytes } of Object.values(artifacts.packages)) {
    const filename = path.join(output, descriptor.url);
    try { await fs.writeFile(filename, bytes, { flag: 'wx' }); }
    catch (error) { if (error.code !== 'EEXIST' || sha256(await fs.readFile(filename)) !== descriptor.sha256) throw error; }
  }
  // Publish the manifest last; already cached content-addressed packages remain valid.
  const temporary = path.join(output, `.manifest-${randomUUID()}.json`);
  await fs.writeFile(temporary, JSON.stringify(artifacts.manifest) + '\n', { flag: 'wx' });
  await fs.rename(temporary, path.join(output, 'manifest.json'));
}

export async function buildFromGit({ directory, repository = 'Headmaster218/MoE4All', ref = 'HEAD', output, snapshot, python, decoder, gitCommand = (args, options) => execFileSync('git', args, options) } = {}) {
  if (!directory || !path.isAbsolute(directory) || !/^[\w.-]+\/[\w.-]+$/.test(repository) || !/^[A-Za-z0-9_./-]+$/.test(ref) || ref.startsWith('-') || ref.includes('..')) throw new Error('需要有效的数据仓库、ref 和绝对源码路径');
  const git = (...args) => gitCommand(args, { cwd: directory, maxBuffer: 16777216, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const head = git('rev-parse', '--verify', `${ref}^{commit}`);
  if (!/^[a-f0-9]{40}$/.test(head)) throw new Error('无法解析数据仓库 commit');
  const commit = git('log', '-1', '--format=%H', head, '--', 'benchmark-database/v1') || head;
  const generatedAt = git('show', '-s', '--format=%cI', commit);
  const tree = gitCommand(['ls-tree', '-r', '-z', '--name-only', commit, '--', 'benchmark-database/v1'], { cwd: directory, maxBuffer: 16777216, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const files = tree.split('\0').filter(Boolean), entries = [], ids = new Set();
  if (files.some(file => file.endsWith('.json'))) throw new Error('存在尚未转换为 .m4b 的旧 Benchmark，拒绝静默忽略');
  if (files.filter(file => file.endsWith('.m4b')).length > INDEX_LIMITS.reports) throw new Error('报告数量超出当前索引上限');
  for (const file of files.filter(file => file.endsWith('.m4b')).sort()) {
    const match = reportPath.exec(file); if (!match || ids.has(match[2])) throw new Error('Benchmark 路径无效或报告 ID 重复');
    ids.add(match[2]);
    const bytes = gitCommand(['show', `${commit}:${file}`], { cwd: directory, maxBuffer: MAX_ARMOR_BYTES + 1, stdio: ['ignore', 'pipe', 'pipe'] });
    const decoded = await decodeSubmission(bytes, { filename: file.split('/').at(-1) });
    if (decoded.kind !== 'benchmark' || decoded.payload.created_at_utc.slice(0, 7) !== match[1] || privacyFindings(decoded.payload).length) throw new Error(`Benchmark 原件未通过路径或隐私复核：${match[2]}`);
    if (python || decoder) {
      if (!python || !decoder || !path.isAbsolute(decoder)) throw new Error('独立校验需要 Python 和解码器绝对路径');
      const code = 'import sys,importlib.util; s=importlib.util.spec_from_file_location("moe4all_submission",sys.argv[1]); m=importlib.util.module_from_spec(s); sys.modules[s.name]=m; s.loader.exec_module(m); m.decode_text(sys.stdin.read())';
      try { execFileSync(python, ['-c', code, decoder], { input: bytes, env: { ...process.env, PYTHONUTF8: '1', PYTHONDONTWRITEBYTECODE: '1' }, timeout: 30000, stdio: ['pipe', 'ignore', 'pipe'] }); }
      catch { throw new Error(`独立 Python 解码复核失败：${match[2]}`); }
    }
    entries.push({ payload: decoded.payload });
  }
  const artifacts = indexArtifacts(entries, { source: { repository, commit, path_version: 1 }, generatedAt });
  if (output) await writeIndexArtifacts(output, artifacts);
  if (snapshot) {
    if (!path.isAbsolute(snapshot)) throw new Error('快照输出必须是显式绝对路径');
    await fs.mkdir(path.dirname(snapshot), { recursive: true });
    await fs.writeFile(snapshot, JSON.stringify({ generated_at: generatedAt, index: JSON.parse(artifacts.json) }) + '\n');
  }
  return artifacts;
}

export async function readSnapshot(filename) {
  const stat = await fs.stat(filename);
  if (stat.size > INDEX_LIMITS.decodedBytes + 4096) throw new Error('精简快照超过读取上限');
  const snapshot = JSON.parse(await fs.readFile(filename, 'utf8')), index = decodeIndex(snapshot.index);
  if (index.mode !== 'production' || !Number.isFinite(Date.parse(snapshot.generated_at))) throw new Error('只能发布正式 Git 数据快照');
  return artifactsFromIndex(index, snapshot.generated_at);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), values = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!['--source', '--output', '--snapshot', '--repository', '--ref', '--python', '--decoder'].includes(args[i]) || !args[i + 1] || Object.hasOwn(values, args[i])) throw new Error('无效或重复的索引构建参数');
    values[args[i]] = args[i + 1];
  }
  if (!values['--output'] || !path.isAbsolute(values['--output'])) throw new Error('必须指定绝对 --output 目录');
  try {
    const result = await buildFromGit({ directory: values['--source'], output: values['--output'], snapshot: values['--snapshot'], repository: values['--repository'], ref: values['--ref'], python: values['--python'], decoder: values['--decoder'] });
    console.log(JSON.stringify({ reports: result.manifest.counts.reports, measurements: result.manifest.counts.measurements, version: result.manifest.version, brotli_bytes: result.packages.brotli.bytes.length, gzip_bytes: result.packages.gzip.bytes.length, output: values['--output'] }));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
