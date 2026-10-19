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
export function rangeError(min, max, unit = '') {
  const present = value => value !== '' && value !== undefined && value !== null;
  if ([min, max].some(value => present(value) && (!Number.isSafeInteger(Number(value)) || Number(value) < 0))) return '请输入非负整数' + unit;
  return present(min) && present(max) && Number(min) > Number(max) ? '下限不能大于上限' : '';
}
export function filterRows(rows, filters) {
  const selected = Object.fromEntries(['model', 'gpu', 'context', 'slots', 'engine', 'kv', 'mtp', 'os', 'status', 'strategy', 'ram', 'vram'].map(key => [key, new Set(filterValues(filters[key]))]));
  const search = (filters.search || '').trim().toLowerCase();
  const ranges = Object.fromEntries(['context', 'ram', 'vram'].map(key => { const min = filters[key + 'Min'], max = filters[key + 'Max']; return [key, { min: min === '' || min === undefined || min === null ? null : Number(min), max: max === '' || max === undefined || max === null ? null : Number(max), invalid: !!rangeError(min, max) }]; }));
  const matches = (key, value) => !selected[key].size || selected[key].has(String(value));
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
