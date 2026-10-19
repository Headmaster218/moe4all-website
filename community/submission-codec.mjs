import { inflateSingleGzip } from './vendor/gzip.mjs';
import { MAX_ARMOR_BYTES, MAX_DECODED_BYTES } from './submission-limits.mjs';
export { MAX_ARMOR_BYTES, MAX_DECODED_BYTES } from './submission-limits.mjs';

export const ARMOR_VERSION = 'MOE4ALL-SUBMISSION/1';
const BEGIN = '-----BEGIN MOE4ALL PAYLOAD-----';
const END = '-----END MOE4ALL PAYLOAD-----';
const encoder = new TextEncoder();
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const number = value => typeof value === 'number' && Number.isFinite(value);
const integer = value => Number.isSafeInteger(value) && value >= 0;

export class SubmissionError extends Error {
  constructor(code, message, path = '') { super(message); this.code = code; this.path = path; }
}
function fail(code, message, path = '') { throw new SubmissionError(code, message, path); }
export async function sha256(bytes) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(n => n.toString(16).padStart(2, '0')).join('');
}

export function parseStrictJson(text) {
  let value;
  try { value = JSON.parse(text); } catch { fail('invalid_json', 'JSON 语法无效'); }
  // JSON.parse validates grammar; this lexical pass preserves duplicate-key information it discards.
  const stack = [];
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '{') stack.push(new Set());
    else if (ch === '[') stack.push(null);
    else if (ch === '}' || ch === ']') stack.pop();
    else if (ch === '"') {
      const start = i++;
      for (; i < text.length; i++) { if (text[i] === '\\') i++; else if (text[i] === '"') break; }
      let next = i + 1;
      while (/\s/.test(text[next] || '') && next < text.length) next++;
      if (text[next] === ':') {
        const key = JSON.parse(text.slice(start, i + 1)), keys = stack.at(-1);
        if (!keys || keys.has(key)) fail('invalid_json', 'JSON 包含重复字段');
        if (['__proto__', 'constructor', 'prototype'].includes(key)) fail('invalid_json', 'JSON 包含保留字段');
        keys.add(key);
      }
    }
  }
  const visit = (item, depth) => {
    if (depth > 48) fail('schema_invalid', 'JSON 嵌套过深');
    if (typeof item === 'number' && (!Number.isFinite(item) || (Number.isInteger(item) && !Number.isSafeInteger(item)))) fail('schema_invalid', 'JSON 数值超出安全范围');
    if (item && typeof item === 'object') for (const child of Object.values(item)) visit(child, depth + 1);
  };
  visit(value, 0);
  return value;
}

// Rust/Python format binary64 with round-to-nearest, ties-to-even; Number.toFixed differs at ties.
export function fixed2(value) {
  const view = new DataView(new ArrayBuffer(8)); view.setFloat64(0, Math.abs(value));
  const bits = view.getBigUint64(0), exponent = Number((bits >> 52n) & 2047n);
  let numerator = ((exponent ? 1n << 52n : 0n) | (bits & ((1n << 52n) - 1n))) * 100n;
  const power = (exponent || 1) - 1023 - 52;
  let result;
  if (power >= 0) result = numerator << BigInt(power);
  else {
    const denominator = 1n << BigInt(-power), remainder = numerator % denominator;
    result = numerator / denominator;
    if (remainder * 2n > denominator || (remainder * 2n === denominator && result % 2n)) result++;
  }
  return `${value < 0 || Object.is(value, -0) ? '-' : ''}${result / 100n}.${String(result % 100n).padStart(2, '0')}`;
}
export function oneLine(value, max) {
  let out = '', previousSpace = false, count = 0;
  for (let ch of String(value)) {
    const n = ch.codePointAt(0);
    if (n <= 31 || (n >= 127 && n <= 159)) ch = ' ';
    if (/\s/u.test(ch)) { if (previousSpace) continue; previousSpace = true; out += ' '; }
    else { previousSpace = false; out += ch; }
    if (++count >= max) { out += '...'; break; }
  }
  return out.trim();
}
export function generatedSummary(kind, p) {
  const gib = (n, unknown) => integer(n) ? `${fixed2(n / 1073741824)} GiB` : unknown;
  if (kind === 'benchmark') {
    const lines = [`model: ${p.model?.name ?? 'unknown model'} | ${p.model?.architecture ?? 'unknown'} | ${gib(p.model?.storage_bytes, 'unknown size')}`, `device: ${p.hardware?.gpu?.name ?? 'unknown device'} | ${gib(p.hardware?.gpu?.vram_total_bytes, 'unknown VRAM')}`];
    if (typeof p.profile === 'string') lines.push(`profile: ${p.profile}`);
    for (const c of p.contexts || []) {
      const n = c.requested_context_tokens || 0, label = n > 0 && n % 1024 === 0 ? `${n / 1024}K` : String(n), rates = [];
      if (number(c.prefill?.tokens_per_second)) rates.push(`prefill=${fixed2(c.prefill.tokens_per_second)}`);
      for (const d of c.decode || []) if (number(d.overall_tokens_per_second)) rates.push(`x${d.parallel || 0}=${fixed2(d.overall_tokens_per_second)}`);
      if (number(c.manual_result?.average_tokens_per_second)) rates.push(`manual=${fixed2(c.manual_result.average_tokens_per_second)}`);
      if (rates.length) lines.push(`result ${label}: ${rates.join(' | ')} tok/s`);
    }
    return lines;
  }
  const lines = [`failure: ${p.failure_kind ?? 'unknown'}`];
  if (typeof p.model?.name === 'string') lines.push(`model: ${p.model.name}`);
  if (typeof p.hardware?.gpu?.name === 'string') lines.push(`device: ${p.hardware.gpu.name}`);
  if (typeof p.description === 'string' && oneLine(p.description, 240)) lines.push(`description: ${oneLine(p.description, 240)}`);
  if (typeof p.error?.message === 'string') lines.push(`error: ${oneLine(p.error.message, 240)}`);
  return lines;
}

