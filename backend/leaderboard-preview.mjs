import { benchmarkFixture } from './fixtures.mjs';
import { indexArtifacts } from '../scripts/build-leaderboard.mjs';

// Only the loopback server imports this module. CI reads immutable Git originals instead.
export function previewIndex() {
  const entries = [];
  for (let i = 0; i < 16; i++) {
    const p = benchmarkFixture(i), gpu = p.hardware.gpu;
    p.configuration.real_context = true;
    p.configuration.decode_warmup_tokens_per_rep = 512;
    p.configuration.decode_tokens_per_rep = 1024;
    p.configuration.host_dma = true;
    p.configuration.configured_ram_budget = '48GiB';
    p.configuration.configured_vram_budget = '24GiB';
    p.hardware.ram.memory_generation = i === 5 ? 'LPDDR5X' : 'DDR5';
    p.hardware.ram.module_count = i === 5 ? null : 2;
    p.hardware.ram.modules = [{ configured_speed_mt_s: i === 5 ? 8533 : 6000 }];
    Object.assign(gpu, { unified_memory: i === 5, integrated: i === 5, pcie_generation: i === 5 ? null : 4, pcie_width: i === 5 ? null : 16, pcie_max_generation: i === 5 ? null : 4, pcie_max_width: i === 5 ? null : 16 });
    p.hardware.model_storage = { model: ['Samsung SSD 990 PRO 2TB', 'WD_BLACK SN850X 2TB'][i % 2], media_type: 'SSD', bus_type: 'NVMe', read_probe: { mode: 'buffered_read_only_before_benchmark', sequential: { mib_per_second: 3400 + i * 57 }, random_64k: { mib_per_second: 950 + i * 13, iops: 15200 + i * 208 }, cache_disposition: i % 3 ? 'mostly_physical' : 'mostly_cached', physical_read_fraction: i % 3 ? .92 : .03 } };
    for (const tokens of [12288, 24576, 65536, 98304]) {
      const c = structuredClone(p.contexts[0]); c.requested_context_tokens = tokens;
      c.actual_prompt_tokens = [tokens]; c.decode_measurement_start_tokens = [tokens + 512]; c.decode_measurement_end_tokens = [tokens + 1536];
      for (const d of c.decode) { d.overall_tokens_per_second *= tokens > 32768 ? .78 : .96; d.section_mean_tokens_per_second = d.section_mean_tokens_per_second.map(n => n * (tokens > 32768 ? .78 : .96)); }
      p.contexts.push(c);
    }
    entries.push({ payload: p, demo: true });
    if (i % 3 === 0) {
      const conservative = structuredClone(p); conservative.id += '-conservative'; conservative.configuration.auto_profile = 'conservative'; conservative.configuration.ubatch = 2048;
      for (const c of conservative.contexts) for (const d of c.decode) { d.overall_tokens_per_second *= .94; d.section_mean_tokens_per_second = d.section_mean_tokens_per_second.map(n => n * .94); }
      entries.push({ payload: conservative, demo: true });
    }
    if (i >= 8) {
      const mtp = structuredClone(p); mtp.id += '-mtp'; mtp.configuration.mtp = true;
      for (const c of mtp.contexts) for (const d of c.decode) { d.overall_tokens_per_second *= d.parallel === 1 ? 1.24 : 1.12; d.section_mean_tokens_per_second = d.section_mean_tokens_per_second.map(n => n * (d.parallel === 1 ? 1.24 : 1.12)); }
      entries.push({ payload: mtp, demo: true });
    }
  }
  for (const [i, kind] of [[1, 'decode'], [2, 'prefill']]) {
    const manual = benchmarkFixture(i, true); manual.configuration.auto_profile = 'manual';
    for (const c of manual.contexts) { c.manual_result.kind = kind; if (kind === 'prefill') c.manual_result.average_tokens_per_second *= 20; }
    entries.push({ payload: manual, demo: true });
  }
  return indexArtifacts(entries, { mode: 'preview', source: null, generatedAt: '2026-10-19T00:00:00Z' });
}
