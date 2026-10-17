(function (root) {
  "use strict";
  // Keep suffixes: 7900 XT and 7900 XTX must never be treated as the same GPU.
  function gpuKey(value) {
    const text = String(value).toLowerCase().replace(/^angle\s*\([^,]*,\s*/, "").split(/\s*\(0x|\s+direct3d|\s+opengl|\s+vulkan|,/)[0];
    // Preserve capacity, memory type and edition: these can change both estimates.
    return text.replace(/\b(amd|radeon|nvidia|geforce|intel|graphics|gpu)\b|\(r\)|\(tm\)/g, "").replace(/[^a-z0-9]/g, "");
  }
  function specification(gpu, specs) {
    const matches = specs.filter(item => gpuKey(item.name) === gpuKey(gpu));
    // A model with multiple VRAM variants is not enough information to auto-fill.
    return matches.length && new Set(matches.map(item => `${item.vramGiB}/${item.architecture}/${item.fp32Tflops}/${item.bandwidthGBs}`)).size === 1 ? matches[0] : null;
  }
  const hasBothMetrics = spec => spec && [spec.fp32Tflops, spec.bandwidthGBs].every(value => Number.isFinite(value) && value > 0);
  function estimatableGpus(specs, vendor) {
    const groups = new Map();
    for (const spec of specs) {
      const key = gpuKey(spec.name);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(spec);
    }
    return [...groups.values()].map(group => specification(group[0].name, group)).filter(spec => hasBothMetrics(spec) && (!vendor || spec.vendor === vendor)).sort((a, b) => b.fp32Tflops - a.fp32Tflops || b.bandwidthGBs - a.bandwidthGBs || b.vramGiB - a.vramGiB || a.name.localeCompare(b.name, 'en', { numeric: true }));
  }
  function matchHardware(input, hardware, specs = []) {
    const query = gpuKey(input.gpu), known = gpuKey(hardware.gpu);
    if (!query) return null;
    const yours = specification(input.gpu, specs), reference = specification(hardware.gpu, specs);
    const kind = query === known ? "same" : yours?.architecture && reference?.architecture && yours.architecture === reference.architecture ? "architecture" : null;
    if (!kind) return null;
    return { kind };
  }
  function findRecords(input, records, specs) {
    return records.map(record => ({ ...record, match: matchHardware(input, record.data.hardware, specs) })).filter(record => record.match).sort((a, b) => {
      const rank = record => record.match.kind === "same" ? 0 : 1;
      return rank(a) - rank(b) || a.id.localeCompare(b.id);
    });
  }
  function measurementConditions(dataset, result, en) {
    const m = result.measurement, s = { ...dataset.settings, ...m };
    const flag = value => typeof value === "boolean" ? value ? "ON" : "OFF" : "?";
    const decode = m?.decode;
    const prefill = m?.prefill;
    const protocol = decode ? (en ? `Decode: actual prompt ${decode.promptTokensRange?.join("–") || "?"} tokens; ${decode.measuredRoundsPerConcurrency ?? "?"} measured round(s), output window ${decode.measuredWindow?.join("–") || "?"}; thinking ${flag(decode.thinking)}.` : `Decode：实际输入 ${decode.promptTokensRange?.join("–") || "?"} tokens；实测 ${decode.measuredRoundsPerConcurrency ?? "?"} 轮，输出窗口 ${decode.measuredWindow?.join("–") || "?"}；thinking ${flag(decode.thinking)}。`) : (en ? `Decode: ${s.measuredDecodeRounds ?? "?"} measured rounds after ${s.warmupRounds ?? "?"} warmup, ${s.outputTokensPerLane ?? "?"} output tokens/lane; thinking ${flag(s.thinking)}.` : `Decode：预热 ${s.warmupRounds ?? "?"} 轮、实测 ${s.measuredDecodeRounds ?? "?"} 轮，每路输出 ${s.outputTokensPerLane ?? "?"} tokens；thinking ${flag(s.thinking)}。`);
    const pp = prefill ? (en ? `Prefill: ${prefill.promptTokens} tokens, ${prefill.measuredRounds} samples, selected #${prefill.selectedSample ?? "?"}; thinking ${flag(prefill.thinking)}.` : `Prefill：${prefill.promptTokens} tokens，${prefill.measuredRounds} 次采样，选第 ${prefill.selectedSample ?? "?"} 次；thinking ${flag(prefill.thinking)}。`) : (en ? `Prefill: ${s.coldPrefillRequests ?? "?"} cold request(s), cached tokens ${s.prefillCachedTokens ?? "?"}.` : `Prefill：${s.coldPrefillRequests ?? "?"} 次冷请求，cached tokens ${s.prefillCachedTokens ?? "?"}。`);
    return `v${m?.version || dataset.version} · ${m?.measuredOn || dataset.measuredOn} · KV ${s.kv ?? "?"} · MTP ${flag(s.mtp)} · ctx ${s.contextCapacity ?? "?"} · ubatch ${s.ubatch ?? "?"} · CPU threads ${s.cpuThreads ?? "?"} · resident layers ${s.residentGpuLayers ?? "?"} · profile ${s.profile ?? "?"}. ${protocol} ${pp}${result.decodeSource ? (en ? " Decode revised by maintainer; exact build unavailable." : " Decode 经维护者修订，精确构建未提供。") : ""}`;
  }
  function estimateFrom7900XTX(input, records, specs, quantization, context, lanes) {
    const target = specification(input.gpu, specs), baseline = specification('RX 7900 XTX', specs);
    if (!target || !baseline) return { reason: 'spec' };
    // Keep the anchor fixed. Community additions cannot silently change it.
    const record = records.find(record => record.origin === 'maintainer' && record.verification !== 'unverified' && gpuKey(record.data.hardware.gpu) === 'rx7900xtx' && record.data.models.some(model => model.quantization === quantization && model.results[context]));
    if (!record) return { reason: 'baseline' };
    const result = record.data.models.find(model => model.quantization === quantization && model.results[context]).results[context];
    const decode = result.decode[lanes - 1];
    const ratio = metric => target[metric] > 0 && baseline[metric] > 0 ? target[metric] / baseline[metric] : null;
    const computeRatio = ratio('fp32Tflops'), bandwidthRatio = ratio('bandwidthGBs');
    if (!computeRatio && !bandwidthRatio) return { reason: 'metrics' };
    return { record, result, target, baseline, computeRatio, bandwidthRatio, compute: computeRatio ? { decode: decode * computeRatio, prefill: Number.isFinite(result.prefill) ? result.prefill * computeRatio : null } : null, bandwidth: bandwidthRatio ? { decode: decode * bandwidthRatio, prefill: Number.isFinite(result.prefill) ? result.prefill * bandwidthRatio : null } : null };
  }
  function create({ root, benchmarks, catalog, datasets, specs, getLanguage }) {
    const find = selector => root.querySelector(selector);
    const text = (zh, en) => getLanguage() === 'en' ? en : zh;
    const gpu = find('#hardware-gpu'), vendor = find('#hardware-vendor'), model = find('#hardware-model'), context = find('#hardware-context');
    const lanes = find('#hardware-lanes'), results = find('#hardware-results');
    const records = catalog.records.map(record => ({ ...record, data: record.file === 'benchmarks.json' ? benchmarks : datasets[record.file] }));
    function element(tag, value, parent) {
      const node = document.createElement(tag); node.textContent = value; parent.append(node); return node;
    }
    function link(label, href, parent) {
      const node = element('a', label, parent); node.href = href; node.target = '_blank'; node.rel = 'noopener'; return node;
    }
    const eligible = estimatableGpus(specs);
    function syncGpuOptions() {
      const previous = gpu.value;
      const options = eligible.filter(item => item.vendor === vendor.value);
      gpu.replaceChildren();
      const placeholder = element('option', text('请选择显卡型号', 'Choose a GPU model'), gpu);
      placeholder.value = ''; placeholder.disabled = true;
      for (const item of options) element('option', item.name, gpu).value = item.name;
      gpu.value = options.some(item => item.name === previous) ? previous : '';
    }
    syncGpuOptions();
    const models = new Map(records.flatMap(record => record.data.models.map(item => [item.quantization, item])));
    for (const [quantization, item] of models) element('option', item.name, model).value = quantization;
    function syncContexts() {
      const previous = context.value;
      const available = [...new Set(records.flatMap(record => record.data.models.filter(item => item.quantization === model.value).flatMap(item => Object.keys(item.results))))].sort((a, b) => Number(a) - Number(b));
      context.replaceChildren();
      for (const value of available) element('option', `${Number(value) / 1000}K`, context).value = value;
      if (available.includes(previous)) context.value = previous;
    }
    syncContexts();
    function renderEstimate(input) {
      const estimate = estimateFrom7900XTX(input, records, specs, model.value, context.value, Number(lanes.value));
      const panel = element('section', '', results); panel.className = 'hardware-estimate';
      element('h4', text('7900 XTX 基准估算', '7900 XTX baseline estimate'), panel);
      if (estimate.reason) {
        element('p', estimate.reason === 'baseline' ? text('所选模型暂无可用基准实测。', 'No baseline measurement for this selection.') : text('请选择显卡型号。', 'Choose a GPU model.'), panel);
        return;
      }
      const { target, baseline, record, result } = estimate;
      element('p', `${target.name} · ${target.vramGiB ? `${target.vramGiB} GiB VRAM` : text('共享内存 / 容量未记录', 'Shared memory / capacity unavailable')}`, panel);
      const cards = element('div', '', panel); cards.className = 'hardware-estimate-cards';
      for (const [kind, label] of [['compute', text('按 FP32 算力比例', 'FP32 compute scaling')], ['bandwidth', text('按显存带宽比例', 'VRAM bandwidth scaling')]]) {
        const card = element('div', '', cards); element('h5', label, card);
        if (!estimate[kind]) { element('p', text('缺少规格，暂无估算', 'Metric unavailable'), card); continue; }
        element('strong', `Decode ≈ ${estimate[kind].decode.toFixed(1)} tok/s`, card);
        element('p', estimate[kind].prefill === null ? 'Prefill —' : `Prefill ≈ ${estimate[kind].prefill.toFixed(1)} tok/s`, card);
      }
      element('p', text('粗略情景估算，非实测或误差区间；显存容量、专家卸载及 CPU/RAM/SSD 会影响实际速度。', 'Rough scenario estimates, not measurements or error bounds. VRAM capacity, offloading and CPU/RAM/SSD affect actual speed.'), panel).className = 'hardware-footnote';
      const details = element('details', '', panel);
      element('summary', text('计算依据与测试条件', 'Calculation and test conditions'), details);
      for (const [label, metric, unit, ratio] of [[text('FP32 算力', 'FP32 compute'), 'fp32Tflops', 'TFLOPS', estimate.computeRatio], [text('显存带宽', 'VRAM bandwidth'), 'bandwidthGBs', 'GB/s', estimate.bandwidthRatio]]) {
        element('p', ratio ? `${label}: ${target[metric]} / ${baseline[metric]} ${unit} = ${ratio.toFixed(3)}×` : `${label}: —`, details);
      }
      element('p', text(`公式：7900 XTX 对应实测 × 目标/基准规格比。基准 Decode ${result.decode[Number(lanes.value) - 1]} tok/s（×${lanes.value} 并发总吞吐量）；Prefill ${result.prefill ?? '—'} tok/s。`, `Formula: selected 7900 XTX measurement × target/baseline specification ratio. Baseline Decode ${result.decode[Number(lanes.value) - 1]} tok/s (aggregate ×${lanes.value}); Prefill ${result.prefill ?? '—'} tok/s.`), details);
      element('p', measurementConditions(record.data, result, getLanguage() === 'en'), details);
      element('p', text('假设模型、量化、上下文、并发、KV/MTP、缓存和卸载布局相同。FP32 理论算力不是量化内核性能；跨架构效率与系统差异未校准，实际速度可能超出两个情景值，不能保证模型可运行。', 'Assumes identical model, quantization, context, concurrency, KV/MTP, cache and offloading layout. Theoretical FP32 is not quantized-kernel throughput. Architecture and OS differences are uncalibrated; actual speeds may fall outside both scenarios and model fit is not guaranteed.'), details);
      if (target.sharedMemory || (target.vramGiB && target.vramGiB < record.data.hardware.vramBudgetGiB)) element('p', text(`目标显存布局与参考的 ${record.data.hardware.vramBudgetGiB} GiB VRAM / ${record.data.hardware.ramBudgetGiB} GiB RAM 预算不同，可能改变缓存与卸载行为。`, `Target memory layout differs from the reference ${record.data.hardware.vramBudgetGiB} GiB VRAM / ${record.data.hardware.ramBudgetGiB} GiB RAM budgets, potentially changing cache and offloading behavior.`), details);
      element('p', text(`基准测试系统：${record.data.hardware.os}。`, `Baseline test OS: ${record.data.hardware.os}.`), details);
      link(text('基准实测 ↗', 'Baseline measurement ↗'), record.source, details);
    }
    function renderMeasurements(input) {
      element('h4', text('已有实测', 'Measured results'), results).className = 'hardware-result-heading';
      const matches = findRecords(input, records, specs).flatMap(record => {
        const selected = record.data.models.find(item => item.quantization === model.value);
        return selected?.results[context.value] ? [{ ...record, selected, result: selected.results[context.value] }] : [];
      });
      if (!matches.length) { element('p', text('暂无同款或同架构显卡的对应实测。', 'No matching measurement for this GPU or architecture.'), results); return; }
      for (const record of matches) {
        const { data, match, result } = record;
        const section = element('section', '', results); section.className = 'hardware-record';
        element('h5', `${data.hardware.gpu} · ${match.kind === 'same' ? text('同款显卡', 'Same GPU') : text('同架构参考', 'Architecture reference')}`, section);
        const wrap = element('div', '', section); wrap.className = 'benchmark-table-wrap hardware-results-table';
        const table = element('table', '', wrap);
        const head = element('tr', '', element('thead', '', table));
        for (const label of [`Decode ×${lanes.value}`, 'Prefill', text('来源', 'Source')]) element('th', label, head).scope = 'col';
        const row = element('tr', '', element('tbody', '', table));
        element('td', `${result.decode[Number(lanes.value) - 1].toFixed(2)} tok/s`, row);
        element('td', Number.isFinite(result.prefill) ? `${result.prefill.toFixed(2)} tok/s` : '—', row);
        link(`${record.contributor} ↗`, record.source, element('td', '', row));
        const details = element('details', '', section); element('summary', text('来源状态与完整测试条件', 'Provenance and full test conditions'), details);
        element('p', `${record.origin === 'community' ? text('社区测试', 'Community test') : text('维护者测试', 'Maintainer test')} · ${{unverified: text('自报，未经审核', 'Self-reported, unverified'), reviewed: text('材料已审阅，非独立复现', 'Reviewed; not independently reproduced'), reproduced: text('已独立复现', 'Independently reproduced')}[record.verification]}`, details);
        element('p', `${data.hardware.os} · ${data.hardware.vramBudgetGiB} GiB VRAM / ${data.hardware.ramBudgetGiB} GiB RAM ${text('预算', 'budgets')}`, details);
        element('p', measurementConditions(data, result, getLanguage() === 'en'), details);
      }
    }
    function render() {
      results.replaceChildren();
      if (!gpu.validity.valid) return;
      const input = { gpu: gpu.value };
      renderEstimate(input); renderMeasurements(input);
    }
    find('#hardware-form').addEventListener('change', event => {
      if (event.target === vendor) { syncGpuOptions(); results.replaceChildren(); return; }
      if (event.target === model) syncContexts();
      render();
    });
    return { refreshLanguage() { syncGpuOptions(); render(); } };
  }
  const api = { gpuKey, specification, estimatableGpus, matchHardware, findRecords, measurementConditions, estimateFrom7900XTX, create };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.MoeHardware = api;
})(typeof window === 'undefined' ? globalThis : window);