export function inspectHeaders(input) {
  const bytes = typeof input === 'string' ? encoder.encode(input) : input;
  if (bytes.byteLength > MAX_ARMOR_BYTES) fail('payload_too_large', '封装文件超过 512 KiB');
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); } catch { fail('invalid_envelope', '文件不是有效 UTF-8'); }
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  if (lines[0] !== ARMOR_VERSION) fail('invalid_envelope', '不是 MOE4ALL-SUBMISSION/1 文件');
  const begin = lines.indexOf(BEGIN), end = lines.indexOf(END, begin + 1), headers = Object.create(null);
  if (begin < 1 || end < begin || lines.slice(end + 1).some(line => line.trim())) fail('invalid_envelope', '封装边界不完整或含多余内容');
  for (const line of lines.slice(1, begin)) {
    if (!line.trim()) continue;
    const match = /^\s*([a-zA-Z0-9-]+)\s*:\s*(.*?)\s*$/.exec(line);
    if (!match) fail('invalid_envelope', '封装 header 无效');
    const name = match[1].toLowerCase();
    if (Object.hasOwn(headers, name)) fail('invalid_envelope', '封装 header 重复');
    headers[name] = match[2];
  }
  if (!['benchmark', 'error'].includes(headers.kind) || headers.schema !== `${headers.kind}/1` || headers.encoding !== 'gzip+base64') fail('invalid_envelope', '类型、schema 或编码不支持');
  for (const [key, limit] of [['decoded-bytes', MAX_DECODED_BYTES], ['compressed-bytes', MAX_ARMOR_BYTES], ['summary-count', 512]]) {
    if (!/^\d+$/.test(headers[key] || '') || !Number.isSafeInteger(Number(headers[key])) || Number(headers[key]) > limit) fail('invalid_envelope', '封装长度声明无效或超限');
  }
  if (!/^[a-f0-9]{64}$/.test(headers.sha256 || '') || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/.test(headers.id || '')) fail('invalid_envelope', '报告 ID 或摘要无效');
  if (!headers['created-at'] || !headers.engine || !Number.isFinite(Date.parse(headers['created-at']))) fail('invalid_envelope', '缺少有效时间或引擎版本');
  const payloadLines = lines.slice(begin + 1, end).map(line => line.trim()).filter(Boolean);
  const base64 = payloadLines.join('');
  if (!base64 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64)) fail('invalid_envelope', 'Base64 编码无效');
  const summary = [];
  for (let i = 1; i <= Number(headers['summary-count']); i++) {
    const line = headers[`summary-${String(i).padStart(3, '0')}`];
    if (typeof line !== 'string') fail('invalid_envelope', '摘要行缺失');
    summary.push(line);
  }
  if (Object.keys(headers).some(key => key.startsWith('summary-') && key !== 'summary-count' && !Array.from({ length: summary.length }, (_, i) => `summary-${String(i + 1).padStart(3, '0')}`).includes(key))) fail('invalid_envelope', '多余摘要行');
  return { text, bytes, headers, summary, base64, kind: headers.kind, id: headers.id, extension: headers.kind === 'benchmark' ? '.m4b' : '.m4e' };
}

