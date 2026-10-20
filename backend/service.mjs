import { Store } from './store.mjs';
import { decodeSubmission, sha256, parseStrictJson, privacyFindings, benchmarkRows, MAX_ARMOR_BYTES, MAX_DECODED_BYTES, SubmissionError } from '../community/submission-codec.mjs';

const encoder = new TextEncoder();
const random = prefix => prefix + [...crypto.getRandomValues(new Uint8Array(32))].map(n => n.toString(16).padStart(2, '0')).join('');
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const idPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/;
const hashPattern = /^[a-f0-9]{64}$/;
const states = new Set(['pending_review', 'triaged', 'investigating', 'resolved', 'rejected']);
const reportColumns = 'receipt_id,kind,report_id,file_sha256,payload_sha256,summary_json,status,created_at,updated_at,group_id,review_note,public_url,archive_json,resolution_version,is_fixture';
class ApiError extends Error {
  constructor(status, code, message, fields = []) { super(message); this.status = status; this.code = code; this.fields = fields; }
}
const deny = (status, code, message, fields) => { throw new ApiError(status, code, message, fields); };
function bearer(request) { return /^Bearer ([A-Za-z0-9_-]+)$/.exec(request.headers.get('authorization') || '')?.[1] || ''; }
async function tokenHash(value) { return sha256(encoder.encode(value)); }
async function receiptCredential(secret, sessionId, receiptId) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(`receipt-v1:${sessionId}:${receiptId}`));
  return 'rcpt_' + [...new Uint8Array(signature)].map(n => n.toString(16).padStart(2, '0')).join('');
}
async function readBytes(request, max) {
  const declared = Number(request.headers.get('content-length'));
  if (declared > max) deny(413, 'payload_too_large', '请求内容超过限制');
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader(), chunks = []; let length = 0;
  try {
    for (;;) { const { value, done } = await reader.read(); if (done) break; length += value.length; if (length > max) { await reader.cancel(); deny(413, 'payload_too_large', '请求内容超过限制'); } chunks.push(value); }
  } finally { reader.releaseLock(); }
  const result = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
  return result;
}
async function jsonBody(request, max = 8192) {
  if (!/^application\/json(?:;|$)/i.test(request.headers.get('content-type') || '')) deny(415, 'unsupported_media_type', '此接口需要 JSON 请求');
  try { return parseStrictJson(new TextDecoder('utf-8', { fatal: true }).decode(await readBytes(request, max))); }
  catch (error) { if (error instanceof ApiError) throw error; deny(400, 'invalid_json', 'JSON 请求无效'); }
}
function reportView(row) {
  return { receipt_id: row.receipt_id, kind: row.kind, report_id: row.report_id, file_sha256: row.file_sha256, payload_sha256: row.payload_sha256, status: row.status, created_at: row.created_at, updated_at: row.updated_at, group_id: row.group_id, summary: JSON.parse(row.summary_json), public_url: row.public_url, resolution_version: row.resolution_version, archive: row.archive_json ? JSON.parse(row.archive_json) : null, review_note: row.review_note, demo: !!row.is_fixture };
}
async function fingerprint(payload) {
  const message = payload.error?.message?.trim();
  if (!message) return tokenHash('isolated:' + payload.id);
  const normalized = message.replace(/0x[0-9a-f]+/gi, '<addr>').replace(/\b\d{4}-\d\d-\d\dT[^\s]+/g, '<time>').replace(/\s+/g, ' ').slice(0, 1000);
  return tokenHash([payload.failure_kind, payload.engine_version, payload.model?.architecture || '', normalized].join('|'));
}

