import { gzipSync } from 'node:zlib';
import { generatedSummary, oneLine, sha256 } from '../community/submission-codec.mjs';

export async function packFixture(kind, payload) {
  const decoded = new TextEncoder().encode(JSON.stringify(payload)), compressed = gzipSync(decoded, { level: 9, mtime: 0 });
  const summary = generatedSummary(kind, payload).map(line => oneLine(line, 500));
  const lines = ['MOE4ALL-SUBMISSION/1', `kind: ${kind}`, `schema: ${kind}/1`, `id: ${payload.id}`, `created-at: ${payload.created_at_utc}`, `engine: ${payload.engine_version}`, 'encoding: gzip+base64', `decoded-bytes: ${decoded.length}`, `compressed-bytes: ${compressed.length}`, `sha256: ${await sha256(decoded)}`, `summary-count: ${summary.length}`, ...summary.map((line, i) => `summary-${String(i + 1).padStart(3, '0')}: ${line}`), '', '-----BEGIN MOE4ALL PAYLOAD-----', ...compressed.toString('base64').match(/.{1,76}/g), '-----END MOE4ALL PAYLOAD-----', ''];
  return lines.join('\n');
}

export function benchmarkFixture(index = 0, manual = false) {
  const devices = [
    ['AMD Radeon RX 7900 XTX', 'AMD Ryzen 9 7950X', 24, 64, 80.49],
    ['NVIDIA GeForce RTX 4090', 'Intel Core i9-14900K', 24, 96, 103.2],
    ['NVIDIA GeForce RTX 3090', 'AMD Ryzen 9 5950X', 24, 64, 67.8],
    ['AMD Radeon RX 7900 GRE', 'AMD Ryzen 7 7800X3D', 16, 64, 49.6],
    ['Intel Arc A770', 'Intel Core i7-13700K', 16, 64, 33.1],
    ['Apple M4 Max', 'Apple M4 Max', 64, 64, 60.2],
    ['NVIDIA GeForce RTX 4070 Ti', 'AMD Ryzen 9 7900', 12, 64, 46.4],
    ['AMD Radeon RX 6800 XT', 'AMD Ryzen 7 5800X', 16, 64, 41.2]
  ];
  const d = devices[index % devices.length], scale = index >= 8 ? .63 : 1;
  return {
    schema_version: 1, id: `example-benchmark-${String(index).padStart(2, '0')}${manual ? '-manual' : ''}`, created_at_utc: '2026-10-19T01:02:03.004Z', engine_version: '1.0.3', engine_commit: null, profile: manual ? 'manual' : 'standard',
    model: { name: index >= 8 ? 'Qwen3.8-Flash-Next-176B-4.27bpw.gguf' : 'Qwen3.6-35B-A3B-I-Balanced.gguf', architecture: index >= 8 ? 'qwen4exp' : 'qwen35moe', storage_bytes: index >= 8 ? 56000000000 : 25500000000 },
    hardware: { os: index === 5 ? 'macos' : index % 2 ? 'linux' : 'windows', architecture: index === 5 ? 'aarch64' : 'x86_64', cpu: { name: d[1], logical_threads: 16 }, ram: { total_bytes: d[3] * 1073741824 }, gpu: { name: d[0], vram_total_bytes: d[2] * 1073741824 } },
    configuration: { backend: index === 5 ? 'Metal' : 'Vulkan', auto_profile: manual ? 'manual' : 'aggressive', mtp: false, kv_type_k: 'q8_0', kv_type_v: 'q8_0', ubatch: 4096, max_parallel: 3, repetitions: 3 }, estimate: {}, startup: {},
    contexts: [6144, 30720, 153600].map(tokens => ({
      requested_context_tokens: tokens, actual_prompt_tokens: [tokens], decode_measurement_start_tokens: [tokens + 512], decode_measurement_end_tokens: [tokens + 1536],
      prefill: manual ? null : { tokens_per_second: (tokens > 100000 ? 1169.4 : 2749.06) * scale * (d[4] / 80.49), evaluated_tokens: tokens, actual_prompt_tokens: tokens, seconds: 10, setup_seconds: 0, setup_slots: 3 },
      decode: manual ? [] : [1, 2, 3].map(parallel => {
        const rate = Number((d[4] * scale * (tokens > 100000 ? .52 : 1) * [0, 1, 1.47, 1.38][parallel]).toFixed(2));
        return { parallel, overall_tokens_per_second: rate, section_mean_tokens_per_second: [rate * .98, rate, rate * 1.02], repetitions: [0, 1, 2].map(() => ({ sections: [0, 1, 2].map(() => ({ tokens: 342, seconds: 342 * parallel / rate, tokens_per_second: rate })), overall: { tokens: 1024 * parallel, seconds: 1024 * parallel / rate, tokens_per_second: rate }, lane_tokens_per_second: [0, 1, 2].map(() => Array(parallel).fill(rate / parallel)) })) };
      }), ...(manual ? { manual_result: { kind: 'decode', average_tokens_per_second: d[4], raw: { avg_ts: d[4] } } } : {}), failures: []
    })), failures: []
  };
}
export function errorFixture(index = 0, description = '发送第一条消息后程序退出，重启后仍然出现。') {
  return {
    schema_version: 1, id: `example-error-${index}`, created_at_utc: '2026-10-19T01:02:03.004Z', engine_version: '1.0.3', engine_commit: null,
    failure_kind: index > 1 ? 'runtime' : 'fatal', description, engine: { version: '1.0.3', commit: null },
    hardware: benchmarkFixture().hardware, model: benchmarkFixture().model, launch: { command: 'serve', arguments: ['--parallel', '2'] },
    error: { message: index > 1 ? 'Unexpected generation stop during session restore' : 'Vulkan runtime arena: contiguous allocation failed', chain: ['backend: Vulkan runtime', 'contiguous allocation failed'] },
    logs: { startup: ['INFO device selected: AMD Radeon RX 7900 XTX', 'INFO unified arena ready'], tail: ['WARN allocation retry exhausted'], dropped_events: 0, speed_statistics_included: false },
    privacy: { prompt_or_response_included: false, local_paths_redacted: true, api_keys_included: false }
  };
}