export function validatePayload(kind, p, { submission = true } = {}) {
  const require = (ok, message, path) => { if (!ok) fail('schema_invalid', message, path); };
  require(object(p) && p.schema_version === 1, 'payload schema_version 必须为 1', '/schema_version');
  require(typeof p.id === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/.test(p.id), '报告 ID 无效', '/id');
  require(typeof p.created_at_utc === 'string' && /(?:Z|\+00:00)$/.test(p.created_at_utc) && Number.isFinite(Date.parse(p.created_at_utc)), '时间必须为 UTC', '/created_at_utc');
  require(typeof p.engine_version === 'string' && p.engine_version.length > 0 && p.engine_version.length <= 128, '缺少引擎版本', '/engine_version');
  const rate = (r, path) => require(number(r) && r >= 0 && r <= 1e8, '吞吐量无效', path);
  if (kind === 'benchmark') {
    require(['quick', 'standard', 'full', 'manual'].includes(p.profile), '测试 profile 无效', '/profile');
    require(object(p.model) && object(p.hardware) && object(p.configuration), '缺少模型、硬件或配置', '/hardware');
    require(typeof p.model.name === 'string' && p.model.name.length > 0 && [...p.model.name].length <= 1024, '模型名称必须为有效文本', '/model/name');
    const optionalText = (value, path) => require(value == null || (typeof value === 'string' && [...value].length <= 1024), '字段必须为文本或 null', path);
    const optionalBytes = (value, path) => require(value == null || integer(value), '容量必须为非负安全整数或 null', path);
    optionalText(p.model.architecture, '/model/architecture'); optionalText(p.model.quant, '/model/quant'); optionalText(p.model.quantization, '/model/quantization');
    optionalBytes(p.model.storage_bytes, '/model/storage_bytes'); optionalText(p.hardware.os, '/hardware/os');
    for (const key of ['gpu', 'cpu', 'ram']) require(p.hardware[key] == null || object(p.hardware[key]), '硬件信息必须为对象或 null', '/hardware/' + key);
    optionalText(p.hardware.gpu?.name, '/hardware/gpu/name'); optionalText(p.hardware.gpu?.configured_device, '/hardware/gpu/configured_device'); optionalText(p.hardware.cpu?.name, '/hardware/cpu/name');
    optionalBytes(p.hardware.gpu?.vram_total_bytes, '/hardware/gpu/vram_total_bytes'); optionalBytes(p.hardware.ram?.total_bytes, '/hardware/ram/total_bytes');
    for (const key of ['backend', 'device', 'kv_type_k', 'kv_type_v']) optionalText(p.configuration[key], '/configuration/' + key);
    require(p.configuration.mtp == null || typeof p.configuration.mtp === 'boolean', 'MTP 必须为布尔值或 null', '/configuration/mtp');
    for (const key of ['ubatch', 'repetitions']) optionalBytes(p.configuration[key], '/configuration/' + key);
    require(Array.isArray(p.contexts) && p.contexts.length > 0 && p.contexts.length <= 64, 'contexts 必须为非空数组', '/contexts');
    const contexts = new Set();
    for (const [i, c] of p.contexts.entries()) {
      const path = `/contexts/${i}`;
      require(object(c) && integer(c.requested_context_tokens) && !contexts.has(c.requested_context_tokens), '上下文无效或重复', path);
      contexts.add(c.requested_context_tokens);
      require(Array.isArray(c.failures) && Array.isArray(c.decode) && c.decode.length <= 64, '缺少 decode / failures 数组', path);
      if (c.prefill !== null && c.prefill !== undefined) { require(object(c.prefill), 'Prefill 无效', path); rate(c.prefill.tokens_per_second, path + '/prefill/tokens_per_second'); }
      if (p.profile === 'manual') { require(object(c.manual_result), '手动测试缺少原始结果', path); rate(c.manual_result.average_tokens_per_second, path + '/manual_result'); }
      else require(c.prefill != null || c.failures.length > 0, '需要 Prefill 结果或失败记录', path);
      const slots = new Set();
      for (const [j, d] of c.decode.entries()) {
        require(object(d) && integer(d.parallel) && d.parallel > 0 && d.parallel <= 64 && !slots.has(d.parallel), '并发无效或重复', path + `/decode/${j}`); slots.add(d.parallel);
        rate(d.overall_tokens_per_second, path + `/decode/${j}`);
        require(Array.isArray(d.repetitions) && d.repetitions.length > 0 && d.repetitions.length <= 100, '缺少实测轮次', path + `/decode/${j}/repetitions`);
        require(Array.isArray(d.section_mean_tokens_per_second) && d.section_mean_tokens_per_second.length === 3, '缺少前中后段指标', path);
        d.section_mean_tokens_per_second.forEach(r => rate(r, path));
        for (const [k, rep] of d.repetitions.entries()) {
          const repPath = path + `/decode/${j}/repetitions/${k}`;
          require(object(rep) && object(rep.overall) && Array.isArray(rep.sections) && rep.sections.length === 3, '实测轮次缺少 overall / sections', repPath);
          for (const section of [...rep.sections, rep.overall]) {
            require(object(section) && integer(section.tokens) && number(section.seconds) && section.seconds >= 0, '轮次 token 数或耗时无效', repPath);
            rate(section.tokens_per_second, repPath);
          }
          require(Array.isArray(rep.lane_tokens_per_second) && rep.lane_tokens_per_second.length === 3 && rep.lane_tokens_per_second.every(lanes => Array.isArray(lanes) && lanes.length === d.parallel), '每路速度矩阵与并发不匹配', repPath);
          rep.lane_tokens_per_second.flat().forEach(value => rate(value, repPath));
        }
      }
    }
  } else {
    const allowed = ['schema_version', 'id', 'created_at_utc', 'engine_version', 'engine_commit', 'failure_kind', 'description', 'engine', 'hardware', 'model', 'launch', 'error', 'logs', 'privacy'];
    require(Object.keys(p).every(key => allowed.includes(key)), '报错包含未约定字段', '');
    require(typeof p.failure_kind === 'string' && p.failure_kind.length <= 80, '缺少失败类型', '/failure_kind');
    require(typeof p.description === 'string' && [...p.description].length <= 4096, '问题描述最多 4096 字符', '/description');
    if (submission) require(p.description.trim().length > 0, '请在引擎向导中补充问题描述后重新导出', '/description');
    require(object(p.error) && typeof p.error.message === 'string' && Array.isArray(p.error.chain), '错误信息无效', '/error');
    require(object(p.logs) && Array.isArray(p.logs.startup) && Array.isArray(p.logs.tail) && p.logs.startup.length <= 220 && p.logs.tail.length <= 12, '诊断日志范围超限', '/logs');
    require([...p.logs.startup, ...p.logs.tail, ...p.error.chain].every(line => typeof line === 'string'), '日志必须为文本行', '/logs');
    require(encoder.encode([...p.logs.startup, ...p.logs.tail].join('')).length <= 32768, '诊断日志超过 32 KiB', '/logs');
    require(p.logs.speed_statistics_included === false && p.privacy?.prompt_or_response_included === false && p.privacy?.api_keys_included === false && p.privacy?.local_paths_redacted === true, '隐私标记不满足提交要求', '/privacy');
  }
  return p;
}

