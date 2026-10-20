import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { gzipSync, brotliCompressSync, constants } from 'node:zlib';
import { assembleIndex, encodeIndex, validateIndex, INDEX_LIMITS, INDEX_SCHEMA } from '../community/leaderboard-model.mjs';

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
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
