import { MAX_ARMOR_BYTES } from './submission-limits.mjs';
import { filterRows, filterValues, comparisonError, csv, strategyNames, strategyOf, capacityGiB, rangeBounds } from './ui-model.mjs';
import { loadLeaderboard } from './leaderboard-loader.mjs';
import { assembleIndex, indexRows, provenanceLinks } from './leaderboard-model.mjs';

const config = window.MOE4ALL_COMMUNITY_CONFIG || {}, $ = selector => document.querySelector(selector);
const publicPr = config.reviewMode === 'github_pr';
const preview = config.mode === 'local';
const consentFor = kind => kind === 'benchmark' ? 'public_benchmark' : publicPr ? 'public_error' : 'private_error';
const escape = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const icon = name => `<i data-lucide="${({ check: 'circle-check', 'sliders-horizontal': 'settings-2', 'rotate-ccw': 'history', 'refresh-cw': 'history', github: 'code-xml' })[name] || name}"></i>`;
const fmt = value => typeof value === 'number' ? value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—';
const bytes = value => value >= 1048576 ? (value / 1048576).toFixed(2) + ' MiB' : (value / 1024).toFixed(1) + ' KiB';
const gib = value => typeof value === 'number' ? (value / 1073741824).toFixed(0) + 'G' : '—';
const contextLabel = value => value > 0 && value % 1024 === 0 ? value / 1024 + 'K' : Number(value).toLocaleString('en-US');
const flag = value => value === null || value === undefined ? '未提供' : value ? 'ON' : 'OFF';
const slotsLabel = row => row.kind === 'prefill' || row.kind === 'manual_prefill' ? 'Prefill' : row.slots === null ? '并发未提供' : '×' + row.slots;
const resultStatus = { ok: '完成', partial: '部分失败', failed: '失败' };
const statusNames = { pending_review: '待审核', archiving: '归档中', published: '已收录', rejected: '已退回', triaged: '已归组', investigating: '排查中', resolved: '已修复' };
const button = (action, text, name, cls = '', extra = '') => `<button class="button ${cls}" data-action="${action}" ${extra}>${icon(name)}${escape(text)}</button>`;
const iconButton = (action, name, title, extra = '') => `<button class="icon-button" data-action="${action}" title="${escape(title)}" aria-label="${escape(title)}" ${extra}>${icon(name)}</button>`;
const tag = (text, color = '') => `<span class="tag ${color}">${escape(text)}</span>`;
const stateTag = status => tag(statusNames[status] || status, status === 'published' || status === 'resolved' ? 'mint' : status === 'rejected' ? 'red' : 'amber');
const heading = (title, eyebrow, subtitle, actions = '') => `<div class="heading"><div><div class="eyebrow">${eyebrow}</div><h1>${title}</h1><p class="subtitle">${subtitle}</p></div><div class="actions">${actions}</div></div>`;
const stat = (label, value, unit, foot) => `<div class="stat"><div class="stat-label">${label}</div><div class="stat-value">${value}<small>${unit}</small></div><div class="stat-foot">${foot}</div></div>`;
const empty = (title, text, name = 'folder-open') => `<div class="empty">${icon(name)}<h2>${title}</h2><p>${text}</p></div>`;
const storageKey = 'moe4all-submission-receipts-v1';
const blankFilters = () => ({ model: [], gpu: [], context: [], contextMode: 'range', contextMin: '', contextMax: '', slots: [], strategy: [], ram: [], vram: [], ramMin: '', ramMax: '', vramMin: '', vramMax: '', engine: [], mtp: [], kv: [], os: [], status: [], search: '' });
let receipts = [];
try { receipts = JSON.parse(localStorage.getItem(storageKey) || '[]').filter(r => r && typeof r.receipt_id === 'string' && typeof r.receipt_token === 'string').slice(0, 100); } catch {}
const fragment = new URLSearchParams(location.hash.slice(1));
let confirmation = fragment.has('session') && fragment.has('authorize') ? { id: fragment.get('session'), token: fragment.get('authorize') } : null;
if (confirmation) history.replaceState(null, '', location.pathname + location.search);
const state = { page: confirmation ? 'confirmation' : location.hash === '#receipts' ? 'receipts' : document.body.dataset.page, index: null, dataInfo: null, rows: [], bounds: null, filters: blankFilters(), filtersOpen: true, metric: 'decode', selected: '', compare: [], pageNumber: 1, uploadKind: new URLSearchParams(location.search).get('kind') === 'error' ? 'error' : 'benchmark', file: null, decoded: null, fileError: '', header: null, processing: false, uploading: false, uploaded: null, uploadSession: null, adminTab: 'benchmark', overview: null, confirmation: null, confirmDone: null };
let toastTimer, fileSequence = 0;
function icons() { window.lucide?.createIcons(); }
function toast(text) { clearTimeout(toastTimer); $('#toast').textContent = text; $('#toast').classList.add('visible'); toastTimer = setTimeout(() => $('#toast').classList.remove('visible'), 4200); }
function persistReceipts() { try { localStorage.setItem(storageKey, JSON.stringify(receipts)); } catch { toast('浏览器无法保存回执，请下载一份到本地'); } }
function download(name, value, type = 'application/json') { const url = URL.createObjectURL(new Blob([value], { type })), a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 5000); }
async function api(path, options = {}) {
  if (!config.apiBase) throw new Error('上传后端尚未配置，请使用本地服务预览');
  const response = await fetch(config.apiBase + path, { credentials: 'include', redirect: 'error', ...options, headers: { Accept: 'application/json', ...options.headers }, signal: AbortSignal.timeout(30000) });
  let value; try { value = await response.json(); } catch { throw new Error('服务器返回了无法识别的响应，上传未确认'); }
  if (!response.ok) { const error = new Error(value.error?.message || '请求失败'); error.status = response.status; error.code = value.error?.code; throw error; }
  return value;
}
const post = (path, value, token) => api(path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(value) });
function shell() {
  $('#app').innerHTML = `<aside class="sidebar"><a class="brand" href="index.html"><img src="../assets/favicon.svg" alt="" width="33" height="33"><span>MoE4All<small>LAB / 实测与诊断</small></span></a><div class="rail-title"><span class="signal"></span> COMMUNITY WORKSPACE</div><nav aria-label="社区导航"><div class="nav-label">社区数据</div><a class="nav-item ${state.page === 'benchmarks' ? 'active' : ''}" href="index.html">${icon('blocks')}性能排行榜</a><div class="nav-label">参与共建</div><a class="nav-item ${state.page === 'upload' || state.page === 'confirmation' ? 'active' : ''}" href="upload.html">${icon('arrow-up')}提交报告</a><a class="nav-item ${state.page === 'receipts' ? 'active' : ''}" href="index.html#receipts">${icon('folder-open')}我的回执</a><div class="nav-label">维护者</div>${publicPr ? '<a class="nav-item" href="https://github.com/Headmaster218/MoE4All/pulls" target="_blank" rel="noopener noreferrer">' + icon('github') + 'GitHub PR</a>' : '<a class="nav-item" href="admin.html">' + icon('shield-check') + '审核中心</a>'}</nav><div class="sidebar-bottom"><p><span class="signal"></span>MOE4ALL-SUBMISSION/1</p></div></aside><div class="shell"><header class="topbar"><div class="workspace-nav">${iconButton('menu', 'menu', '展开导航')}<a class="technical-return" href="../technical.html">${icon('arrow-left')}<span>返回技术页</span></a></div><div class="topbar-actions"><button class="toolbar-command" data-download title="下载 MoE4All" aria-label="下载 MoE4All">${icon('download')}<span class="toolbar-label">下载</span></button><button class="toolbar-command" data-support title="支持项目" aria-label="支持项目">${icon('coffee')}<span class="toolbar-label">支持项目</span></button><button class="toolbar-command" data-contact title="联系我们" aria-label="联系我们">${icon('message-square')}<span class="toolbar-label">联系我们</span></button></div></header><main id="main" tabindex="-1"></main><footer class="app-footer"><span>MoE4All LAB / HARDWARE IS NOT THE LIMIT.</span><span>MOE4ALL-SUBMISSION/1 · .m4b / .m4e</span></footer></div><div id="compare-tray" class="compare-tray" hidden></div>`;
}
const activeRows = () => filterRows(state.rows, state.filters).sort((a, b) => (b[state.metric] ?? -1) - (a[state.metric] ?? -1) || a.id.localeCompare(b.id));
function selectMetric(metric) {
  state.metric = metric; state.rows = indexRows(state.index, metric); state.bounds = null;
  state.filters.slots = []; state.selected = ''; state.compare = []; state.pageNumber = 1;
}
function detailList(row) {
  const list = pairs => `<dl class="details">${pairs.map(([k, v]) => `<dt>${k}</dt><dd>${escape(v ?? '未提供')}</dd>`).join('')}</dl>`;
  const span = (min, max) => min === null || min === undefined ? '未提供' : min === max ? contextLabel(min) : contextLabel(min) + '–' + contextLabel(max);
  const link = (generation, width) => generation === null || generation === undefined || width === null || width === undefined ? '未提供' : `PCIe ${generation}.0 ×${width}`;
  const cache = { mostly_physical: '主要为物理读', mostly_cached: '主要命中文件缓存', mixed: '混合读取' };
  return list([['模型', row.model], ['量化', row.quant], ['上下文 / 条件', contextLabel(row.context) + ' / ' + slotsLabel(row)], ['显存 / RAM', gib(row.vram_bytes) + ' / ' + gib(row.ram_bytes)], ['CPU', row.cpu], ['系统 / Backend', (row.os || '未提供') + ' / ' + (row.backend || '未提供')], ['KV · K / V', (row.kv_k || '未提供') + ' / ' + (row.kv_v || '未提供')], ['MTP', flag(row.mtp)], ['Ubatch · 配置 / 实际', (row.configured_ubatch ?? '未提供') + ' / ' + (row.actual_ubatch ?? '未提供')], ['引擎版本', row.engine], ['配置策略', strategyNames[strategyOf(row)]], ['完成 / 请求轮次', (row.rounds ?? '未提供') + ' / ' + (row.requested_rounds ?? '未提供')], ['测量结果', resultStatus[row.status] || '未提供']]) +
    `<details class="hardware-details"><summary>硬件与测试条件</summary>${list([['实际 prompt', span(row.prompt_min, row.prompt_max)], ['Decode 计分开始', span(row.start_min, row.start_max)], ['Decode 计分结束', span(row.end_min, row.end_max)], ['测试深度', ({ real: '真实上下文', synthetic: 'Synthetic', none: '无预置深度' })[row.depth_mode] || '未提供'], ['测量协议', row.profile], ['内存', [row.ram_generation, row.ram_speeds?.length ? row.ram_speeds.join(' / ') + ' MT/s' : null].filter(Boolean).join(' · ') || '未提供'], ['统一内存', flag(row.unified_memory)], ['PCIe · 当前', link(row.pcie_generation, row.pcie_width)], ['PCIe · 最大', link(row.pcie_max_generation, row.pcie_max_width)], ['模型盘', row.storage_model], ['介质 / 总线', (row.storage_type || '未提供') + ' / ' + (row.storage_bus || '未提供')], ['顺序读 · 应用可见', row.storage_seq === null || row.storage_seq === undefined ? '未提供' : fmt(row.storage_seq) + ' MiB/s'], ['Random 64K', row.storage_random === null || row.storage_random === undefined ? '未提供' : fmt(row.storage_random) + ' MiB/s'], ['读测缓存情况', cache[row.storage_cache] || '未提供'], ['物理读取占比', row.storage_physical_fraction === null || row.storage_physical_fraction === undefined ? '未提供' : fmt(row.storage_physical_fraction * 100) + '%'], ['RAM / VRAM 配置预算', (row.ram_budget || '未提供') + ' / ' + (row.vram_budget || '未提供')], ['Host DMA', flag(row.host_dma)], ['Submit cap', row.submit_cap], ['失败阶段', row.failure_stages?.join(' / ') || '无已记录失败']])}</details>`;
}
function spark(row) {
  if (!Array.isArray(row.sections)) return '';
  const max = Math.max(...row.sections) * 1.1 || 1, min = Math.min(...row.sections) * .9, points = row.sections.map((n, i) => `${15 + i * 110},${80 - (n - min) / (max - min) * 65}`).join(' ');
  return `<svg class="spark" viewBox="0 0 250 110" role="img" aria-label="前中后段 Decode 实测"><path d="M15 20H235M15 50H235M15 80H235" stroke="var(--line)" stroke-dasharray="3 4" fill="none"/><polyline points="${points}" stroke="var(--mint)" stroke-width="2" fill="none"/>${row.sections.map((n, i) => `<text x="${15 + i * 110}" y="105" fill="var(--muted)" text-anchor="${i === 0 ? 'start' : i === 2 ? 'end' : 'middle'}" font-size="10">${['前段', '中段', '后段'][i]}</text>`).join('')}</svg>`;
}
function inspector(row) {
  if (!row) return empty('暂无样本', '选择一条记录查看条件');
  const links = state.index ? provenanceLinks(state.index, row) : null;
  const source = links ? `<div class="source-actions"><a class="button small" data-provenance="view" href="${escape(links.view)}" target="_blank" rel="noopener noreferrer">${icon('code-xml')}查看原件</a><a class="button small" data-provenance="download" href="${escape(links.download)}" target="_blank" rel="noopener noreferrer">${icon('download')}下载 .m4b</a></div>` : '';
  return `<div class="section-label">SAMPLE INSPECTOR ${iconButton('sample', 'arrow-up-right', '打开样本详情', `data-id="${escape(row.id)}"`)}</div><h2 class="inspect-device">${escape(row.gpu)}</h2><div class="tags">${tag(strategyNames[strategyOf(row)], 'blue')}${tag(contextLabel(row.context) + ' · ' + slotsLabel(row))}${row.status !== 'ok' ? tag(resultStatus[row.status], row.status === 'failed' ? 'red' : 'amber') : ''}</div><div class="inspect-score">${fmt(row[state.metric])}<small>tok/s</small></div>${spark(row)}${detailList(row)}<div class="inspect-foot">${escape(row.report_id)}<br>${escape(row.date || '')}<br>${row.demo ? '本地演示样本' : '社区提交 · 未独立复测'}</div>${source}`;
}
function table(rows) {
  state.pageNumber = Math.max(1, Math.min(state.pageNumber, Math.ceil(rows.length / 8) || 1));
  const offset = (state.pageNumber - 1) * 8, part = rows.slice(offset, offset + 8);
  const body = part.map((r, i) => `<tr class="${state.selected === r.id ? 'selected' : ''}" data-row="${escape(r.id)}">
    <td><input type="checkbox" data-compare="${escape(r.id)}" aria-label="对比 ${escape(r.gpu)}" ${state.compare.includes(r.id) ? 'checked' : ''}></td>
    <td class="rank">${String(offset + i + 1).padStart(2, '0')}</td>
    <td><button class="sort device" data-action="sample" data-id="${escape(r.id)}">${escape(r.gpu)}</button><div class="device-sub">${escape(r.backend || '未提供 Backend')} · ${escape(r.os || '未提供系统')} · v${escape(r.engine)}<br>${escape(modelLabel(r.model))} · ${contextLabel(r.context)} / ${slotsLabel(r)} · MTP ${flag(r.mtp)}<br>${escape(strategyNames[strategyOf(r)])}${r.profile === 'manual' ? ' · 手动实测' : ''}</div></td>
    <td><span class="number">${fmt(r.decode)}</span><div class="device-sub">${r.sections ? '后段 ' + fmt(r.sections[2]) + ' tok/s' : state.metric === 'decode' ? resultStatus[r.status] : '—'}</div></td>
    <td><span class="number secondary">${fmt(r.prefill)}</span><div class="device-sub">${state.metric === 'prefill' && r.status !== 'ok' ? resultStatus[r.status] : 'tok/s'}</div></td>
    <td><span class="mono">${gib(r.vram_bytes)}</span><div class="device-sub">${gib(r.ram_bytes)} RAM</div></td>
    <td><span class="source-name">${r.demo ? '本地演示' : '社区提交'}</span><div class="device-sub">${escape(r.date?.slice(0, 10) || '已收录')}</div></td></tr>`).join('');
  return `<div class="table-scroll"><table class="data-table"><colgroup><col class="col-check"><col class="col-rank"><col class="col-device"><col class="col-rate"><col class="col-rate"><col class="col-memory"><col class="col-source"></colgroup><thead><tr><th>±</th><th>#</th><th>设备 / 环境</th><th><button class="sort" data-action="sort" data-metric="decode" aria-pressed="${state.metric === 'decode'}">Decode ${icon('arrow-down')}</button></th><th><button class="sort" data-action="sort" data-metric="prefill" aria-pressed="${state.metric === 'prefill'}">Prefill ${icon('arrow-down')}</button></th><th>VRAM / RAM</th><th>来源</th></tr></thead><tbody>${body}</tbody></table></div>${!rows.length ? empty('这个条件下还没有样本', '换个筛选条件，或提交你的第一份实测', 'search') : ''}<div class="table-footer"><span>社区提交 · 对比需保持测试条件一致</span><div class="pager"><span>${rows.length ? offset + 1 : 0}–${Math.min(offset + 8, rows.length)} / ${rows.length}</span>${iconButton('prev', 'arrow-left', '上一页', state.pageNumber <= 1 ? 'disabled' : '')}${iconButton('next', 'arrow-up-right', '下一页', offset + 8 >= rows.length ? 'disabled' : '')}</div></div>`;
}
function renderBenchmarks() {
  const rows = activeRows();
  if (!rows.some(r => r.id === state.selected)) state.selected = rows[0]?.id || '';
  const models = filterValues(state.filters.model), selectedModels = models.length ? models : [...new Set(state.rows.map(r => r.model))];
  const strategies = filterValues(state.filters.strategy), title = selectedModels.length === 1 ? modelLabel(selectedModels[0]) : `${selectedModels.length} 个模型 · 跨条件浏览`;
  const peak = rows.find(row => row[state.metric] !== null), info = state.dataInfo;
  const status = `<div class="dataset-status">${tag(preview ? '本地演示数据' : info?.stale ? '离线缓存' : 'Git 数据快照', preview || info?.stale ? 'amber' : 'mint')}<span>${state.index?.reports.length ?? 0} 份报告 · ${escape(info?.manifest.version.slice(0, 10) || '')}</span>${info?.stale ? '<span>新版本暂时不可用，当前为已校验的缓存版本</span>' : ''}</div>`;
  $('#main').innerHTML = heading('性能排行榜', 'BENCHMARK EXPLORER', '把闲置的算力，变成下一份参考答案。', button('export-csv', '导出表格', 'download') + '<a class="button primary" href="upload.html">' + icon('plus') + '提交实测</a>') + status + `<div class="band">${stat('筛选结果', String(rows.length).padStart(2, '0'), 'RUNS', `共 ${state.rows.length} 条${state.metric === 'decode' ? ' Decode' : ' Prefill'}记录`)}${stat('覆盖设备', String(new Set(rows.map(r => r.gpu)).size).padStart(2, '0'), 'DEVICES', 'GPU 与统一内存设备')}${stat('最高 ' + (state.metric === 'decode' ? 'Decode' : 'Prefill'), fmt(peak?.[state.metric]), 'tok/s', state.metric === 'decode' ? '当前筛选 · 并发总吞吐量' : '当前筛选 · 每上下文一份实测')}${stat('配置策略', strategies.length === 1 ? strategyNames[strategies[0]] : '全部策略', '', '自动激进 / 自动保守 / 手动配置')}</div>${filterPanel()}<div class="workspace"><section><div class="cohort"><div class="eyebrow">RESULTS / 筛选结果</div><h2>${escape(title)}</h2><div class="tags">${tag(`${rows.length} 条记录`, 'mint')}${tag(state.metric === 'decode' ? '按 Decode 排序' : '按 Prefill 排序')}${tag(state.metric === 'decode' ? '并发总吞吐量 · tok/s' : 'Prefill · tok/s')}</div></div><div id="run-table">${table(rows)}</div></section><aside class="inspector" id="inspector">${inspector(rows.find(r => r.id === state.selected))}</aside></div>`;
  renderTray(); icons();
}
const modelLabel = value => value.replace(/\.gguf$/i, '').replace(/-A3B-I-Balanced$/, ' · I-Balanced').replace(/-4\.27bpw$/, ' · 4.27 bpw');
function facets() {
  const unique = key => [...new Set(state.rows.map(r => String(r[key])))];
  const capacities = key => [...new Set(state.rows.map(r => capacityGiB(r[key + '_bytes'])))].sort((a, b) => (a ?? Infinity) - (b ?? Infinity)).map(v => [v === null ? 'unknown' : String(v), v === null ? '未提供' : String(v)]);
  return [
    ['model', '模型', unique('model').map(v => [v, modelLabel(v)])],
    ['gpu', 'GPU', unique('gpu').map(v => [v, v])],
    ['context', '上下文 / tokens', unique('context').sort((a, b) => a - b).map(v => [v, contextLabel(Number(v))])],
    ['ram', 'RAM 总容量 / GiB', capacities('ram')],
    ['vram', 'VRAM 总容量 / GiB', capacities('vram')],
    ...(state.metric === 'decode' ? [['slots', '并发', unique('slots').sort().map(v => [v, v === 'null' ? '未提供' : '×' + v])]] : []),
    ['mtp', 'MTP', unique('mtp').sort().map(v => [v, v === 'true' ? '开启' : v === 'false' ? '关闭' : '未提供'])],
    ['strategy', '配置策略', Object.entries(strategyNames).filter(([key]) => key !== 'unknown' || state.rows.some(r => strategyOf(r) === 'unknown'))],
    ['kv', 'KV Cache', [...new Set(state.rows.map(r => `${r.kv_k || '?'}/${r.kv_v || '?'}`))].map(v => [v, v.toUpperCase()])],
    ['os', '系统', unique('os').map(v => [v, ({ windows: 'Windows', linux: 'Linux', macos: 'macOS' })[v] || v])],
    ['engine', '引擎版本', unique('engine').sort().reverse().map(v => [v, 'v' + v])],
    ['status', '结果', unique('status').map(v => [v, resultStatus[v] || '未提供'])]
  ];
}
function filterPanel() {
  const groups = facets(), ranges = ['context', 'ram', 'vram'].filter(key => (key !== 'context' || state.filters.contextMode === 'range') && (state.filters[key + 'Min'] !== '' || state.filters[key + 'Max'] !== ''));
  const count = groups.reduce((sum, [key]) => sum + (key === 'context' && state.filters.contextMode === 'range' ? 0 : filterValues(state.filters[key]).length), ranges.length);
  const selected = groups.flatMap(([key, label, options]) => key === 'context' && state.filters.contextMode === 'range' ? [] : options.filter(([value]) => filterValues(state.filters[key]).includes(String(value))).map(([value, text]) => `<button class="active-filter" data-action="remove-filter" data-key="${key}" data-value="${escape(value)}" title="移除 ${escape(label + '：' + text)}"><span>${escape(label)} <strong>${escape(text)}</strong></span>${icon('x')}</button>`));
  for (const key of ranges) selected.push(`<button class="active-filter" data-action="clear-range" data-key="${key}" title="移除范围"><span>${key === 'context' ? '上下文' : key.toUpperCase()} <strong>${escape(rangeLabel(key))}</strong></span>${icon('x')}</button>`);
  return `<section class="filter-workspace" aria-label="筛选性能记录"><div class="filter-toolbar"><label class="search">${icon('search')}<input type="search" id="search" value="${escape(state.filters.search)}" placeholder="搜索 GPU、CPU 或模型" aria-label="搜索设备"></label><div class="actions">${button('toggle-filters', '筛选' + (count ? ' · ' + count : ''), 'sliders-horizontal', '', `aria-expanded="${state.filtersOpen}" aria-controls="facet-panel"`)}${button('reset-filters', '清空条件', 'rotate-ccw', '', count || state.filters.search ? '' : 'disabled')}</div></div><div class="facet-panel" id="facet-panel" ${state.filtersOpen ? '' : 'hidden'}>${groups.map(([key, label, options]) => {
    const base = filterRows(state.rows, { ...state.filters, [key]: [], [key + 'Min']: '', [key + 'Max']: '' });
    if (key === 'context') return contextFacet(base, options);
    return `<fieldset class="facet facet-${key}"><legend>${label}</legend>${facetChoices(key, options, base)}${['ram', 'vram'].includes(key) ? rangeForm(key) : ''}</fieldset>`;
  }).join('')}</div><div class="active-filters" ${selected.length ? '' : 'hidden'}>${selected.join('')}</div></section>`;
}
function facetChoices(key, options, base) {
  const counts = new Map();
  for (const row of base) {
    const value = key === 'strategy' ? strategyOf(row) : key === 'kv' ? `${row.kv_k || '?'}/${row.kv_v || '?'}` : ['ram', 'vram'].includes(key) ? capacityGiB(row[key + '_bytes']) ?? 'unknown' : row[key];
    counts.set(String(value), (counts.get(String(value)) || 0) + 1);
  }
  return `<div class="facet-options">${options.map(([value, text]) => {
      const checked = filterValues(state.filters[key]).includes(String(value)), available = counts.get(String(value)) || 0;
      return `<label class="facet-choice ${checked ? 'checked' : ''}"><input type="checkbox" data-filter="${key}" value="${escape(value)}" ${checked ? 'checked' : ''}><span>${escape(text)}</span><small>${available}</small></label>`;
  }).join('')}</div>`;
}
function rangeLabel(key) {
  const min = state.filters[key + 'Min'], max = state.filters[key + 'Max'];
  const label = value => key === 'context' ? contextLabel(Number(value)) : Number(value).toLocaleString('en-US');
  const text = min !== '' && max !== '' ? min === max ? label(min) : label(min) + '–' + label(max) : min !== '' ? '≥ ' + label(min) : '≤ ' + label(max);
  return text + (key === 'context' ? ' tokens' : ' GiB');
}
function rangeForm(key) {
  const label = key === 'context' ? '上下文' : key.toUpperCase(), unit = key === 'context' ? 'tokens' : 'GiB';
  const domain = rangeBounds(state.rows, key, state.bounds), floor = domain.min ?? 0, ceiling = domain.max ?? 0, span = ceiling - floor;
  const clamp = value => Math.max(floor, Math.min(ceiling, value));
  const min = state.filters[key + 'Min'] === '' ? floor : clamp(Number(state.filters[key + 'Min'])), max = state.filters[key + 'Max'] === '' ? ceiling : clamp(Number(state.filters[key + 'Max']));
  const display = value => domain.min === null ? '—' : sliderLabel(key, value);
  return `<div class="range-control" data-range-control="${key}" data-floor="${floor}" data-ceiling="${ceiling}"><div class="range-readout"><span>下限 <output data-bound="min">${display(min)}</output></span><span>上限 <output data-bound="max">${display(max)}</output></span><small>${unit}</small></div><div class="dual-slider" style="--start:${span ? (min - floor) / span * 100 : 0}%;--end:${span ? (max - floor) / span * 100 : 100}%"><div class="slider-track"></div>${[['min', min], ['max', max]].map(([bound, value]) => `<input type="range" data-slider="${key}" data-bound="${bound}" min="${floor}" max="${ceiling}" step="1" value="${value}" ${span > 0 ? '' : 'disabled'} aria-label="${label}${bound === 'min' ? '下限' : '上限'}（${unit}）" aria-valuetext="${display(value)}">`).join('')}</div></div>`;
}
const sliderLabel = (key, value) => key === 'context' ? contextLabel(Number(value)) : Number(value).toLocaleString('en-US');
function readSlider(input) {
  const control = input.closest('[data-range-control]'), key = input.dataset.slider;
  const low = control.querySelector('input[data-bound="min"]'), high = control.querySelector('input[data-bound="max"]'), floor = Number(control.dataset.floor), ceiling = Number(control.dataset.ceiling), span = ceiling - floor;
  if (Number(low.value) > Number(high.value)) input.value = input.dataset.bound === 'min' ? high.value : low.value;
  for (const node of [low, high]) { const text = sliderLabel(key, node.value); control.querySelector(`output[data-bound="${node.dataset.bound}"]`).textContent = text; node.setAttribute('aria-valuetext', text); }
  control.querySelector('.dual-slider').style.setProperty('--start', (Number(low.value) - floor) / span * 100 + '%');
  control.querySelector('.dual-slider').style.setProperty('--end', (Number(high.value) - floor) / span * 100 + '%');
  return { key, min: Number(low.value) === floor ? '' : low.value, max: Number(high.value) === ceiling ? '' : high.value };
}
function contextFacet(base, options) {
  const range = state.filters.contextMode === 'range';
  const domain = rangeBounds(state.rows, 'context', state.bounds), values = [...new Set([domain.min, ...options.map(([value]) => Number(value)), domain.max])].filter(Number.isFinite).sort((a, b) => a - b);
  const edges = [...new Set([values[0], values[Math.floor((values.length - 1) / 3)], values[Math.ceil((values.length - 1) * 2 / 3)], values.at(-1)])].filter(Number.isFinite);
  const presets = [['', '', '全部'], ...edges.slice(1).map((max, i) => [edges[i] === domain.min ? '' : String(edges[i]), max === domain.max ? '' : String(max), contextLabel(edges[i]) + '–' + contextLabel(max)])];
  return `<fieldset class="facet facet-context"><legend>上下文 / tokens</legend><div class="context-heading"><div class="context-modes" role="radiogroup" aria-label="上下文筛选方式">${[['range', '范围'], ['points', '档位']].map(([value, label]) => `<label><input type="radio" name="context-mode" value="${value}" ${state.filters.contextMode === value ? 'checked' : ''}><span>${label}</span></label>`).join('')}</div></div>${range ? `<div class="range-presets">${presets.map(([min, max, text]) => `<button type="button" class="range-preset ${state.filters.contextMin === min && state.filters.contextMax === max ? 'selected' : ''}" data-action="context-preset" data-min="${min}" data-max="${max}">${text}</button>`).join('')}</div>${rangeForm('context')}` : facetChoices('context', options, base)}</fieldset>`;
}
function renderTray() {
  const target = $('#compare-tray'); if (!target) return;
  target.hidden = !state.compare.length;
  target.innerHTML = `<span><span class="mint mono">${state.compare.length}</span> 个同条件样本</span><div class="actions">${button('clear-compare', '清空', 'x', 'small')}${button('compare', '对比', 'arrow-left', 'small primary', state.compare.length < 2 ? 'disabled' : '')}</div>`;
}
function payloadPreview(decoded) {
  const p = decoded.payload;
  if (decoded.kind === 'benchmark') {
    const index = assembleIndex([{ payload: p }], { mode: 'preview' });
    const rows = [...indexRows(index), ...indexRows(index, 'prefill')];
    return `<section class="report-section"><h2>${escape(p.model.name || '未提供模型')}</h2><div class="tags">${tag(strategyNames[strategyOf(rows[0] || {})])}${tag(p.hardware?.gpu?.name || p.hardware?.gpu?.configured_device || '未提供设备')}${tag('v' + p.engine_version)}</div><div class="table-scroll"><table class="payload-table"><thead><tr><th>CTX</th><th>并发</th><th>Prefill</th><th>Decode</th><th>中 / 后段</th></tr></thead><tbody>${rows.map(r => `<tr><td>${contextLabel(r.context)}</td><td>${slotsLabel(r)}</td><td>${fmt(r.prefill)}</td><td>${fmt(r.decode)}</td><td>${r.sections ? fmt(r.sections[1]) + ' / ' + fmt(r.sections[2]) : '—'}</td></tr>`).join('')}</tbody></table></div>${!rows.length ? '<p class="muted">该报告没有可排名的成功测量，失败摘要仍会保留。</p>' : ''}</section>`;
  }
  return `<section class="report-section"><h2>问题描述</h2><div class="description">${escape(p.description || '尚未填写，请回到向导补充后重新导出。')}</div><div class="tags">${tag(p.failure_kind, 'amber')}${tag('v' + p.engine_version)}${tag(publicPr ? '诊断 · 待公开确认' : '私有诊断', 'blue')}</div></section><section class="report-section"><h2>错误与诊断范围</h2><p class="description">${escape(p.error.message || '用户主动截取运行状态')}</p><div class="tags">${tag('启动日志 ' + p.logs.startup.length + ' 行')}${tag('最近诊断 ' + p.logs.tail.length + ' 行')}${tag('不含速度表 / 对话内容')}</div><details class="code-details"><summary>检查附带的诊断日志</summary><pre>${escape([...p.logs.startup, '--- recent ---', ...p.logs.tail].join('\n'))}</pre></details></section>`;
}
function uploadAside() {
  return `<aside class="side-info"><section><div class="eyebrow">ONE FILE. TWO ROUTES.</div><h3>同一份原件，不同的去向。</h3><p><span class="mint">.m4b</span> 通过审核后归档到 Git，公开数据进入性能榜单。</p><p style="margin-top:12px"><span class="blue">.m4e</span> ${publicPr ? '经你确认后公开提交 PR，由维护者审核；不创建 Issue。' : '只进入私有收件箱，同类问题归组，不自动创建 Issue。'}</p></section><section><div class="eyebrow">FROM YOUR TERMINAL</div>${[['01', '在引擎向导中生成', '自动采集实测，或截取受限诊断'], ['02', '检查后导出报告', '报错描述可返回向导修改'], ['03', '上传后等待审核', '无需 GitHub 账户，保留私密回执']].map(([n, a, b]) => `<div class="flow-step"><span>${n}</span><div><strong>${a}</strong><small>${b}</small></div></div>`).join('')}</section><section><h3>需要核对文件？</h3><code>infr submission verify &lt;file&gt;<br>infr submission decode &lt;file&gt;</code><p style="margin-top:12px">封装是无损压缩，不是加密。提交前仍需检查其中的内容。</p></section></aside>`;
}
function renderUpload() {
  const errorKind = state.uploadKind === 'error', decoded = state.decoded;
  const content = state.uploaded ? receiptResult(state.uploaded) : `<div class="type-tabs"><button class="type-tab ${!errorKind ? 'active' : ''}" data-action="kind" data-kind="benchmark">${icon('cpu')}性能实测 <small>.m4b</small></button><button class="type-tab ${errorKind ? 'active' : ''}" data-action="kind" data-kind="error">${icon('message-square')}诊断反馈 <small>.m4e</small></button></div><input class="file-input" type="file" id="file" accept=".m4b,.m4e" aria-label="选择 MoE4All 报告"><div class="dropzone" id="dropzone" tabindex="0" role="button" aria-label="选择或拖入报告文件">${icon(errorKind ? 'message-square' : 'arrow-up')}<strong>把 ${errorKind ? '.m4e 诊断' : '.m4b 实测'}报告拖到这里</strong><p>引擎生成的原始文件 · 最大 512 KiB</p><div class="actions">${button('pick', '选择文件', 'folder-open')}</div></div>${state.file ? `<div class="file-strip">${icon('folder-open')}<div class="file-name"><strong>${escape(state.file.name)}</strong><small>${bytes(state.file.size)} · ${state.processing ? '正在解码与校验' : decoded ? '文件校验完成' : '未通过校验'}</small></div>${iconButton('clear-file', 'x', '移除文件', state.uploading ? 'disabled' : '')}</div>` : ''}${state.processing ? '<div class="loading">正在检查 gzip、SHA-256、payload 和可读摘要…</div>' : ''}${state.fileError ? `<div class="notice error" role="alert">${escape(state.fileError)}</div>` : ''}${decoded ? `<div class="checks">${['封装完整', 'SHA-256 一致', 'payload 有效', '隐私初检通过'].map(text => `<span class="check">${icon('check')}${text}</span>`).join('')}</div>${payloadPreview(decoded)}<section class="report-section"><h2>报告身份</h2><dl class="details"><dt>报告 ID</dt><dd>${escape(decoded.id)}</dd><dt>文件 / 解压后</dt><dd>${bytes(decoded.sizeBytes)} / ${bytes(decoded.decodedBytes)}</dd><dt>封装 / payload schema</dt><dd>SUBMISSION/1 · ${escape(decoded.headers.schema)}</dd></dl><div class="hash-label">PAYLOAD SHA-256 / 封装内的原始 JSON</div><div class="hash">${decoded.payloadSha256}</div><details class="code-details"><summary>展开整个封装文件的 SHA-256 与原始内容</summary><div class="hash">${decoded.fileSha256}</div><pre>${escape(decoded.text)}</pre></details></section><label class="privacy-choice"><input type="checkbox" id="consent"><span>${publicPr ? '我已检查文件内容，同意将原报告公开提交到 GitHub PR；PR 创建后即公开，不会自动合并。' : errorKind ? '我已检查描述与诊断内容，同意将这份报告提交到私有收件箱。' : '我已检查文件内容，同意实测报告在审核后公开到 Git 和社区榜单。'}</span></label><div id="human-verification"></div><div class="upload-bottom"><span>${publicPr ? '只创建 PR，不创建 Issue；合并后实测才进入榜单。' : errorKind ? '仅维护者可查看原始诊断，不自动发布 Issue。' : '文件校验通过不等于独立复测或立即上榜。'}</span>${button('upload', state.uploading ? '正在提交…' : publicPr ? '提交报告' : errorKind ? '提交私有诊断' : '提交实测报告', 'arrow-up', 'primary', 'id="upload-button" disabled')}</div>` : state.header && !state.processing ? `<details class="code-details"><summary>查看未验证的封装摘要</summary><pre>${escape(state.header.summary.join('\n'))}</pre></details>` : ''}`;
  $('#main').innerHTML = heading('提交报告', 'SUBMISSION INTAKE', '文件里有实测，有现场，也有可追溯的依据。') + `<div class="upload-workspace"><section class="upload-main">${content}</section>${uploadAside()}</div>`;
  icons(); bindDropzone();
}
function receiptResult(value) {
  return `<div class="receipt-big">${icon('check')}<div class="eyebrow">RECEIVED / 收件箱已收到</div><h2>${value.duplicate ? '这份报告已经收到。' : '报告已收到，等待审核。'}</h2><p>${config.mode === 'local' && value.review_mode === 'github_pr' ? '本地模拟已完成：原件仅保存在本机，未连接云端，也没有创建真实 GitHub PR。' : value.review_mode === 'github_pr' ? '报告将通过公开 PR 审核；PR 创建后即可查看原件，只有维护者手动合并才会收录。' : value.kind === 'error' ? '原始诊断只对维护者可见。同类报告会归入一个问题组，不会逐条创建 Issue。' : value.duplicate && value.status === 'published' ? '这是已有记录的重复提交，已返回原报告回执，不会重复上榜。' : '数据尚未公开。通过审核并完成归档后，才会进入榜单。'}</p><div class="tags">${stateTag(value.status)}${tag(value.kind === 'error' ? (value.review_mode === 'github_pr' ? '公开 .m4e' : '私有 .m4e') : '公开候选 .m4b')}</div><div class="hash">${escape(value.report_id)}</div>${value.public_url ? '<p><a class="text-link" href="' + escape(value.public_url) + '" target="_blank" rel="noopener noreferrer">查看 GitHub 记录</a></p>' : ''}<p><small>查询凭证已保存在当前浏览器。可下载私密回执备份，请勿公开分享。</small></p><div class="actions" style="margin-top:24px">${button('download-receipt', '下载私密回执', 'download', '', `data-id="${escape(value.receipt_id)}"`)}<a class="button" href="index.html#receipts">${icon('folder-open')}查看我的回执</a>${button('new-upload', '继续提交', 'plus')}</div></div>`;
}
function renderReceipts() {
  $('#main').innerHTML = heading('我的回执', 'PRIVATE RECEIPTS', '凭证仅保存在当前浏览器；公开报告在 GitHub 查看。', button('refresh-receipts', '刷新状态', 'refresh-cw')) + (receipts.length ? receipts.map(r => `<div class="receipt-row">${icon(r.kind === 'error' ? 'message-square' : 'cpu')}<div><strong>${escape(r.report_id)}</strong><small>${escape(r.receipt_id)}<br>${escape(r.received_at || '')}${r.archive_mode === 'local' ? ' · 本地预览，未创建 GitHub PR' : ''}</small></div>${stateTag(r.status)}<div class="actions">${iconButton('download-receipt', 'download', '下载私密回执', `data-id="${escape(r.receipt_id)}"`)}${iconButton('forget-receipt', 'x', '从此浏览器移除回执', `data-id="${escape(r.receipt_id)}"`)}</div></div>`).join('') : empty('还没有保存的回执', '提交一份报告后，在这里查看处理进展。'));
  icons();
}
async function loadConfirmation() {
  $('#main').innerHTML = '<div class="loading">正在读取本次上传信息…</div>';
  try { state.confirmation = await api(`/upload-sessions/${encodeURIComponent(confirmation.id)}/confirmation`, { headers: { Authorization: `Bearer ${confirmation.token}` } }); renderConfirmation(); }
  catch (error) { $('#main').innerHTML = empty('这个上传会话暂不可用', escape(error.message), 'shield-check'); icons(); }
}
function renderConfirmation() {
  const c = state.confirmation;
  $('#main').innerHTML = heading('确认这次上传', 'CMD HANDOFF', '浏览器只负责授权，文件仍由你的 CMD 发送。') + `<section class="confirmation">${state.confirmDone ? `<div class="receipt-big">${icon(state.confirmDone === 'ready' ? 'check' : 'x')}<h2>${state.confirmDone === 'ready' ? '已授权，请回到 CMD 继续上传。' : '已取消这次上传。'}</h2><p>${state.confirmDone === 'ready' ? '授权不等于文件已经上传。最终以 CMD 返回的回执为准。' : '本地报告文件不会被删除。'}</p></div>` : `<div class="tags">${tag(c.kind === 'error' ? (c.review_mode === 'github_pr' ? '公开诊断 .m4e' : '私有诊断 .m4e') : '公开实测 .m4b', c.kind === 'error' ? 'blue' : 'mint')}${tag('15 分钟有效', 'amber')}</div><dl class="details"><dt>报告 ID</dt><dd>${escape(c.report_id)}</dd><dt>文件大小</dt><dd>${bytes(c.size_bytes)}</dd><dt>整个文件 SHA-256</dt><dd>${escape(c.file_sha256)}</dd><dt>用途</dt><dd>${c.review_mode === 'github_pr' ? '公开 GitHub PR，维护者手动审核，不创建 Issue' : c.kind === 'error' ? '私有收件箱，不自动创建 Issue' : '审核后归档 Git，进入公开榜单'}</dd></dl><label class="privacy-choice"><input type="checkbox" id="confirmation-consent"><span>${c.review_mode === 'github_pr' ? '我已在 CMD 检查内容，同意公开这份报告；PR 创建后即公开，不必等到合并。' : c.kind === 'error' ? '我已在 CMD 检查内容，同意提交这份私有诊断。' : '我已在 CMD 检查内容，同意审核后公开实测报告。'}</span></label><div id="human-verification"></div><div class="actions">${button('confirm-upload', '确认并返回 CMD', 'check', 'primary', 'id="confirmation-button" disabled')}${button('cancel-upload', '取消', 'x')}</div><div class="notice ${config.mode === 'local' ? 'warn' : ''}">${config.mode === 'local' ? '当前为本地联调：不调用 Cloudflare 人机验证，不产生云端上传。' : '请核对 CMD 中显示的报告 ID 和文件摘要，勿确认来源不明的上传。'}</div>`}</section>`;
  icons(); if (!state.confirmDone) prepareHuman(c);
}
async function prepareHuman(session) {
  state.humanToken = '';
  if (config.mode === 'local') return;
  if (!session.turnstile_site_key) { toast('人机验证尚未配置'); return; }
  if (!window.turnstile) await new Promise((resolve, reject) => { const script = document.createElement('script'); script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'; script.onload = resolve; script.onerror = reject; document.head.append(script); });
  window.turnstile.render('#human-verification', { sitekey: session.turnstile_site_key, action: 'submission', callback: token => { state.humanToken = token; syncButtons(); }, 'expired-callback': () => { state.humanToken = ''; syncButtons(); } });
}
function syncButtons() {
  const upload = $('#upload-button'); if (upload) upload.disabled = !$('#consent')?.checked || state.uploading || !state.decoded;
  const confirm = $('#confirmation-button'); if (confirm) confirm.disabled = !$('#confirmation-consent')?.checked || (config.mode !== 'local' && !state.humanToken);
}
function renderAdmin() {
  if (publicPr) {
    $('#main').innerHTML = heading('GitHub 审核', 'PULL REQUESTS', '实测和诊断统一提交 PR，由维护者手动审核。') + `<div class="actions"><a class="button primary" href="https://github.com/Headmaster218/MoE4All/pulls" target="_blank" rel="noopener noreferrer">${icon('arrow-up-right')}打开 GitHub PR</a></div>`;
    icons(); return;
  }
  const o = state.overview;
  if (!o) { $('#main').innerHTML = heading('审核中心', 'MAINTAINER WORKSPACE', '公开实测与私有诊断，分开处理。') + `<section class="login-surface">${icon('shield-check')}<h2>这部分只属于维护者。</h2><p>${config.mode === 'local' ? '当前入口仅监听本机。点击进入后，本地服务会签发 HttpOnly 审核会话；公开接口不能读取诊断原件。' : '请通过已配置的 Cloudflare Access 身份验证进入。'}</p>${button('admin-login', config.mode === 'local' ? '进入本地审核' : '重新验证身份', 'shield-check', 'primary')}</section>`; icons(); return; }
  const pending = o.reports.filter(r => r.kind === 'benchmark' && r.status === 'pending_review'), errors = o.reports.filter(r => r.kind === 'error'), groups = o.groups;
  const body = state.adminTab === 'benchmark' ? o.reports.filter(r => r.kind === 'benchmark').map(r => `<div class="review-row"><span class="review-code mono">${escape(r.receipt_id.slice(-8))}</span><div><h3>${escape(r.summary[0]?.replace(/^model: /, '').split(' | ')[0] || r.report_id)}</h3><p>${escape(r.summary[1] || '')} · ${r.demo ? '示例' : '用户上传'}</p><p class="mono">${escape(r.report_id)}</p></div>${stateTag(r.status)}${iconButton('review', 'arrow-up-right', '审核这份报告', `data-id="${escape(r.receipt_id)}"`)}</div>`).join('') : groups.map(g => `<div class="review-row"><span class="review-code mono">${escape(g.id.slice(-8))}</span><div><h3>${escape(g.title)}</h3><p>${g.report_count} 份报告归为一组 · 原件仅维护者可见</p><div class="tags">${stateTag(g.status)}</div></div><div class="review-count">${String(g.report_count).padStart(2, '0')}<small>REPORTS</small></div>${iconButton('group', 'arrow-up-right', '查看问题组', `data-id="${escape(g.id)}"`)}</div>`).join('');
  const actions = { received: '收到报告', duplicate_received: '重复提交已去重', approved: '批准归档', published: '完成收录', rejected: '退回报告', group_status_changed: '更新问题状态', group_changed: '调整问题分组', archive_pending: '等待 Git 归档', source_cleaned: '清理已归档原件' };
  $('#main').innerHTML = heading('审核中心', 'MAINTAINER WORKSPACE', '一次审核，实测归档；同类报错，集中处理。', button('refresh-admin', '刷新', 'refresh-cw')) + `<div class="band">${stat('待审实测', String(pending.length).padStart(2, '0'), '', '收录前不进入公开榜单')}${stat('诊断报告', String(errors.length).padStart(2, '0'), '', '原件保存在私有收件箱')}${stat('问题分组', String(groups.length).padStart(2, '0'), '', '不是一份报告一个 Issue')}${stat('归档目标', config.mode === 'local' ? 'LOCAL' : 'GIT', '', config.mode === 'local' ? '本地真实落盘，未连接 GitHub' : 'PR + CI + 合并复核')}</div><div class="admin-grid"><section><div class="admin-tabs"><button class="${state.adminTab === 'benchmark' ? 'active' : ''}" data-action="admin-tab" data-tab="benchmark">实测审核 <small>${pending.length}</small></button><button class="${state.adminTab === 'error' ? 'active' : ''}" data-action="admin-tab" data-tab="error">问题收件箱 <small>${groups.length}</small></button></div>${body || empty('这里暂时没有报告', '新提交会出现在这里。')}</section><aside class="side-info"><section><div class="eyebrow">REVIEW POLICY</div><h3>原件不改写，决定可追溯。</h3><p>审核绑定文件 SHA-256。收录后保留原件至少七天；只有归档复核通过，才允许清理云端副本。</p></section><section><div class="section-label">ACTIVITY / 最近操作</div>${o.audit.length ? o.audit.slice(0, 6).map(a => `<div class="audit-item">${escape(actions[a.action] || a.action)}<small>${escape(a.created_at)}</small></div>`).join('') : '<p>还没有审核操作。</p>'}</section></aside></div>`; icons();
}
function adminPagination() {
  const o = state.overview; if (!o) return;
  const section = $('.admin-grid>section');
  section.insertAdjacentHTML('beforeend', `<div class="table-footer"><span>已载入 ${o.reports.length} / ${o.total} 份原件摘要</span>${o.next_offset !== null ? button('more-admin-reports', '加载更早的记录', 'arrow-down', 'small') : ''}</div>`); icons();
}
async function loadAdmin() { if (publicPr) { renderAdmin(); return; } try { state.overview = await api('/admin/overview'); } catch (error) { if (error.status !== 401) toast(error.message); state.overview = null; } renderAdmin(); adminPagination(); }
function openDialog(html) { const dialog = $('#detail-dialog'); dialog.innerHTML = html; if (!dialog.open) dialog.showModal(); icons(); }
const dialogHeading = (title, eyebrow) => `<div class="dialog-heading"><div><div class="eyebrow">${eyebrow}</div><h2>${escape(title)}</h2></div>${iconButton('close', 'x', '关闭')}</div>`;
async function reviewReport(id) {
  try {
    const r = await api(`/admin/reports/${encodeURIComponent(id)}`); state.review = r;
    const decoded = { payload: r.payload, kind: r.kind };
    openDialog(dialogHeading(r.kind === 'error' ? '诊断原件' : '实测审核', 'IMMUTABLE REPORT / 审核绑定原件') + `<div class="tags">${stateTag(r.status)}${tag(r.demo ? '示例报告' : '用户上传', r.demo ? 'amber' : 'blue')}</div>${r.payload ? payloadPreview(decoded) : '<div class="notice">原件已按归档策略清理。</div>'}<div class="hash-label">FILE SHA-256</div><div class="hash">${escape(r.file_sha256)}</div>${r.payload ? `<details class="code-details"><summary>查看完整解码 JSON</summary><pre>${escape(JSON.stringify(r.payload, null, 2))}</pre></details>` : ''}${r.kind === 'error' ? `<label class="field">移动到其他问题组<select id="target-group"><option value="">选择目标分组</option>${state.overview.groups.filter(g => g.id !== r.group_id).map(g => `<option value="${escape(g.id)}">${escape(g.title.slice(0, 80))}</option>`).join('')}</select></label><div class="actions">${button('move-report', '移入所选分组', 'folder-open')}${button('split-report', '拆分为独立问题', 'plus')}</div>` : ''}${r.status === 'pending_review' ? '<textarea class="review-note" id="review-note" maxlength="1000" placeholder="退回原因（仅维护者可见）" aria-label="审核备注"></textarea>' : ''}<div class="dialog-actions">${r.payload ? button('raw-report', '下载原始文件', 'download', '', `data-id="${escape(r.receipt_id)}"`) : ''}${r.status === 'pending_review' ? button('reject-report', '退回', 'x', 'danger') : ''}${r.kind === 'benchmark' && r.status === 'pending_review' ? button('approve-report', config.mode === 'local' ? '收录到本地库' : '批准并归档 Git', 'check', 'primary') : r.kind === 'benchmark' && r.status === 'archiving' ? button('sync-archive', '重试归档同步', 'refresh-cw', 'primary') : ''}</div>`);
  } catch (error) { toast(error.message); }
}
function openGroup(id) {
  const group = state.overview.groups.find(g => g.id === id); if (!group) return;
  state.group = group;
  openDialog(dialogHeading(group.title, 'PRIVATE ERROR GROUP / 私有问题组') + `<p class="muted">${group.report_count} 份报告集中处理，不自动创建 GitHub Issue。</p><label class="field">处理状态<select id="group-status">${['triaged', 'investigating', 'resolved', 'rejected'].map(s => `<option value="${s}" ${group.status === s ? 'selected' : ''}>${statusNames[s]}</option>`).join('')}</select></label><label class="field">修复版本（可选）<input id="resolution-version" maxlength="128" placeholder="例如 1.0.4"></label>${state.overview.reports.filter(r => r.group_id === id).map(r => `<div class="receipt-row">${icon('message-square')}<div><strong>${escape(r.report_id)}</strong><small>${escape(r.summary.find(s => s.startsWith('description:')) || '')}</small></div>${stateTag(r.status)}${iconButton('review', 'arrow-up-right', '查看此诊断原件', `data-id="${escape(r.receipt_id)}"`)}</div>`).join('')}<div class="dialog-actions">${button('save-group', '保存处理状态', 'check', 'primary')}</div>`);
  $('#resolution-version').value = group.resolution_version || '';
}
async function chooseFile(file) {
  if (!file || state.uploading) return;
  const sequence = ++fileSequence; state.file = file; state.decoded = null; state.header = null; state.fileError = ''; state.processing = true; state.uploaded = null; state.uploadSession = null; renderUpload();
  try {
    const { decodeSubmission, inspectHeaders, privacyFindings } = await import('./submission-codec.mjs');
    if (!/\.(m4b|m4e)$/.test(file.name)) throw new Error('只接受引擎生成的 .m4b 或 .m4e，不接受裸 JSON。');
    if (file.size > MAX_ARMOR_BYTES) throw new Error('文件超过 512 KiB。');
    const content = new Uint8Array(await file.arrayBuffer()); if (sequence !== fileSequence) return;
    state.header = inspectHeaders(content); state.uploadKind = state.header.kind;
    const decoded = await decodeSubmission(content, { filename: file.name }); if (sequence !== fileSequence) return;
    const findings = privacyFindings(decoded.payload); if (findings.length) throw new Error('发现疑似私密信息：' + findings.map(f => f.path).join('、') + '。请回到向导检查并重新导出。');
    state.decoded = decoded;
  } catch (error) { if (sequence === fileSequence) state.fileError = error.message; }
  finally { if (sequence === fileSequence) { state.processing = false; renderUpload(); } }
}
function bindDropzone() {
  const zone = $('#dropzone'); if (!zone) return;
  zone.addEventListener('dragover', event => { event.preventDefault(); zone.classList.add('drag'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('drag'));
  zone.addEventListener('drop', event => { event.preventDefault(); zone.classList.remove('drag'); if (event.dataTransfer.files.length !== 1) toast('每次请提交一个文件'); else chooseFile(event.dataTransfer.files[0]); });
  zone.addEventListener('click', event => { if (!event.target.closest('button')) $('#file').click(); });
  zone.addEventListener('keydown', event => { if ((event.key === 'Enter' || event.key === ' ') && event.target === zone) { event.preventDefault(); $('#file').click(); } });
  $('#file').addEventListener('change', event => chooseFile(event.target.files[0]));
}
async function sendFile() {
  if (!state.decoded || !$('#consent')?.checked || state.uploading) return;
  state.uploading = true; syncButtons();
  try {
    const d = state.decoded;
    if (!state.uploadSession) {
      const session = await post('/upload-sessions', { kind: d.kind, report_id: d.id, file_sha256: d.fileSha256, size_bytes: d.sizeBytes });
      const url = new URL(session.verification_url);
      if (url.origin !== location.origin) throw new Error('上传确认地址不属于本站');
      const browser = new URLSearchParams(url.hash.slice(1)).get('authorize');
      state.uploadSession = { ...session, browser };
      if (config.mode !== 'local') {
        const info = await api(`/upload-sessions/${session.session_id}/confirmation`, { headers: { Authorization: `Bearer ${browser}` } });
        await prepareHuman(info); toast('请完成人机验证后再次点击提交'); return;
      }
    }
    const s = state.uploadSession;
    const current = await api(`/upload-sessions/${s.session_id}`, { headers: { Authorization: `Bearer ${s.session_token}` } });
    if (current.state === 'awaiting_verification') await post(`/upload-sessions/${s.session_id}/authorize`, { consent: consentFor(d.kind), turnstile_token: state.humanToken || '' }, s.browser);
    else if (!['ready', 'uploaded'].includes(current.state)) throw new Error('会话已经结束，请重新提交');
    const result = await api(`/upload-sessions/${s.session_id}/report`, { method: 'POST', headers: { Authorization: `Bearer ${s.session_token}`, 'Content-Type': 'text/plain; charset=utf-8' }, body: d.bytes });
    receipts = [result, ...receipts.filter(r => r.receipt_id !== result.receipt_id)].slice(0, 100); persistReceipts(); state.uploaded = result; state.uploadSession = null;
  } catch (error) { toast(error.message + '；原文件已保留。'); if (['session_expired', 'session_closed'].includes(error.code)) state.uploadSession = null; }
  finally { state.uploading = false; if (state.uploaded) renderUpload(); else syncButtons(); }
}

document.addEventListener('change', event => {
  if (event.target.matches('input[data-slider]')) {
    const { key, min, max } = readSlider(event.target), bound = event.target.dataset.bound;
    state.filters[key + 'Min'] = min; state.filters[key + 'Max'] = max; state.filters[key] = [];
    state.pageNumber = 1; renderBenchmarks();
    document.querySelector(`input[data-slider="${key}"][data-bound="${bound}"]`)?.focus({ preventScroll: true }); return;
  }
  if (event.target.name === 'context-mode') { state.filters.contextMode = event.target.value; state.pageNumber = 1; renderBenchmarks(); return; }
  if (event.target.matches('input[data-filter]')) {
    const { filter } = event.target.dataset, value = event.target.value;
    const values = filterValues(state.filters[filter]);
    state.filters[filter] = event.target.checked ? [...new Set([...values, value])] : values.filter(v => v !== value);
    if (['ram', 'vram'].includes(filter)) { for (const bound of ['Min', 'Max']) state.filters[filter + bound] = ''; }
    state.pageNumber = 1; renderBenchmarks();
    document.querySelector(`input[data-filter="${CSS.escape(filter)}"][value="${CSS.escape(value)}"]`)?.focus({ preventScroll: true });
  }
  if (event.target.id === 'consent' || event.target.id === 'confirmation-consent') syncButtons();
  if (event.target.matches('[data-compare]')) {
    const id = event.target.dataset.compare, candidate = state.rows.find(r => r.id === id);
    if (event.target.checked) { const error = comparisonError(state.rows.filter(r => state.compare.includes(r.id)), candidate); if (error) { event.target.checked = false; toast(error); return; } state.compare.push(id); }
    else state.compare = state.compare.filter(value => value !== id);
    renderTray(); icons();
  }
});
document.addEventListener('input', event => {
  if (event.target.matches('input[data-slider]')) readSlider(event.target);
  if (event.target.id === 'search') {
    const start = event.target.selectionStart, end = event.target.selectionEnd;
    state.filters.search = event.target.value; state.pageNumber = 1; renderBenchmarks();
    $('#search').focus({ preventScroll: true }); $('#search').setSelectionRange(start, end);
  }
});
document.addEventListener('click', async event => {
  const target = event.target.closest('[data-action]'); if (!target || target.disabled) return;
  const action = target.dataset.action, id = target.dataset.id;
  try {
    if (action === 'menu') { $('.sidebar').classList.toggle('open'); return; }
    if (action === 'retry-index') { location.reload(); return; }
    if (action === 'toggle-filters') { state.filtersOpen = !state.filtersOpen; renderBenchmarks(); $('[data-action="toggle-filters"]').focus({ preventScroll: true }); return; }
    if (action === 'reset-filters') { state.filters = blankFilters(); state.pageNumber = 1; renderBenchmarks(); return; }
    if (action === 'remove-filter') { state.filters[target.dataset.key] = filterValues(state.filters[target.dataset.key]).filter(v => v !== target.dataset.value); state.pageNumber = 1; renderBenchmarks(); return; }
    if (action === 'clear-range') { for (const bound of ['Min', 'Max']) state.filters[target.dataset.key + bound] = ''; state.pageNumber = 1; renderBenchmarks(); return; }
    if (action === 'context-preset') { state.filters.contextMin = target.dataset.min; state.filters.contextMax = target.dataset.max; state.pageNumber = 1; renderBenchmarks(); return; }
    if (action === 'close') { $('#detail-dialog').close(); return; }
    if (action === 'sort') { if (state.metric !== target.dataset.metric) selectMetric(target.dataset.metric); renderBenchmarks(); }
    if (action === 'prev' || action === 'next') { state.pageNumber += action === 'prev' ? -1 : 1; renderBenchmarks(); }
    if (action === 'sample') { const row = state.rows.find(r => r.id === id); state.selected = id; if ($('#inspector')) $('#inspector').innerHTML = inspector(row); openDialog(dialogHeading(row.gpu, 'BENCHMARK SAMPLE') + inspector(row)); }
    if (action === 'clear-compare') { state.compare = []; renderBenchmarks(); }
    if (action === 'compare') openDialog(dialogHeading('同条件样本对比', 'SIDE BY SIDE') + `<div class="compare-columns" style="--count:${state.compare.length}">${state.compare.map(id => state.rows.find(r => r.id === id)).map(row => `<section><h3>${escape(row.gpu)}</h3><div class="inspect-score">${fmt(row[state.metric])}<small>tok/s</small></div>${spark(row)}${detailList(row)}</section>`).join('')}</div>`);
    if (action === 'export-csv') download('moe4all-public-benchmarks.csv', csv(activeRows()), 'text/csv; charset=utf-8');
    if (action === 'pick') $('#file').click();
    if (action === 'kind') { if (state.uploading) return; state.uploadKind = target.dataset.kind; state.decoded = null; state.file = null; state.header = null; state.fileError = ''; fileSequence++; renderUpload(); }
    if (action === 'clear-file' || action === 'new-upload') { fileSequence++; Object.assign(state, { file: null, decoded: null, header: null, fileError: '', uploaded: null, processing: false, uploadSession: null }); renderUpload(); }
    if (action === 'upload') await sendFile();
    if (action === 'download-receipt') { const r = receipts.find(r => r.receipt_id === id); if (r) download(r.receipt_id + '.private-receipt.json', JSON.stringify(r, null, 2)); }
    if (action === 'forget-receipt') { receipts = receipts.filter(r => r.receipt_id !== id); persistReceipts(); renderReceipts(); toast('已移除本机查询凭证；云端报告未删除'); }
    if (action === 'refresh-receipts') { target.disabled = true; for (const r of receipts.slice(0, 20)) { try { Object.assign(r, await api(`/receipts/${r.receipt_id}`, { headers: { Authorization: `Bearer ${r.receipt_token}` } })); } catch { r.query_failed = true; } } persistReceipts(); renderReceipts(); }
    if (action === 'confirm-upload') { const c = state.confirmation; await post(`/upload-sessions/${confirmation.id}/authorize`, { consent: c.consent || consentFor(c.kind), turnstile_token: state.humanToken || '' }, confirmation.token); state.confirmDone = 'ready'; renderConfirmation(); }
    if (action === 'cancel-upload') { await post(`/upload-sessions/${confirmation.id}/cancel`, {}, confirmation.token); state.confirmDone = 'cancelled'; renderConfirmation(); }
    if (action === 'admin-login') { if (config.mode === 'local') { const response = await fetch('/__local/login', { method: 'POST', redirect: 'error' }); if (!response.ok) throw new Error('本地登录失败'); } await loadAdmin(); }
    if (action === 'refresh-admin') await loadAdmin();
    if (action === 'admin-tab') { state.adminTab = target.dataset.tab; renderAdmin(); adminPagination(); }
    if (action === 'more-admin-reports') { target.disabled = true; const next = await api('/admin/reports?offset=' + state.overview.next_offset); state.overview.reports.push(...next.reports.filter(r => !state.overview.reports.some(old => old.receipt_id === r.receipt_id))); state.overview.next_offset = next.next_offset; state.overview.total = next.total; renderAdmin(); adminPagination(); }
    if (action === 'review') await reviewReport(id);
    if (action === 'group') openGroup(id);
    if (action === 'raw-report') { const response = await fetch(`${config.apiBase}/admin/reports/${id}/raw`, { credentials: 'include', redirect: 'error' }); if (!response.ok) throw new Error('下载失败'); download(state.review.report_id + (state.review.kind === 'benchmark' ? '.m4b' : '.m4e'), await response.text(), 'text/plain; charset=utf-8'); }
    if (action === 'approve-report' || action === 'reject-report') { target.disabled = true; await post(`/admin/reports/${state.review.receipt_id}/review`, { action: action === 'approve-report' ? 'approve' : 'reject', file_sha256: state.review.file_sha256, note: $('#review-note')?.value || '' }); $('#detail-dialog').close(); await loadAdmin(); toast(action === 'approve-report' ? config.mode === 'local' ? '已归档到本地库，未同步 GitHub' : '已批准，正在归档' : '已退回'); }
    if (action === 'sync-archive') { await post(`/admin/reports/${state.review.receipt_id}/archive`, {}); $('#detail-dialog').close(); await loadAdmin(); }
    if (action === 'save-group') { await api(`/admin/groups/${state.group.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: $('#group-status').value, resolution_version: $('#resolution-version').value }) }); $('#detail-dialog').close(); await loadAdmin(); }
    if (action === 'move-report' || action === 'split-report') { const group = action === 'move-report' ? $('#target-group').value : null; if (action === 'move-report' && !group) throw new Error('请先选择目标分组'); await post('/admin/groups/move', { receipt_id: state.review.receipt_id, group_id: group }); $('#detail-dialog').close(); await loadAdmin(); }
  } catch (error) { toast(error.message); target.disabled = false; }
});
window.addEventListener('hashchange', () => {
  const incoming = new URLSearchParams(location.hash.slice(1));
  if (incoming.has('session') && incoming.has('authorize')) {
    confirmation = { id: incoming.get('session'), token: incoming.get('authorize') };
    history.replaceState(null, '', location.pathname + location.search);
    state.page = 'confirmation'; state.confirmDone = null; shell(); loadConfirmation();
  } else if (location.hash === '#receipts') { state.page = 'receipts'; shell(); renderReceipts(); }
});
shell();
if (state.page === 'confirmation') await loadConfirmation();
else if (state.page === 'upload') renderUpload();
else if (state.page === 'receipts') renderReceipts();
else if (state.page === 'admin') await loadAdmin();
else {
  $('#main').innerHTML = '<div class="loading">读取社区实测…</div>';
  try {
    const result = await loadLeaderboard(new URL(config.leaderboardManifest || 'data/manifest.json', location.href), { repository: config.repository, preview });
    state.index = result.index; state.dataInfo = result;
    selectMetric(indexRows(state.index).length ? 'decode' : 'prefill');
    state.filters.model = state.rows.length ? [state.rows.find(r => r.model.includes('35B'))?.model || state.rows[0].model] : [];
    if (state.rows.some(r => r.slots === 1)) state.filters.slots = ['1'];
    if (state.rows.some(r => r.mtp === false)) state.filters.mtp = ['false'];
    renderBenchmarks();
  }
  catch (error) { $('#main').innerHTML = empty('排行榜暂时无法加载', escape(error.message)) + '<div class="actions"><button class="button" data-action="retry-index">' + icon('history') + '重试</button></div>'; icons(); }
}