export async function decodeSubmission(input, options = {}) {
  const result = inspectHeaders(input), { headers } = result;
  let compressed;
  try { compressed = Uint8Array.from(atob(result.base64), c => c.charCodeAt(0)); } catch { fail('invalid_envelope', 'Base64 无效'); }
  if (btoa(Array.from(compressed, byte => String.fromCharCode(byte)).join('')) !== result.base64) fail('invalid_envelope', 'Base64 padding 无效');
  if (compressed.length !== Number(headers['compressed-bytes'])) fail('invalid_envelope', '压缩字节数不匹配');
  let decoded;
  try { decoded = inflateSingleGzip(compressed, MAX_DECODED_BYTES); } catch { fail('invalid_envelope', 'gzip 损坏、多 member 或解压大小超限'); }
  if (decoded.length !== Number(headers['decoded-bytes'])) fail('invalid_envelope', '解压字节数不匹配');
  if (await sha256(decoded) !== headers.sha256) fail('invalid_envelope', 'payload SHA-256 不匹配');
  let json;
  try { json = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(decoded); } catch { fail('invalid_json', 'payload 不是有效 UTF-8'); }
  const payload = parseStrictJson(json);
  validatePayload(result.kind, payload, options);
  if (payload.id !== headers.id || payload.created_at_utc !== headers['created-at'] || headers.engine !== oneLine(payload.engine_version, 80)) fail('invalid_envelope', 'header 与 payload 身份不一致');
  const summary = generatedSummary(result.kind, payload).map(line => oneLine(line, 500));
  if (JSON.stringify(summary) !== JSON.stringify(result.summary)) fail('invalid_envelope', '可读摘要与 payload 不一致');
  if (options.filename && options.filename !== result.id + result.extension) fail('file_mismatch', '文件名与报告 ID / 类型不一致');
  return { ...result, payload, payloadSha256: headers.sha256, fileSha256: await sha256(result.bytes), sizeBytes: result.bytes.byteLength, decodedBytes: decoded.length };
}