export function createService(env) {
  const store = new Store(env.DB);
  const clock = () => env.now ? env.now() : Date.now();
  const iso = () => new Date(clock()).toISOString();
  const publicPr = env.REVIEW_MODE === 'github_pr';
  const publicConsent = kind => kind === 'benchmark' ? 'public_benchmark' : 'public_error';
  const sourceHash = request => tokenHash(`${env.RATE_LIMIT_SALT}:source:${env.clientAddress ? env.clientAddress(request) : request.headers.get('cf-connecting-ip') || 'unknown'}`);
  const defer = task => { if (env.defer) env.defer(Promise.resolve().then(task).catch(() => {})); };
  const audit = (actor, action, receipt, detail = {}) => ["INSERT INTO audit_events(id,receipt_id,actor,action,detail_json,created_at) VALUES(?,?,?,?,?,?)", random('ev_'), receipt, actor, action, JSON.stringify(detail), iso()];
  async function limit(request, category, max, seconds = 900) {
    const now = clock(), window = Math.floor(now / (seconds * 1000));
    const address = env.clientAddress ? env.clientAddress(request) : request.headers.get('cf-connecting-ip') || 'unknown';
    const key = await tokenHash(`${env.RATE_LIMIT_SALT}:${address}:${category}:${window}`);
    await store.run('INSERT INTO rate_limits(bucket,count,expires_at) VALUES(?,1,?) ON CONFLICT(bucket) DO UPDATE SET count=count+1', key, new Date((window + 1) * seconds * 1000).toISOString());
    const count = await store.one('SELECT count FROM rate_limits WHERE bucket=?', key);
    if (count.count > max) deny(429, 'rate_limited', '请求过于频繁，请稍后再试');
  }
  async function session(request, id, role = 'client') {
    const row = await store.one('SELECT * FROM upload_sessions WHERE id=?', id);
    const supplied = bearer(request);
    if (!row || !supplied || await tokenHash(supplied) !== (role === 'browser' ? row.authorize_hash : row.token_hash)) deny(401, 'invalid_token', '会话凭证无效');
    if (Date.parse(row.expires_at) <= clock()) deny(410, 'session_expired', '上传会话已过期');
    return row;
  }
  async function admin(request) {
    if (publicPr) deny(404, 'not_found', '审核请在 GitHub PR 中进行');
    const actor = await env.authorizeAdmin(request);
    if (!actor) deny(401, 'admin_required', '请先登录审核中心');
    return actor;
  }
  async function syncPullRequest(row) {
    if (!publicPr || !env.ARCHIVE || row.publication_consent !== publicConsent(row.kind) || !['forwarding', 'pending_review', 'published', 'rejected'].includes(row.status)) return row;
    const now = iso(), owner = random('sync_');
    const lock = await store.one('INSERT INTO pr_sync_locks(receipt_id,owner,expires_at) VALUES(?,?,?) ON CONFLICT(receipt_id) DO UPDATE SET owner=excluded.owner,expires_at=excluded.expires_at WHERE pr_sync_locks.expires_at<? RETURNING owner', row.receipt_id, owner, new Date(clock() + 600000).toISOString(), now);
    if (!lock) return row;
    try {
      row = await store.one('SELECT * FROM reports WHERE receipt_id=?', row.receipt_id);
      if (row.status === 'delivery_failed' || (row.next_attempt_at && row.next_attempt_at > now)) return row;
      // Old, consented inbox rows need immutable provenance before their body can be released.
      if (row.armor && !row.source_path) {
        const decoded = await decodeSubmission(encoder.encode(row.armor));
        if (decoded.fileSha256 !== row.file_sha256 || decoded.payloadSha256 !== row.payload_sha256 || decoded.id !== row.report_id || decoded.kind !== row.kind) throw new Error('Stored original differs');
        row.report_created_at = decoded.headers['created-at'];
        row.source_path = `${row.kind === 'benchmark' ? 'benchmark-database' : 'error-database'}/v1/${row.report_created_at.slice(0, 7)}/${row.report_id}.${row.kind === 'benchmark' ? 'm4b' : 'm4e'}`;
        row.delivery_expires_at = new Date(Date.parse(row.created_at) + 72 * 3600000).toISOString();
        await store.run('UPDATE reports SET source_path=?,report_created_at=?,delivery_expires_at=? WHERE receipt_id=?', row.source_path, row.report_created_at, row.delivery_expires_at, row.receipt_id);
      }
      if (row.armor && row.delivery_expires_at <= now) {
        await store.batch([
          ['UPDATE reports SET status=?,armor=NULL,body_deleted_at=?,failure_code=?,updated_at=?,next_attempt_at=NULL WHERE receipt_id=?', 'delivery_failed', now, 'delivery_expired', now, row.receipt_id],
          audit('github-pr', 'delivery_expired', row.receipt_id)
        ]);
        return await store.one('SELECT * FROM reports WHERE receipt_id=?', row.receipt_id);
      }
      const result = await env.ARCHIVE.process(row);
      if (!['pending', 'published', 'rejected'].includes(result.state) || result.verified !== true || result.path !== row.source_path || result.file_sha256 !== row.file_sha256 || (result.state === 'published' && !result.commit)) throw new Error('Invalid PR result');
      const status = result.state === 'pending' ? 'pending_review' : result.state;
      await store.batch([
        ['UPDATE reports SET status=?,archive_json=?,public_url=?,updated_at=?,armor=NULL,body_deleted_at=coalesce(body_deleted_at,?),failure_code=NULL,delivery_attempts=delivery_attempts+1,next_attempt_at=? WHERE receipt_id=? AND publication_consent=?', status, JSON.stringify(result), result.public_url || null, iso(), iso(), status === 'pending_review' ? new Date(clock() + 900000).toISOString() : null, row.receipt_id, publicConsent(row.kind)],
        audit('github-pr', result.state === 'pending' ? 'pr_pending' : status, row.receipt_id, { pr: result.pr_number || null, file_sha256: row.file_sha256 })
      ]);
    } catch {
      await store.batch([
        ['UPDATE reports SET updated_at=?,delivery_attempts=delivery_attempts+1,next_attempt_at=?,failure_code=? WHERE receipt_id=?', iso(), new Date(clock() + Math.min(3600000, 30000 * 2 ** Math.min(row.delivery_attempts || 0, 7))).toISOString(), 'github_unavailable_or_unverified', row.receipt_id],
        audit('github-pr', 'pr_sync_failed', row.receipt_id)
      ]);
    } finally {
      await store.run('DELETE FROM pr_sync_locks WHERE receipt_id=? AND owner=?', row.receipt_id, owner);
    }
    return await store.one('SELECT * FROM reports WHERE receipt_id=?', row.receipt_id);
  }
  async function syncPending() {
    if (!publicPr) return;
    const now = iso();
    await store.batch([
      ['UPDATE reports SET status=?,armor=NULL,body_deleted_at=?,failure_code=?,updated_at=?,next_attempt_at=NULL WHERE armor IS NOT NULL AND delivery_expires_at<=? AND publication_consent IN (?,?) AND NOT EXISTS(SELECT 1 FROM pr_sync_locks l WHERE l.receipt_id=reports.receipt_id AND l.expires_at>?)', 'delivery_failed', now, 'delivery_expired', now, now, 'public_benchmark', 'public_error', now],
      ['DELETE FROM submission_admissions WHERE created_at<=?', new Date(clock() - 86400000).toISOString()],
      ['DELETE FROM session_admissions WHERE created_at<=?', new Date(clock() - 86400000).toISOString()],
      ['DELETE FROM upload_sessions WHERE expires_at<?', now],
      ['DELETE FROM rate_limits WHERE expires_at<?', now],
      ['DELETE FROM pr_sync_locks WHERE expires_at<=?', now]
    ]);
    if (!env.ARCHIVE) return;
    const rows = await store.all('SELECT * FROM reports WHERE (status IN (?,?) OR (armor IS NOT NULL AND status IN (?,?))) AND publication_consent IN (?,?) AND (next_attempt_at IS NULL OR next_attempt_at<=?) ORDER BY coalesce(next_attempt_at,created_at) ASC LIMIT 3', 'forwarding', 'pending_review', 'published', 'rejected', 'public_benchmark', 'public_error', now);
    for (const row of rows) await syncPullRequest(row);
  }
  async function publicUpload(request, row, decoded) {
    const prior = await store.one('SELECT * FROM reports WHERE kind=? AND report_id=?', row.kind, row.report_id);
    if (prior && prior.payload_sha256 !== decoded.payloadSha256) deny(409, 'report_id_conflict', '相同报告 ID 对应不同内容');
    if (prior && prior.publication_consent !== publicConsent(row.kind)) deny(409, 'consent_conflict', '旧私有报告不能通过重复上传改为公开，请重新导出新报告');
    const receipt = random('rc_'), now = iso(), source = await sourceHash(request), since = new Date(clock() - 86400000).toISOString();
    const reportCreated = decoded.headers['created-at'];
    const sourcePath = `${row.kind === 'benchmark' ? 'benchmark-database' : 'error-database'}/v1/${reportCreated.slice(0, 7)}/${row.report_id}.${row.kind === 'benchmark' ? 'm4b' : 'm4e'}`;
    // D1 serializes each batch: capacity and rolling success quota are checked in the same insertion.
    await store.batch([
      ['INSERT INTO reports(receipt_id,kind,report_id,file_sha256,payload_sha256,armor,size_bytes,summary_json,status,created_at,updated_at,publication_consent,source_path,report_created_at,delivery_expires_at) SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,? FROM upload_sessions WHERE id=? AND state IN (?,?) AND expires_at>? AND publication_consent=? AND (SELECT coalesce(sum(size_bytes),0) FROM reports WHERE armor IS NOT NULL)+?<=? AND (SELECT count(*) FROM submission_admissions WHERE source_hash=? AND created_at>?)<50 AND (SELECT count(*) FROM reports WHERE armor IS NOT NULL)<? ON CONFLICT(kind,report_id) DO NOTHING', receipt, row.kind, row.report_id, row.file_sha256, decoded.payloadSha256, decoded.text, decoded.sizeBytes, JSON.stringify(decoded.summary), 'forwarding', now, now, publicConsent(row.kind), sourcePath, reportCreated, new Date(clock() + 72 * 3600000).toISOString(), row.id, 'ready', 'uploaded', now, publicConsent(row.kind), decoded.sizeBytes, Number(env.MAX_STORED_BYTES || 134217728), source, since, Number(env.MAX_PENDING_REPORTS || 1000)],
      ['INSERT INTO submission_admissions(receipt_id,source_hash,created_at) SELECT receipt_id,?,? FROM reports WHERE receipt_id=?', source, now, receipt]
    ]);
    const existing = await store.one('SELECT * FROM reports WHERE kind=? AND report_id=?', row.kind, row.report_id);
    if (!existing) {
      if ((await store.one('SELECT count(*) AS n FROM submission_admissions WHERE source_hash=? AND created_at>?', source, since)).n >= 50) deny(429, 'daily_limit', '同一来源在 24 小时内最多接收 50 份新报告，请保留文件稍后重试');
      const current = await session(request, row.id);
      if (!['ready', 'uploaded'].includes(current.state)) deny(409, 'session_closed', '会话已经结束');
      deny(503, 'inbox_full', '转发缓冲区暂时已满，请保留文件稍后重试');
    }
    if (existing.payload_sha256 !== decoded.payloadSha256) deny(409, 'report_id_conflict', '相同报告 ID 对应不同内容');
    if (existing.publication_consent !== publicConsent(row.kind)) deny(409, 'consent_conflict', '已有报告未授权公开');
    const duplicate = receipt !== existing.receipt_id;
    const grant = await receiptCredential(env.RATE_LIMIT_SALT, row.id, existing.receipt_id);
    await store.batch([
      ['INSERT OR IGNORE INTO receipt_grants(token_hash,receipt_id,created_at) VALUES(?,?,?)', await tokenHash(grant), existing.receipt_id, now],
      ['UPDATE upload_sessions SET receipt_id=?,state=? WHERE id=?', existing.receipt_id, 'uploaded', row.id],
      audit('submitter', duplicate ? 'duplicate_received' : 'received', existing.receipt_id, { kind: row.kind })
    ]);
    defer(() => syncPullRequest(existing));
    return { status: duplicate ? 200 : 202, body: { receipt_id: existing.receipt_id, receipt_token: grant, kind: row.kind, report_id: row.report_id, file_sha256: existing.file_sha256, submitted_file_sha256: row.file_sha256, payload_sha256: decoded.payloadSha256, status: existing.status, public_url: existing.public_url, review_mode: 'github_pr', duplicate, received_at: existing.created_at } };
  }
  async function archiveReport(row, actor) {
    if (!env.ARCHIVE) deny(503, 'archive_unconfigured', '尚未配置归档目标，原件仍保留在收件箱');
    const result = await env.ARCHIVE.process(row);
    if (result.state !== 'published') {
      await store.batch([
        ['UPDATE reports SET archive_json=?,updated_at=? WHERE receipt_id=? AND status=? AND reviewed_sha256=file_sha256', JSON.stringify(result), iso(), row.receipt_id, 'archiving'],
        audit(actor, 'archive_pending', row.receipt_id, { mode: result.mode, pr: result.public_url || null })
      ]);
      return { status: 'archiving', archive: result };
    }
    if (result.file_sha256 !== row.file_sha256 || !result.commit) deny(409, 'archive_mismatch', '归档内容未通过复核，未公开');
    const statements = [
      ['UPDATE reports SET status=?,archive_json=?,public_url=?,updated_at=? WHERE receipt_id=? AND status=? AND reviewed_sha256=file_sha256', 'published', JSON.stringify(result), result.public_url || null, iso(), row.receipt_id, 'archiving'],
      audit(actor, 'published', row.receipt_id, { mode: result.mode, commit: result.commit, file_sha256: result.file_sha256 })
    ];
    await store.batch(statements);
    return { status: 'published', archive: result };
  }
  async function upload(request, row) {
    if (!['ready', 'uploaded'].includes(row.state)) deny(row.state === 'cancelled' ? 409 : 403, row.state === 'cancelled' ? 'session_closed' : 'verification_required', '请先完成浏览器确认');
    if (publicPr && row.publication_consent !== publicConsent(row.kind)) deny(403, 'consent_required', '请创建新会话并确认公开 PR 用途');
    if (!/^text\/plain(?:;|$)/i.test(request.headers.get('content-type') || '')) deny(415, 'unsupported_media_type', '封装文件请使用 text/plain; charset=utf-8');
    const bytes = await readBytes(request, MAX_ARMOR_BYTES);
    if (bytes.length !== row.size_bytes || await sha256(bytes) !== row.file_sha256) deny(409, 'file_mismatch', '文件与创建会话时不一致');
    const decoded = await decodeSubmission(bytes, { filename: row.report_id + (row.kind === 'benchmark' ? '.m4b' : '.m4e') });
    if (decoded.kind !== row.kind || decoded.id !== row.report_id) deny(409, 'file_mismatch', '文件类型或报告 ID 不一致');
    const findings = privacyFindings(decoded.payload);
    if (findings.length) deny(422, 'sensitive_content', '发现疑似私密信息，请回到向导检查后重新导出', findings);
    if (publicPr) return publicUpload(request, row, decoded);
    let existing = await store.one('SELECT * FROM reports WHERE kind=? AND report_id=?', row.kind, row.report_id);
    if (existing && existing.payload_sha256 !== decoded.payloadSha256) deny(409, 'report_id_conflict', '相同报告 ID 对应不同内容');
    const receipt = existing?.receipt_id || random('rc_'), now = iso();
    let groupId = null, groupStatement = null;
    if (row.kind === 'error') {
      const key = await fingerprint(decoded.payload); groupId = 'eg_' + key;
      groupStatement = ['INSERT INTO error_groups(id,fingerprint,title,created_at,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(fingerprint) DO UPDATE SET updated_at=excluded.updated_at', groupId, key, (decoded.payload.error.message || decoded.payload.description).slice(0, 160), now, now];
    }
    const statements = [
      ['INSERT INTO reports(receipt_id,kind,report_id,file_sha256,payload_sha256,armor,size_bytes,summary_json,created_at,updated_at,group_id) SELECT ?,?,?,?,?,?,?,?,?,?,? FROM upload_sessions WHERE id=? AND state IN (?,?) AND expires_at>? AND (SELECT coalesce(sum(size_bytes),0) FROM reports WHERE armor IS NOT NULL)+?<=? ON CONFLICT(kind,report_id) DO NOTHING', receipt, row.kind, row.report_id, row.file_sha256, decoded.payloadSha256, decoded.text, decoded.sizeBytes, JSON.stringify(decoded.summary), now, now, groupId, row.id, 'ready', 'uploaded', now, decoded.sizeBytes, Number(env.MAX_STORED_BYTES || 134217728)]
    ];
    if (groupStatement) statements.push(groupStatement);
    if (!existing && row.kind === 'benchmark') {
      const projection = benchmarkRows(decoded.payload);
      if (projection.length > 512 || encoder.encode(JSON.stringify(projection)).length > 262144) deny(422, 'schema_invalid', '单份报告的结果矩阵过大');
      statements.push(['INSERT INTO benchmark_rows(id,receipt_id,row_json) SELECT receipt_id,receipt_id,? FROM reports WHERE kind=? AND report_id=? AND payload_sha256=? ON CONFLICT(id) DO NOTHING', JSON.stringify(projection), row.kind, row.report_id, decoded.payloadSha256]);
    }
    statements.push(['UPDATE upload_sessions SET state=? WHERE id=? AND state=? AND expires_at>?', 'uploaded', row.id, 'ready', now]);
    // D1 batch is transactional; uniqueness constraints are the cross-request deduplication boundary.
    await store.batch(statements);
    existing = await store.one('SELECT * FROM reports WHERE kind=? AND report_id=?', row.kind, row.report_id);
    if (!existing) deny(409, 'session_closed', '会话已结束、过期或收件箱空间不足，未接收文件');
    if (existing.payload_sha256 !== decoded.payloadSha256) deny(409, 'report_id_conflict', '相同报告 ID 对应不同内容');
    const grant = await receiptCredential(env.RATE_LIMIT_SALT, row.id, existing.receipt_id);
    await store.batch([
      ['INSERT OR IGNORE INTO receipt_grants(token_hash,receipt_id,created_at) VALUES(?,?,?)', await tokenHash(grant), existing.receipt_id, now],
      ['UPDATE upload_sessions SET receipt_id=?,state=? WHERE id=?', existing.receipt_id, 'uploaded', row.id],
      audit('submitter', receipt === existing.receipt_id && existing.created_at === now ? 'received' : 'duplicate_received', existing.receipt_id, { kind: row.kind })
    ]);
    const duplicate = receipt !== existing.receipt_id || existing.created_at !== now;
    return { status: duplicate ? 200 : 202, body: { receipt_id: existing.receipt_id, receipt_token: grant, kind: row.kind, report_id: row.report_id, file_sha256: existing.file_sha256, submitted_file_sha256: row.file_sha256, payload_sha256: decoded.payloadSha256, status: existing.status, public_url: existing.public_url, review_mode: publicPr ? 'github_pr' : 'local_review', duplicate, received_at: existing.created_at } };
  }

  async function route(request) {
    const url = new URL(request.url), path = url.pathname.replace(/\/$/, ''), method = request.method;
    if (env.MODE === 'production' && url.protocol !== 'https:') deny(400, 'https_required', '正式上传接口仅接受 HTTPS');
    if (method === 'GET' && path === '/v1/health') return { body: { mode: env.MODE, review_mode: publicPr ? 'github_pr' : 'local_review', protocol: 'MOE4ALL-SUBMISSION/1', max_upload_bytes: MAX_ARMOR_BYTES, max_decoded_bytes: MAX_DECODED_BYTES, authentication: env.MODE === 'local' ? 'local_confirmation' : 'turnstile', git_archive: env.ARCHIVE?.mode || 'unconfigured' } };
    if (method === 'GET' && path === '/v1/benchmarks') {
      const rows = await store.all('SELECT b.row_json,r.is_fixture FROM benchmark_rows b JOIN reports r ON r.receipt_id=b.receipt_id WHERE r.status=? ORDER BY r.created_at DESC LIMIT 1000', 'published');
      const totals = await store.one(`WITH samples AS (
        SELECT json_extract(j.value,'$.context') AS context,
          CASE WHEN json_extract(j.value,'$.ram_bytes') > 0 THEN CAST(round(json_extract(j.value,'$.ram_bytes') / 1073741824.0) AS INTEGER) END AS ram,
          CASE WHEN json_extract(j.value,'$.vram_bytes') > 0 THEN CAST(round(json_extract(j.value,'$.vram_bytes') / 1073741824.0) AS INTEGER) END AS vram
        FROM benchmark_rows b JOIN reports r ON r.receipt_id=b.receipt_id JOIN json_each(b.row_json) j WHERE r.status=?
      ) SELECT count(*) AS total, min(context) AS context_min, max(context) AS context_max, min(ram) AS ram_min, max(ram) AS ram_max, min(vram) AS vram_min, max(vram) AS vram_max FROM samples`, 'published');
      const bounds = Object.fromEntries(['context', 'ram', 'vram'].map(key => [key, { min: totals[key + '_min'], max: totals[key + '_max'] }]));
      return { body: { mode: env.MODE, total: totals.total, bounds, rows: rows.flatMap(r => JSON.parse(r.row_json).map(item => ({ ...item, demo: !!r.is_fixture }))).slice(0, 1000) } };
    }
    if (method === 'POST' && path === '/v1/integrations/github/import') {
      if (publicPr) deny(404, 'not_found', '排行榜由 Git main 的静态快照生成，无需导入 D1');
      const supplied = bearer(request);
      if (!env.GIT_IMPORT_TOKEN || !supplied || await tokenHash(supplied) !== await tokenHash(env.GIT_IMPORT_TOKEN)) deny(401, 'invalid_token', '导入凭证无效');
      if (!env.ARCHIVE?.readMerged) deny(503, 'archive_unconfigured', 'Git 读取器尚未配置');
      const value = await jsonBody(request);
      if (!/^[a-f0-9]{40}$/.test(value.commit || '') || !/^benchmark-database\/v1\/\d{4}-\d{2}\/[A-Za-z0-9._-]+\.m4b$/.test(value.path || '')) deny(400, 'invalid_request', '需要 main 中的不可变 commit 和 .m4b 路径');
      const bytes = await env.ARCHIVE.readMerged(value.commit, value.path);
      const file = value.path.split('/').at(-1), decoded = await decodeSubmission(bytes, { filename: file });
      if (decoded.kind !== 'benchmark' || value.path.split('/')[2] !== decoded.headers['created-at'].slice(0, 7)) deny(422, 'schema_invalid', 'Git 路径与报告类型或月份不一致');
      const findings = privacyFindings(decoded.payload);
      if (findings.length) deny(422, 'sensitive_content', 'Git 实测未通过隐私检查', findings);
      const existing = await store.one('SELECT * FROM reports WHERE kind=? AND report_id=?', 'benchmark', decoded.id);
      if (existing && (existing.payload_sha256 !== decoded.payloadSha256 || existing.file_sha256 !== decoded.fileSha256)) deny(409, 'report_id_conflict', 'Git 原件与收件箱已有原件不同，需维护者核对');
      const receipt = existing?.receipt_id || random('rc_'), now = iso();
      const archive = { state: 'published', mode: 'github', commit: value.commit, path: value.path, public_url: `https://github.com/${env.GITHUB_REPOSITORY}/blob/${value.commit}/${value.path}`, file_sha256: decoded.fileSha256 };
      await store.batch([
        ['INSERT INTO reports(receipt_id,kind,report_id,file_sha256,payload_sha256,armor,size_bytes,summary_json,status,created_at,updated_at,reviewed_sha256,public_url,archive_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(kind,report_id) DO UPDATE SET status=excluded.status,reviewed_sha256=excluded.reviewed_sha256,public_url=excluded.public_url,archive_json=excluded.archive_json,updated_at=excluded.updated_at WHERE reports.file_sha256=excluded.file_sha256 AND reports.payload_sha256=excluded.payload_sha256', receipt, 'benchmark', decoded.id, decoded.fileSha256, decoded.payloadSha256, decoded.text, decoded.sizeBytes, JSON.stringify(decoded.summary), 'published', now, now, decoded.fileSha256, archive.public_url, JSON.stringify(archive)],
        ['INSERT INTO benchmark_rows(id,receipt_id,row_json) SELECT receipt_id,receipt_id,? FROM reports WHERE kind=? AND report_id=? AND payload_sha256=? ON CONFLICT(id) DO NOTHING', JSON.stringify(benchmarkRows(decoded.payload)), 'benchmark', decoded.id, decoded.payloadSha256],
        audit('github-main-import', 'git_imported', receipt, { commit: value.commit, path: value.path })
      ]);
      return { body: { imported: true, duplicate: !!existing, report_id: decoded.id, status: 'published' } };
    }
    if (method === 'POST' && path === '/v1/upload-sessions') {
      if (publicPr && !env.ARCHIVE) deny(503, 'archive_unconfigured', 'PR 提交服务尚未配置，请保留文件稍后再试');
      await limit(request, 'create', 20);
      const meta = await jsonBody(request, 32768);
      if (!object(meta) || Object.keys(meta).some(k => !['kind', 'report_id', 'file_sha256', 'size_bytes', 'summary'].includes(k)) || !['benchmark', 'error'].includes(meta.kind) || !idPattern.test(meta.report_id || '') || !hashPattern.test(meta.file_sha256 || '') || !Number.isSafeInteger(meta.size_bytes) || meta.size_bytes < 1 || meta.size_bytes > MAX_ARMOR_BYTES || (meta.summary !== undefined && (!Array.isArray(meta.summary) || meta.summary.length > 8 || meta.summary.some(line => typeof line !== 'string' || [...line].length > 500 || /[\x00-\x1f\x7f]/.test(line))))) deny(400, 'invalid_request', '会话参数无效；摘要为可选的简短文本数组');
      const duplicate = await store.one('SELECT receipt_id FROM reports WHERE kind=? AND report_id=?', meta.kind, meta.report_id);
      const pending = await store.one('SELECT count(*) AS n FROM reports WHERE armor IS NOT NULL');
      if (!duplicate && pending.n >= Number(env.MAX_PENDING_REPORTS || 1000)) deny(503, 'inbox_full', '收件箱暂时已满，请保留文件稍后重试');
      const storage = await store.one('SELECT coalesce(sum(size_bytes),0) AS n FROM reports WHERE armor IS NOT NULL');
      const sessions = await store.one('SELECT count(*) AS n FROM upload_sessions WHERE expires_at>?', iso());
      if ((!duplicate && storage.n + meta.size_bytes > Number(env.MAX_STORED_BYTES || 134217728)) || sessions.n >= 2000) deny(503, 'inbox_full', '收件箱暂时已满，请保留文件稍后重试');
      const id = random('us_'), token = random('ust_'), authorization = random('browser_'), now = iso(), expires = new Date(clock() + 900000).toISOString();
      const source = await sourceHash(request), since = new Date(clock() - 86400000).toISOString();
      await store.batch([
        ['DELETE FROM upload_sessions WHERE expires_at<?', now], ['DELETE FROM rate_limits WHERE expires_at<?', now],
        ['DELETE FROM session_admissions WHERE created_at<=?', since],
        ['INSERT INTO upload_sessions(id,token_hash,authorize_hash,kind,report_id,file_sha256,size_bytes,expires_at,created_at,summary_json) SELECT ?,?,?,?,?,?,?,?,?,? WHERE (SELECT count(*) FROM session_admissions WHERE source_hash=? AND created_at>?)<?', id, await tokenHash(token), await tokenHash(authorization), meta.kind, meta.report_id, meta.file_sha256, meta.size_bytes, expires, now, meta.summary ? JSON.stringify(meta.summary) : null, source, since, publicPr ? 100 : 1000000],
        ['INSERT INTO session_admissions(session_id,source_hash,created_at) SELECT id,?,? FROM upload_sessions WHERE id=?', source, now, id]
      ]);
      if (!await store.one('SELECT id FROM upload_sessions WHERE id=?', id)) deny(429, 'daily_session_limit', '同一来源在 24 小时内最多创建 100 个会话，请稍后重试');
      return { status: 201, body: { session_id: id, session_token: token, state: 'awaiting_verification', expires_at: expires, poll_after_seconds: 3, verification_url: `${env.SITE_ORIGIN}/community/upload.html#session=${id}&authorize=${authorization}`, max_upload_bytes: MAX_ARMOR_BYTES } };
    }
    const match = /^\/v1\/upload-sessions\/([A-Za-z0-9_-]+)(?:\/(authorize|cancel|report|confirmation))?$/.exec(path);
    if (match) {
      const [, id, action] = match;
      if (method === 'GET' && (!action || action === 'confirmation')) {
        const row = await session(request, id, action === 'confirmation' ? 'browser' : 'client');
        await limit(request, 'poll', 700);
        const report = row.receipt_id ? await store.one('SELECT summary_json FROM reports WHERE receipt_id=?', row.receipt_id) : null;
        return { body: { session_id: id, state: row.state, kind: row.kind, report_id: row.report_id, file_sha256: row.file_sha256, size_bytes: row.size_bytes, expires_at: row.expires_at, poll_after_seconds: 3, ...(action === 'confirmation' ? { turnstile_site_key: env.TURNSTILE_SITE_KEY || null, summary: report ? JSON.parse(report.summary_json) : row.summary_json ? JSON.parse(row.summary_json) : null, summary_verified: !!report } : {}), mode: env.MODE, review_mode: publicPr ? 'github_pr' : 'local_review', consent: publicPr ? publicConsent(row.kind) : row.kind === 'benchmark' ? 'public_benchmark' : 'private_error' } };
      }
      if (method === 'POST' && ['authorize', 'cancel'].includes(action)) {
        const row = await session(request, id, 'browser');
        await limit(request, 'authorize', 40);
        if (action === 'cancel') {
          if (row.state === 'uploaded') deny(409, 'session_closed', '文件已经收到，无法取消会话');
          await store.run('UPDATE upload_sessions SET state=? WHERE id=? AND state IN (?,?)', 'cancelled', id, 'awaiting_verification', 'ready');
          return { body: { state: 'cancelled' } };
        }
        const value = await jsonBody(request);
        const consent = publicPr ? publicConsent(row.kind) : row.kind === 'benchmark' ? 'public_benchmark' : 'private_error';
        if (value.consent !== consent) deny(403, 'consent_required', '请确认本次提交的公开或私有用途');
        if (!['awaiting_verification', 'ready'].includes(row.state)) deny(409, 'session_closed', '会话已经结束');
        // A successful authorization response may be lost. Never spend its one-use token again.
        if (row.state === 'ready' && (!publicPr || row.publication_consent === consent)) return { body: { state: 'ready' } };
        if (!await env.verifyHuman(value.turnstile_token, request)) deny(403, 'verification_required', '请完成人机验证');
        await store.run('UPDATE upload_sessions SET state=?,publication_consent=? WHERE id=? AND state IN (?,?)', 'ready', publicPr ? consent : null, id, 'awaiting_verification', 'ready');
        return { body: { state: 'ready' } };
      }
      if (method === 'POST' && action === 'report') { await limit(request, 'upload', 30); return upload(request, await session(request, id)); }
    }
    const receiptMatch = /^\/v1\/receipts\/([A-Za-z0-9_-]+)$/.exec(path);
    if (method === 'GET' && receiptMatch) {
      await limit(request, 'receipt', 100);
      const row = await store.one('SELECT r.* FROM reports r JOIN receipt_grants g ON g.receipt_id=r.receipt_id WHERE r.receipt_id=? AND g.token_hash=?', receiptMatch[1], await tokenHash(bearer(request)));
      if (!row) deny(401, 'invalid_token', '回执凭证无效');
      if (publicPr && ['forwarding', 'pending_review'].includes(row.status) && (!row.next_attempt_at || row.next_attempt_at <= iso())) defer(() => syncPullRequest(row));
      return { body: { receipt_id: row.receipt_id, kind: row.kind, report_id: row.report_id, file_sha256: row.file_sha256, payload_sha256: row.payload_sha256, status: row.status, received_at: row.created_at, updated_at: row.updated_at, public_url: row.public_url, resolution_version: row.resolution_version, failure_code: row.failure_code, body_retained: !!row.armor, review_mode: publicPr ? 'github_pr' : 'local_review', archive_mode: row.archive_json ? JSON.parse(row.archive_json).mode : null } };
    }
    if (path.startsWith('/v1/admin')) {
      const actor = await admin(request);
      if (method === 'GET' && path === '/v1/admin/reports') {
        const offset = Number(url.searchParams.get('offset') || 0), limit = Number(url.searchParams.get('limit') || 200);
        if (!Number.isSafeInteger(offset) || offset < 0 || offset > 1000000 || !Number.isSafeInteger(limit) || limit < 1 || limit > 200) deny(400, 'invalid_request', '分页参数无效');
        const reports = await store.all(`SELECT ${reportColumns} FROM reports ORDER BY created_at DESC,receipt_id DESC LIMIT ? OFFSET ?`, limit, offset);
        const total = (await store.one('SELECT count(*) AS n FROM reports')).n;
        return { body: { reports: reports.map(reportView), total, next_offset: offset + reports.length < total ? offset + reports.length : null } };
      }
      if (method === 'GET' && path === '/v1/admin/overview') {
        const reports = await store.all(`SELECT ${reportColumns} FROM reports ORDER BY created_at DESC,receipt_id DESC LIMIT 200`);
        const counts = await store.all('SELECT kind,status,count(*) AS n FROM reports GROUP BY kind,status');
        const groups = await store.all('SELECT g.*,count(r.receipt_id) AS report_count,count(DISTINCT json_extract(r.summary_json,\'$[0]\')) AS variants FROM error_groups g JOIN reports r ON r.group_id=g.id GROUP BY g.id ORDER BY g.updated_at DESC LIMIT 100');
        const auditRows = await store.all('SELECT id,receipt_id,actor,action,detail_json,created_at FROM audit_events ORDER BY created_at DESC LIMIT 40');
        const total = counts.reduce((sum, item) => sum + item.n, 0);
        return { body: { actor, reports: reports.map(reportView), groups, audit: auditRows, counts, mode: env.MODE, total, next_offset: reports.length < total ? reports.length : null, report_limit: 200 } };
      }
      const report = /^\/v1\/admin\/reports\/([A-Za-z0-9_-]+)(?:\/(raw|review|archive|cleanup))?$/.exec(path);
      if (report) {
        const row = await store.one('SELECT * FROM reports WHERE receipt_id=?', report[1]);
        if (!row) deny(404, 'not_found', '报告不存在');
        if (method === 'GET' && !report[2]) {
          const decoded = row.armor ? await decodeSubmission(encoder.encode(row.armor)) : null;
          return { body: { ...reportView(row), payload: decoded?.payload || null } };
        }
        if (method === 'GET' && report[2] === 'raw') {
          if (!row.armor) deny(410, 'source_cleaned', '云端原件已按归档策略清理');
          return { raw: row.armor, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Content-Disposition': `attachment; filename="${row.report_id}${row.kind === 'benchmark' ? '.m4b' : '.m4e'}"` } };
        }
        if (method === 'POST' && report[2] === 'review') {
          const value = await jsonBody(request);
          if (value.file_sha256 !== row.file_sha256) deny(409, 'review_stale', '审核的文件摘要已经变化');
          if (value.action === 'approve') {
            if (row.kind !== 'benchmark' || row.status !== 'pending_review') deny(409, 'invalid_transition', '当前报告不能执行收录');
            if (!env.ARCHIVE) deny(503, 'archive_unconfigured', '归档目标未配置，未改变审核状态');
            const claimed = await store.one('UPDATE reports SET status=?,reviewed_sha256=?,updated_at=? WHERE receipt_id=? AND status=? RETURNING receipt_id', 'archiving', row.file_sha256, iso(), row.receipt_id, 'pending_review');
            if (!claimed) deny(409, 'review_stale', '报告已被其他审核操作处理');
            await store.batch([audit(actor, 'approved', row.receipt_id, { file_sha256: row.file_sha256 })]);
            return { body: await archiveReport({ ...row, status: 'archiving', reviewed_sha256: row.file_sha256 }, actor) };
          }
          if (value.action === 'reject') {
            if (row.status !== 'pending_review') deny(409, 'invalid_transition', '只有待审核报告可以退回');
            const note = typeof value.note === 'string' ? value.note.slice(0, 1000) : '';
            const claimed = await store.one('UPDATE reports SET status=?,review_note=?,updated_at=? WHERE receipt_id=? AND status=? RETURNING receipt_id', 'rejected', note, iso(), row.receipt_id, 'pending_review');
            if (!claimed) deny(409, 'review_stale', '报告已被其他审核操作处理');
            await store.batch([audit(actor, 'rejected', row.receipt_id)]);
            return { body: { status: 'rejected' } };
          }
          deny(400, 'invalid_request', '审核动作无效');
        }
        if (method === 'POST' && report[2] === 'archive') {
          if (row.kind !== 'benchmark' || row.status !== 'archiving') deny(409, 'invalid_transition', '没有待同步归档任务');
          return { body: await archiveReport(row, actor) };
        }
        if (method === 'POST' && report[2] === 'cleanup') {
          const value = await jsonBody(request), archive = row.archive_json ? JSON.parse(row.archive_json) : null;
          if (row.kind !== 'benchmark' || row.status !== 'published' || !archive || archive.file_sha256 !== row.file_sha256 || value.file_sha256 !== row.file_sha256 || Date.now() - Date.parse(row.updated_at) < 7 * 86400000) deny(409, 'cleanup_not_ready', '尚未满足已归档、摘要一致及七天保留条件');
          if (!await env.ARCHIVE.verify(row)) deny(409, 'archive_mismatch', '归档原件复核失败，保留收件箱文件');
          await store.batch([['UPDATE reports SET armor=NULL WHERE receipt_id=?', row.receipt_id], audit(actor, 'source_cleaned', row.receipt_id)]);
          return { body: { cleaned: true } };
        }
      }
      const group = /^\/v1\/admin\/groups\/([A-Za-z0-9_-]+)$/.exec(path);
      if (method === 'PATCH' && group) {
        const value = await jsonBody(request), row = await store.one('SELECT * FROM error_groups WHERE id=?', group[1]);
        if (!row) deny(404, 'not_found', '问题组不存在');
        if (!states.has(value.status)) deny(400, 'invalid_request', '问题状态无效');
        const version = typeof value.resolution_version === 'string' ? value.resolution_version.slice(0, 128) : null;
        await store.batch([
          ['UPDATE error_groups SET status=?,resolution_version=?,updated_at=? WHERE id=?', value.status, version, iso(), group[1]],
          ['UPDATE reports SET status=?,resolution_version=?,updated_at=? WHERE group_id=?', value.status, version, iso(), group[1]],
          audit(actor, 'group_status_changed', null, { group_id: group[1], status: value.status })
        ]);
        return { body: { status: value.status } };
      }
      if (method === 'POST' && path === '/v1/admin/groups/move') {
        const value = await jsonBody(request), row = await store.one('SELECT * FROM reports WHERE receipt_id=? AND kind=?', value.receipt_id || '', 'error');
        if (!row) deny(404, 'not_found', '报告不存在');
        let target = value.group_id ? await store.one('SELECT * FROM error_groups WHERE id=?', value.group_id) : null;
        if (value.group_id && !target) deny(404, 'not_found', '目标问题组不存在');
        if (!target) {
          const id = random('eg_');
          await store.run('INSERT INTO error_groups(id,fingerprint,title,status,created_at,updated_at) VALUES(?,?,?,?,?,?)', id, id, JSON.parse(row.summary_json)[0], row.status, iso(), iso());
          target = { id, status: row.status };
        }
        await store.batch([
          ['UPDATE reports SET group_id=?,status=?,resolution_version=?,updated_at=? WHERE receipt_id=?', target.id, target.status, target.resolution_version || null, iso(), row.receipt_id],
          audit(actor, 'group_changed', row.receipt_id, { from: row.group_id, to: target.id })
        ]);
        return { body: { group_id: target.id } };
      }
      deny(404, 'not_found', '管理接口不存在');
    }
    deny(404, 'not_found', '接口不存在');
  }

  return {
    store, syncPending,
    async fetch(request) {
      const requestId = random('req_'), origin = request.headers.get('origin');
      const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Vary': 'Origin' };
      if (origin && origin !== env.SITE_ORIGIN) return Response.json({ api_version: 1, error: { code: 'origin_denied', message: '请求来源不允许', retryable: false } }, { status: 403, headers });
      if (origin) Object.assign(headers, { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Allow-Methods': 'GET,POST,PATCH,OPTIONS', 'Access-Control-Allow-Credentials': 'true' });
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
      try {
        const result = await route(request);
        if (result.raw !== undefined) return new Response(result.raw, { status: result.status || 200, headers: { ...headers, ...result.headers } });
        return new Response(JSON.stringify({ api_version: 1, ...result.body }), { status: result.status || 200, headers });
      } catch (error) {
        const known = error instanceof ApiError || error instanceof SubmissionError;
        const status = error.status || (error instanceof SubmissionError ? error.code === 'payload_too_large' ? 413 : 422 : 500);
        if (!known && env.onError) env.onError(requestId, error);
        if (status === 429 || status === 503) headers['Retry-After'] = '60';
        return new Response(JSON.stringify({ api_version: 1, error: { code: known ? error.code : 'internal_error', message: known ? error.message : '服务暂时不可用，原文件请保留', retryable: status === 429 || status >= 500, fields: error.fields || (error.path ? [{ path: error.path, code: error.code }] : []) }, request_id: requestId }), { status, headers });
      }
    }
  };
}
