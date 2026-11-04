export const strategyNames = { aggressive: '自动激进', conservative: '自动保守', manual: '手动配置', unknown: '未提供策略' };
export const strategyOf = row => Object.hasOwn(strategyNames, row.auto_profile) ? row.auto_profile : 'unknown';
export const capacityGiB = value => Number.isFinite(value) && value > 0 ? Math.round(value / 1073741824) : null;
export function rangeBounds(rows, key, metadata) {
  const provided = metadata?.[key];
  if (provided && Number.isFinite(provided.min) && Number.isFinite(provided.max) && provided.min <= provided.max) return provided;
  let min = Infinity, max = -Infinity;
  for (const row of rows) { const value = key === 'context' ? row.context : capacityGiB(row[key + '_bytes']); if (Number.isFinite(value) && value >= 0) { min = Math.min(min, value); max = Math.max(max, value); } }
  return Number.isFinite(min) ? { min, max } : { min: null, max: null };
}
export const cohortKey = row => JSON.stringify([row.model, row.quant, row.context, row.slots, row.mtp, row.kv_k, row.kv_v, row.engine, strategyOf(row), row.profile, row.kind, row.depth_mode, row.depth_tokens, row.prompt_tokens, row.warmup_tokens, row.measured_tokens]);
export const filterValues = value => (Array.isArray(value) ? value : value === undefined || value === '' ? [] : [value]).map(String);
// A report may use the GGUF filename or its model name. Keep quantization,
// revision and shard suffixes intact; only the optional file extension is cosmetic.
export const modelKey = value => String(value ?? '').trim().replace(/\.gguf$/i, '');
export const modelLabel = modelKey;
export const modelOptions = rows => [...new Set(rows.map(row => modelKey(row.model)))].sort((a, b) => a.localeCompare(b)).map(value => [value, modelLabel(value)]);
export const GPU_GROUPS = Object.freeze([
  { id: 'amd', label: 'AMD' }, { id: 'nvidia', label: '英伟达' },
  { id: 'intel', label: '英特尔' }, { id: 'other', label: '其他' }
]);
export function gpuGroup(value) {
  const name = String(value ?? '');
  if (/\b(?:AMD|ATI|Radeon)\b/i.test(name)) return 'amd';
  if (/\b(?:NVIDIA|GeForce|Quadro|Tesla|NVS)\b|\b(?:RTX|GTX)\s*\d/i.test(name)) return 'nvidia';
  if (/\bIntel\b|\bArc(?:\(TM\))?\s+(?:[AB]\d|Pro\b)|\bIris\b|\bUHD\s+Graphics\b/i.test(name)) return 'intel';
  return 'other';
}
export function gpuGroups(options) {
  return GPU_GROUPS.map(group => ({ ...group, options: options.filter(([value]) => gpuGroup(value) === group.id) }));
}
const budget = (resolved, configured, kind) => {
  if (Number.isSafeInteger(resolved) && resolved >= 0) return { bytes: resolved, text: null, kind };
  if (typeof configured === 'string' && configured.trim()) {
    const original = configured.trim();
    let value = original;
    // Older reports serialized Option<SizeSpec> with Rust's Debug formatter.
    // Decode only known variants; never evaluate arbitrary configuration text.
    for (let depth = 0; depth < 8; depth++) {
      const option = /^Some\(\s*([\s\S]*)\s*\)$/.exec(value);
      if (!option) break;
      value = option[1].trim();
    }
    if (/^None$/i.test(value)) return { bytes: null, text: null, kind: 'missing' };
    const absolute = /^(?:Bytes|FrozenAutomaticBytes)\(\s*(\d+)\s*\)$/.exec(value);
    const digits = absolute?.[1] ?? (/^\d+$/.test(value) ? value : null);
    if (digits !== null && Number.isSafeInteger(Number(digits))) return { bytes: Number(digits), text: null, kind: 'configured' };
    // INFR's documented `g` alias uses GiB, including in older manual reports.
    const gib = /^(\d+(?:\.\d+)?)\s*(?:g|gib)$/i.exec(value);
    const gibBytes = gib ? Number(gib[1]) * 1073741824 : NaN;
    if (Number.isSafeInteger(gibBytes) && gibBytes >= 0) return { bytes: gibBytes, text: null, kind: 'configured' };
    const percentage = /^Percent\(\s*([+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)\s*\)$/.exec(value);
    const percent = percentage ? Number(percentage[1]) * 100 : NaN;
    // SizeSpec::Percent stores a fraction (0.8 means 80%), not a byte count.
    if (Number.isFinite(percent) && percent > 0) return { bytes: null, text: Number(percent.toPrecision(12)) + '%', kind: 'configured' };
    return { bytes: null, text: original, kind: 'configured' };
  }
  return { bytes: null, text: null, kind: 'missing' };
};
// These are allocation ceilings / resident targets, not sampled process memory.
export const engineBudget = row => ({ ram: budget(row.actual_ram_budget, row.ram_budget, 'target'), vram: budget(row.actual_vram_budget, row.vram_budget, 'ceiling') });
export function rowConcurrency(row) {
  if (row.kind === 'prefill' || row.kind === 'manual_prefill') return null;
  return Number.isSafeInteger(row.slots) && row.slots > 0 ? row.slots : null;
}
export const BENCHMARK_PAGE_SIZE = 25;
export function resultPage(rows, requestedPage = 1) {
  const pages = Math.max(1, Math.ceil(rows.length / BENCHMARK_PAGE_SIZE));
  const pageNumber = Math.max(1, Math.min(Number.isInteger(requestedPage) ? requestedPage : 1, pages));
  const offset = (pageNumber - 1) * BENCHMARK_PAGE_SIZE;
  return { pageNumber, offset, rows: rows.slice(offset, offset + BENCHMARK_PAGE_SIZE), end: Math.min(offset + BENCHMARK_PAGE_SIZE, rows.length), hasPrevious: pageNumber > 1, hasNext: pageNumber < pages };
}
export function rangeError(min, max, unit = '') {
  const present = value => value !== '' && value !== undefined && value !== null;
  if ([min, max].some(value => present(value) && (!Number.isSafeInteger(Number(value)) || Number(value) < 0))) return '请输入非负整数' + unit;
  return present(min) && present(max) && Number(min) > Number(max) ? '下限不能大于上限' : '';
}
export function filterRows(rows, filters) {
  const selected = Object.fromEntries(['model', 'gpu', 'context', 'slots', 'engine', 'kv', 'mtp', 'os', 'status', 'strategy', 'ram', 'vram'].map(key => [key, new Set(filterValues(filters[key]))]));
  selected.model = new Set([...selected.model].map(modelKey));
  const search = (filters.search || '').trim().toLowerCase();
  const ranges = Object.fromEntries(['context', 'ram', 'vram'].map(key => { const min = filters[key + 'Min'], max = filters[key + 'Max']; return [key, { min: min === '' || min === undefined || min === null ? null : Number(min), max: max === '' || max === undefined || max === null ? null : Number(max), invalid: !!rangeError(min, max) }]; }));
  const matches = (key, value) => !selected[key].size || selected[key].has(key === 'model' ? modelKey(value) : String(value));
  const inRange = (value, key) => {
    const { min, max, invalid } = ranges[key];
    if (min === null && max === null) return true;
    return value !== null && Number.isFinite(value) && !invalid && (min === null || value >= min) && (max === null || value <= max);
  };
  return rows.filter(r => matches('model', r.model) && matches('gpu', r.gpu) && (filters.contextMode === 'range' ? inRange(r.context, 'context') : matches('context', r.context)) && matches('slots', r.slots) && matches('engine', r.engine) && matches('kv', `${r.kv_k || '?'}/${r.kv_v || '?'}`) && matches('mtp', r.mtp) && matches('os', r.os) && matches('status', r.status) && matches('strategy', strategyOf(r)) && matches('ram', capacityGiB(r.ram_bytes) ?? 'unknown') && matches('vram', capacityGiB(r.vram_bytes) ?? 'unknown') && inRange(capacityGiB(r.ram_bytes), 'ram') && inRange(capacityGiB(r.vram_bytes), 'vram') && (!search || `${r.gpu} ${r.cpu || ''} ${r.os || ''} ${r.model} ${r.storage_model || ''}`.toLowerCase().includes(search)));
}
export function comparisonError(rows, candidate) {
  if (rows.some(r => r.id === candidate.id)) return '';
  if (rows.length >= 3) return '最多对比三个样本';
  return rows.length && cohortKey(rows[0]) !== cohortKey(candidate) ? '请在相同模型、上下文、并发、KV、MTP、版本、配置策略和测量协议下对比' : '';
}
export function csv(rows) {
  const columns = ['report_id', 'date', 'gpu', 'cpu', 'model', 'engine', 'context', 'slots', 'auto_profile', 'ram_bytes', 'vram_bytes', 'pcie_generation', 'pcie_width', 'storage_model', 'storage_seq', 'storage_cache', 'configured_ubatch', 'actual_ubatch', 'profile', 'kind', 'status', 'rounds', 'decode', 'prefill', 'demo'];
  const cell = value => { let s = String(value ?? ''); if (/^[=+@\-\t\r]/.test(s)) s = "'" + s; return '"' + s.replace(/"/g, '""') + '"'; };
  return [columns.map(cell).join(','), ...rows.map(r => columns.map(k => cell(r[k])).join(','))].join('\r\n');
}