export function privacyFindings(payload) {
  const hits = [];
  const walk = (value, path = '') => {
    if (typeof value === 'string') {
      if (/\bBearer\s+(?!\[REDACTED\]|<redacted>)[A-Za-z0-9._~+/-]{8,}|\bsk-[A-Za-z0-9_-]{12,}|\b(?:api[_-]?key|password|secret)\s*[=:]\s*["']?(?!\[REDACTED\]|<redacted>|null\b|false\b|true\b)[A-Za-z0-9._~+/-]{8,}/i.test(value)) hits.push({ path, code: 'credential' });
      if (/[A-Za-z]:[\\/](?!\[)|\/(?:home|Users)\/(?!\[)[^\s/]+/i.test(value)) hits.push({ path, code: 'local_path' });
    } else if (value && typeof value === 'object') for (const [key, item] of Object.entries(value)) {
      if (/^(?:hostname|serial_number|serial|username|user_name|prompt|response|messages|api_key|password|private_redactions)$/i.test(key)) hits.push({ path: `${path}/${key}`, code: 'private_field' });
      else walk(item, `${path}/${key}`);
    }
  };
  walk(payload);
  return hits.slice(0, 20);
}

export function benchmarkRows(payload) {
  const rows = [], c = payload.configuration || {}, h = payload.hardware || {}, gpu = h.gpu || {};
  const policy = typeof c.auto_profile === 'string' ? c.auto_profile.trim().toLowerCase() : '';
  const autoProfile = ['aggressive', 'conservative', 'manual'].includes(policy) ? policy : null;
  for (const context of payload.contexts || []) {
    const cases = payload.profile === 'manual' ? [{ parallel: 1, overall_tokens_per_second: context.manual_result?.kind === 'decode' ? context.manual_result.average_tokens_per_second : null, manual: true }] : context.decode;
    for (const d of cases || []) rows.push({
      id: `${payload.id}:${context.requested_context_tokens}:${d.parallel}`, report_id: payload.id,
      model: payload.model?.name || '未提供模型', architecture: payload.model?.architecture || null,
      quant: payload.model?.quantization || payload.model?.quant || null,
      gpu: gpu.name || gpu.configured_device || '未提供设备', cpu: h.cpu?.name || null,
      ram_bytes: h.ram?.total_bytes ?? null, vram_bytes: gpu.vram_total_bytes ?? null,
      os: h.os || null, backend: c.backend || c.device || null, engine: payload.engine_version,
      context: context.requested_context_tokens, slots: d.parallel, mtp: c.mtp ?? null,
      kv_k: c.kv_type_k || null, kv_v: c.kv_type_v || null, ubatch: c.ubatch || null,
      profile: payload.profile, auto_profile: autoProfile, date: payload.created_at_utc, decode: d.overall_tokens_per_second,
      prefill: context.prefill?.tokens_per_second ?? (context.manual_result?.kind === 'prefill' ? context.manual_result.average_tokens_per_second : null),
      sections: d.section_mean_tokens_per_second || null, rounds: d.repetitions?.length || c.repetitions || null,
      failure_count: context.failures.length, source: 'community', authenticity: 'self_reported'
    });
  }
  return rows;
}
