import { decodeIndex, validateManifest } from './leaderboard-model.mjs';

const fail = message => { throw new Error(message); };
const digest = async bytes => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), n => n.toString(16).padStart(2, '0')).join('');
async function bounded(response, limit) {
  if (!response.ok) fail('排行榜资源暂时无法读取');
  const reader = response.body.getReader(), chunks = []; let size = 0;
  try {
    while (true) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > limit) fail('排行榜资源超过读取上限'); chunks.push(value); }
  } catch (error) { await reader.cancel().catch(() => {}); throw error; }
  const output = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.length; }
  return output;
}
function brotliSupported() { try { new DecompressionStream('brotli'); return true; } catch { return false; } }
async function decompress(bytes, format, limit) {
  let decoder;
  try { decoder = new DecompressionStream(format === 'brotli' ? 'brotli' : 'gzip'); }
  catch {
    if (format !== 'gzip') throw new Error('浏览器不支持 Brotli');
    const { inflateSingleGzip } = await import('./vendor/gzip.mjs');
    return inflateSingleGzip(bytes, limit);
  }
  return bounded(new Response(new Blob([bytes]).stream().pipeThrough(decoder)), limit);
}

export async function loadLeaderboard(manifestURL, { repository = 'Headmaster218/MoE4All', preview = false, fetcher = fetch, cacheStorage = globalThis.caches, supportsBrotli = brotliSupported, decompressBytes = decompress } = {}) {
  const url = new URL(manifestURL, globalThis.location?.href).href;
  const cache = await cacheStorage?.open('moe4all-leaderboard-v1').catch(() => null);
  const fetchResource = target => fetcher(target, { credentials: 'omit', redirect: 'error', cache: 'no-cache', signal: AbortSignal.timeout(30000) });
  async function readManifest(response) {
    const bytes = await bounded(response, 65536);
    return validateManifest(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)), { repository, preview });
  }
  async function readPackage(manifest) {
    let packageBase = url;
    if (manifest.package_commit !== undefined) {
      const endpoint = new URL(url), prefix = `/${repository}/`;
      if (endpoint.origin !== 'https://raw.githubusercontent.com' || !endpoint.pathname.startsWith(prefix) ||
          !/^(?:benchmark-index|main|[a-f0-9]{40})\/benchmark-database\/index\/v1\/manifest\.json$/.test(endpoint.pathname.slice(prefix.length))) fail('排行榜 Git 数据地址无效');
      packageBase = `https://raw.githubusercontent.com/${repository}/${manifest.package_commit}/benchmark-database/index/v1/manifest.json`;
    }
    const formats = supportsBrotli() ? ['brotli', 'gzip'] : ['gzip']; let last;
    for (const format of formats) {
      try {
        const p = manifest.packages[format], packageURL = new URL(p.url, packageBase).href;
        let bytes, cached = await cache?.match(packageURL).catch(() => null), cacheHit = false;
        if (cached) {
          try { bytes = await bounded(cached, p.bytes); if (bytes.length !== p.bytes || await digest(bytes) !== p.sha256) throw new Error('缓存校验失败'); cacheHit = true; }
          catch { await cache?.delete(packageURL).catch(() => {}); bytes = null; }
        }
        if (!bytes) bytes = await bounded(await fetchResource(packageURL), p.bytes);
        if (bytes.length !== p.bytes || await digest(bytes) !== p.sha256) fail('排行榜压缩包校验失败');
        const json = await decompressBytes(bytes, format, manifest.decoded_bytes);
        if (json.length !== manifest.decoded_bytes || await digest(json) !== manifest.decoded_sha256) fail('排行榜内容校验失败');
        const index = decodeIndex(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(json)));
        if (index.mode !== manifest.mode || JSON.stringify(index.source) !== JSON.stringify(manifest.source) || Object.keys(manifest.counts).some(key => !Array.isArray(index[key]) || index[key].length !== manifest.counts[key])) fail('排行榜目录与数据不一致');
        await cache?.put(packageURL, new Response(bytes, { headers: { 'Content-Type': 'application/octet-stream' } })).catch(() => {});
        await cache?.put(url, Response.json(manifest)).catch(() => {});
        // Retain only this verified version in the dedicated leaderboard cache.
        for (const request of await cache?.keys().catch(() => []) || []) if (request.url !== url && request.url !== packageURL) await cache.delete(request).catch(() => {});
        return { index, manifest, cacheHit, format };
      } catch (error) { last = error; }
    }
    throw last;
  }
  let freshError;
  try { return { ...await readPackage(await readManifest(await fetchResource(url))), stale: false }; }
  catch (error) { freshError = error; }
  const saved = await cache?.match(url).catch(() => null);
  if (saved) {
    try { return { ...await readPackage(await readManifest(saved)), stale: true }; } catch {}
  }
  throw freshError;
}
