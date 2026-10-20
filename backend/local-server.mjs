import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { createService } from './service.mjs';
import { localDatabase } from './local-db.mjs';
import { decodeSubmission, sha256, benchmarkRows, MAX_ARMOR_BYTES } from '../community/submission-codec.mjs';
import { benchmarkFixture, errorFixture, packFixture } from './fixtures.mjs';
import { previewIndex } from './leaderboard-preview.mjs';
import { indexArtifacts, writeIndexArtifacts } from '../scripts/build-leaderboard.mjs';
import { buildIcons } from '../scripts/optimize-site.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const publicFiles = new Set(['index.html', 'technical.html', 'styles.css', 'app.js', 'memory-model.js', 'memory.js', 'agent-showcase.css', 'agent-showcase.js', 'release-model.js', 'site-ui.js', 'site-dialogs.js', 'site-dialogs.css', 'analytics.js', 'media.js', 'everyday.html', 'everyday.css', 'everyday.js', 'demo.html', 'demo.css', 'demo.js', 'site-data.js']);
const mime = { '.html': 'text/html; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.gif': 'image/gif', '.json': 'application/json; charset=utf-8' };
const encode = text => new TextEncoder().encode(text);
export async function startLocalServer({ directory, port = 8765, seed = true, reviewMode = 'github_pr', onError } = {}) {
  if (!['github_pr', 'local_review'].includes(reviewMode)) throw new Error('Unsupported local review mode');
  if (!directory || !path.isAbsolute(directory)) throw new Error('Set MOE4ALL_LOCAL_DATA_DIR to an explicit absolute local-work/runtime directory');
  const allowedRoot = path.resolve(process.env.MOE4ALL_WORK_ROOT || 'D:/AIinfr/infr/local-work', 'runtime');
  const resolved = path.resolve(directory);
  if (!resolved.toLowerCase().startsWith(allowedRoot.toLowerCase() + path.sep)) throw new Error('Local runtime state must stay under local-work/runtime');
  await fs.mkdir(resolved, { recursive: true });
  let config;
  const settings = path.join(resolved, 'local-private.json');
  try { config = JSON.parse(await fs.readFile(settings, 'utf8')); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    config = { admin: randomBytes(32).toString('hex'), salt: randomBytes(32).toString('hex') };
    await fs.writeFile(settings, JSON.stringify(config), { mode: 0o600, flag: 'wx' });
  }
  const db = localDatabase(path.join(resolved, 'community.sqlite'), await fs.readFile(path.join(root, 'backend/migrations/0001.sql'), 'utf8'));
  const indexDirectory = path.join(resolved, 'leaderboard');
  await writeIndexArtifacts(indexDirectory, seed ? previewIndex() : indexArtifacts([], { mode: 'preview' }));
  const iconFile = path.join(resolved, 'community-icons.js');
  await buildIcons(root, iconFile, { community: true });
  const archive = {
    mode: 'local',
    async process(row) {
      const decoded = row.armor ? await decodeSubmission(encode(row.armor)) : null;
      const relative = row.source_path || `${decoded.kind === 'benchmark' ? 'benchmark-database' : 'error-database'}/v1/${decoded.headers['created-at'].slice(0, 7)}/${decoded.id}.${decoded.kind === 'benchmark' ? 'm4b' : 'm4e'}`, target = path.join(resolved, 'archive', ...relative.split('/'));
      await fs.mkdir(path.dirname(target), { recursive: true });
      try { if (row.armor) await fs.writeFile(target, row.armor, { flag: 'wx' }); }
      catch (error) { if (error.code !== 'EEXIST') throw error; }
      if (await sha256(await fs.readFile(target)) !== row.file_sha256) throw new Error('Local archive content conflict');
      return { state: reviewMode === 'github_pr' ? 'pending' : 'published', verified: true, mode: 'local', ...(reviewMode === 'github_pr' ? {} : { commit: 'local:' + row.file_sha256 }), path: relative, file_sha256: row.file_sha256, public_url: null };
    },
    async verify(row) {
      const info = JSON.parse(row.archive_json || '{}');
      if (!/^benchmark-database\/v1\/\d{4}-\d{2}\/[A-Za-z0-9._-]+\.m4b$/.test(info.path || '')) return false;
      try { return await sha256(await fs.readFile(path.join(resolved, 'archive', ...info.path.split('/')))) === row.file_sha256; } catch { return false; }
    }
  };
  let origin, app;
  const server = http.createServer(async (incoming, outgoing) => {
    try {
      if (incoming.headers.host !== new URL(origin).host) { outgoing.writeHead(403); outgoing.end('Host denied'); return; }
      const url = new URL(incoming.url, origin);
      if (url.pathname === '/__local/login' && incoming.method === 'POST') {
        if (incoming.headers.origin !== origin) { outgoing.writeHead(403); outgoing.end(); return; }
        outgoing.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Set-Cookie': `moe4all_local_admin=${config.admin}; HttpOnly; SameSite=Strict; Path=/v1/admin` });
        outgoing.end(JSON.stringify({ local: true })); return;
      }
      if (url.pathname.startsWith('/__local/example/')) {
        if (incoming.method !== 'GET') { outgoing.writeHead(405); outgoing.end(); return; }
        const kind = url.pathname.endsWith('/error') ? 'error' : 'benchmark', value = kind === 'error' ? errorFixture(99) : benchmarkFixture(99);
        outgoing.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Disposition': `attachment; filename="${value.id}${kind === 'error' ? '.m4e' : '.m4b'}"` });
        outgoing.end(await packFixture(kind, value)); return;
      }
      if (url.pathname.startsWith('/v1/')) {
        const chunks = []; let bytes = 0;
        for await (const chunk of incoming) { bytes += chunk.length; if (bytes > MAX_ARMOR_BYTES) { outgoing.writeHead(413, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); outgoing.end(JSON.stringify({ api_version: 1, error: { code: 'payload_too_large', message: '文件超过 128 KiB', retryable: false } })); return; } chunks.push(chunk); }
        const method = incoming.method || 'GET';
        const request = new Request(url, { method, headers: incoming.headers, ...(chunks.length && !['GET', 'HEAD'].includes(method) ? { body: Buffer.concat(chunks) } : {}) });
        const response = await app.fetch(request);
        outgoing.writeHead(response.status, Object.fromEntries(response.headers)); outgoing.end(Buffer.from(await response.arrayBuffer())); return;
      }
      if (!['GET', 'HEAD'].includes(incoming.method)) { outgoing.writeHead(405); outgoing.end(); return; }
      if (/^\/community\/data\/(?:manifest\.json|index-[a-f0-9]{64}\.(?:br|gz)\.bin)$/.test(url.pathname)) {
        const name = url.pathname.split('/').at(-1), data = await fs.readFile(path.join(indexDirectory, name));
        outgoing.writeHead(200, { 'Content-Type': name === 'manifest.json' ? 'application/json; charset=utf-8' : 'application/octet-stream', 'Cache-Control': name === 'manifest.json' ? 'no-cache' : 'public, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff' });
        outgoing.end(incoming.method === 'HEAD' ? undefined : data); return;
      }
      let pathname = decodeURIComponent(url.pathname);
      if (pathname === '/') { outgoing.writeHead(302, { Location: '/community/' }); outgoing.end(); return; }
      if (pathname === '/community/' || pathname === '/community') pathname = '/community/index.html';
      const allowed = publicFiles.has(pathname.slice(1)) || /^\/community\/(?:index\.html|upload\.html|admin\.html|app\.mjs|upload-support\.mjs|ui-model\.mjs|leaderboard-model\.mjs|leaderboard-loader\.mjs|receipt-model\.mjs|submission-codec\.mjs|submission-limits\.mjs|styles\.css|config\.js|vendor\/gzip\.mjs)$/.test(pathname) || /^\/assets\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_.-]+\.(?:svg|webp|png|jpg|gif|js)$/.test(pathname);
      if (!allowed) { outgoing.writeHead(404); outgoing.end('Not found'); return; }
      const target = path.join(root, ...pathname.split('/').filter(Boolean));
      const body = pathname.endsWith('/config.js') ? Buffer.from(`window.MOE4ALL_COMMUNITY_CONFIG=${JSON.stringify({ apiBase: origin + '/v1', mode: 'local', reviewMode, repository: 'Headmaster218/MoE4All', leaderboardManifest: 'data/manifest.json' })};`) : await fs.readFile(pathname === '/assets/lucide.min.js' ? iconFile : target);
      outgoing.writeHead(200, { 'Content-Type': mime[path.extname(target)] || 'application/octet-stream', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'" });
      outgoing.end(incoming.method === 'HEAD' ? undefined : body);
    } catch (error) { if (onError) onError(error); if (!outgoing.headersSent) outgoing.writeHead(error.code === 'ENOENT' ? 404 : 500); outgoing.end('Local service error'); }
  });
  const listen = selected => new Promise((resolve, reject) => { const failed = error => reject(error); server.once('error', failed); server.listen(selected, '127.0.0.1', () => { server.removeListener('error', failed); resolve(); }); });
  try { await listen(port); }
  catch (error) { if (port && ['EADDRINUSE', 'EACCES'].includes(error.code)) await listen(0); else { db.close(); throw error; } }
  origin = `http://127.0.0.1:${server.address().port}`;
  const jobs = new Set();
  const defer = task => { jobs.add(task); task.finally(() => jobs.delete(task)).catch(() => {}); };
  app = createService({ DB: db, MODE: 'local', REVIEW_MODE: reviewMode, SITE_ORIGIN: origin, RATE_LIMIT_SALT: config.salt, ARCHIVE: archive,
    defer,
    clientAddress: () => 'loopback',
    authorizeAdmin: async request => {
      const cookie = request.headers.get('cookie') || '';
      return cookie.split(';').some(part => part.trim() === `moe4all_local_admin=${config.admin}`) ? 'local-maintainer' : null;
    },
    verifyHuman: async () => true,
    onError: (id, error) => onError?.(new Error(`${id}: ${error.name}`))
  });
  if (seed) {
    const marker = path.join(resolved, 'fixtures-v1.initialized');
    try { await fs.access(marker); }
    catch {
      const now = new Date().toISOString();
      for (let i = 0; i < 19; i++) {
        const kind = i < 16 ? 'benchmark' : 'error', payload = kind === 'benchmark' ? benchmarkFixture(i) : errorFixture(i - 16);
        const armor = await packFixture(kind, payload), decoded = await decodeSubmission(encode(armor));
        const receipt = `rc_fixture_${i}`, status = i < 12 ? 'published' : 'pending_review', group = kind === 'error' ? `eg_fixture_${i === 18 ? 1 : 0}` : null;
        const statements = [
          ['INSERT OR IGNORE INTO reports(receipt_id,kind,report_id,file_sha256,payload_sha256,armor,size_bytes,summary_json,status,created_at,updated_at,group_id,is_fixture) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,1)', receipt, kind, payload.id, decoded.fileSha256, decoded.payloadSha256, armor, decoded.sizeBytes, JSON.stringify(decoded.summary), status, now, now, group]
        ];
        if (kind === 'benchmark') statements.push(['INSERT OR IGNORE INTO benchmark_rows(id,receipt_id,row_json) VALUES(?,?,?)', receipt, receipt, JSON.stringify(benchmarkRows(payload))]);
        else statements.push(['INSERT OR IGNORE INTO error_groups(id,fingerprint,title,created_at,updated_at) VALUES(?,?,?,?,?)', group, group, payload.error.message, now, now]);
        await app.store.batch(statements);
      }
      await fs.writeFile(marker, 'Synthetic local fixtures only. Not measured data.\n', { flag: 'wx' });
    }
  }
  const retryTimer = setInterval(() => defer(app.syncPending()), 60000); retryTimer.unref();
  return { origin, app, directory: resolved, close: async () => { clearInterval(retryTimer); await new Promise(resolve => server.close(resolve)); await Promise.allSettled([...jobs]); db.close(); } };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const instance = await startLocalServer({ directory: process.env.MOE4ALL_LOCAL_DATA_DIR, port: Number(process.env.MOE4ALL_LOCAL_PORT || 8765), seed: process.env.MOE4ALL_LOCAL_SEED !== '0', reviewMode: process.env.MOE4ALL_LOCAL_REVIEW_MODE || 'github_pr', onError: error => console.error(error.message) });
  console.log(`MoE4All Lab local: ${instance.origin}/community/`);
  console.log(`Runtime state: ${instance.directory}`);
  console.log('Loopback only. Synthetic examples are labelled. No inference engine or external uploads.');
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => instance.close().then(() => process.exit(0)));
}
