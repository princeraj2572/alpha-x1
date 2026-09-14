/**
 * Benchmark harness for the local detection layer.
 *
 * Two jobs:
 *   1. Measure the regex/DOM/fusion/redaction pipeline against a labelled
 *      synthetic dataset -> precision / recall / F1, latency.
 *   2. Compare candidate vision models (YOLO11n vs alternatives) on the same
 *      inputs -> load time, inference latency, execution provider, memory.
 *
 * Results are returned as plain objects for the evaluation UI and for
 * DECISIONS.md. Numbers are always measured, never fabricated — if a model
 * file is absent the entry is marked `skipped`.
 */

import { PrivacyFinding, PrivacyType } from './types';
import { RegexDetector, regexDetector } from './regex-detector';
import { classifyField, FieldDescriptor } from './dom-rules';
import { VisionModel, VisionModelConfig } from './vision-model';
import { ImageLike } from './redactor';
import { SYNTHETIC_TEXT_CASES, SYNTHETIC_FIELD_CASES } from './synthetic-dataset';

export interface DetectionMetrics {
  total: number;
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
  precision: number;
  recall: number;
  f1: number;
}

export interface RegexBenchmarkResult {
  text: DetectionMetrics;
  fields: DetectionMetrics;
  avgScanMs: number;
  casesPerSecond: number;
}

export function benchmarkRegex(detector: RegexDetector = regexDetector): RegexBenchmarkResult {
  // --- text cases ---
  let tp = 0;
  let fp = 0;
  let fn = 0;
  const start = now();
  for (const c of SYNTHETIC_TEXT_CASES) {
    const findings = detector.scan(c.text);
    const detectedTypes = new Set(findings.map((f) => f.type));
    const expected = new Set(c.expectedTypes);

    for (const t of expected) {
      if (detectedTypes.has(t)) {
        tp++;
      } else {
        fn++;
      }
    }
    for (const t of detectedTypes) {
      if (!expected.has(t)) {
        fp++;
      }
    }
  }
  const elapsed = now() - start;
  const text = metrics(tp, fp, fn);

  // --- field cases ---
  let ftp = 0;
  let ffp = 0;
  let ffn = 0;
  for (const c of SYNTHETIC_FIELD_CASES) {
    const cls = classifyField(c.field as FieldDescriptor);
    const detected = cls?.type ?? null;
    if (c.expectedType === null) {
      if (detected !== null) {
        ffp++;
      }
    } else if (detected === c.expectedType) {
      ftp++;
    } else if (detected === null) {
      ffn++;
    } else {
      // wrong category counts as both a miss and a false alarm
      ffn++;
      ffp++;
    }
  }

  return {
    text,
    fields: metrics(ftp, ffp, ffn),
    avgScanMs: round3(elapsed / SYNTHETIC_TEXT_CASES.length),
    casesPerSecond: Math.round((SYNTHETIC_TEXT_CASES.length / elapsed) * 1000),
  };
}

export interface VisionModelBenchmarkEntry {
  name: string;
  status: 'ok' | 'skipped' | 'error';
  executionProvider?: string;
  loadMs?: number;
  avgInferenceMs?: number;
  runs?: number;
  note?: string;
}

/**
 * Benchmark one vision model. `iterations` inference passes over a supplied
 * ImageData. Returns a skipped entry (not an error) when the model file is
 * missing, so the harness can run in environments without models.
 */
export async function benchmarkVisionModel(
  name: string,
  config: VisionModelConfig,
  sample: ImageLike,
  iterations = 10
): Promise<VisionModelBenchmarkEntry> {
  const model = new VisionModel();
  const loadStart = now();
  try {
    await model.init(config);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/fetch failed|404|not found|could not create a session/i.test(message)) {
      return { name, status: 'skipped', note: `model unavailable: ${message}` };
    }
    return { name, status: 'error', note: message };
  }
  const loadMs = round3(now() - loadStart);

  let totalInfer = 0;
  for (let i = 0; i < iterations; i++) {
    const s = now();
    await model.detectFindings(sample);
    totalInfer += now() - s;
  }

  return {
    name,
    status: 'ok',
    executionProvider: model.getExecutionProvider(),
    loadMs,
    avgInferenceMs: round3(totalInfer / iterations),
    runs: iterations,
  };
}

export interface FullBenchmarkReport {
  timestamp: string;
  regex: RegexBenchmarkResult;
  visionModels: VisionModelBenchmarkEntry[];
  environment: {
    webgpu: boolean;
    hardwareConcurrency: number;
    userAgent: string;
  };
}

export async function runFullBenchmark(
  visionCandidates: Array<{ name: string; config: VisionModelConfig }> = [],
  sample?: ImageLike
): Promise<FullBenchmarkReport> {
  const regex = benchmarkRegex();
  const visionModels: VisionModelBenchmarkEntry[] = [];
  if (sample) {
    for (const candidate of visionCandidates) {
      visionModels.push(await benchmarkVisionModel(candidate.name, candidate.config, sample));
    }
  }
  const nav = (globalThis.navigator ?? {}) as Navigator & { gpu?: unknown };
  return {
    timestamp: new Date().toISOString(),
    regex,
    visionModels,
    environment: {
      webgpu: Boolean(nav.gpu),
      hardwareConcurrency: nav.hardwareConcurrency ?? 0,
      userAgent: nav.userAgent ?? 'unknown',
    },
  };
}

/** Render a benchmark report as text for DECISIONS.md. */
export function formatBenchmarkReport(report: FullBenchmarkReport): string {
  const lines: string[] = [];
  lines.push(`# Local Detection Benchmark — ${report.timestamp}`);
  lines.push('');
  lines.push('## Regex / DOM pipeline');
  lines.push(`- text precision: ${(report.regex.text.precision * 100).toFixed(1)}%`);
  lines.push(`- text recall:    ${(report.regex.text.recall * 100).toFixed(1)}%`);
  lines.push(`- text F1:        ${(report.regex.text.f1 * 100).toFixed(1)}%`);
  lines.push(`- field precision: ${(report.regex.fields.precision * 100).toFixed(1)}%`);
  lines.push(`- field recall:    ${(report.regex.fields.recall * 100).toFixed(1)}%`);
  lines.push(`- avg scan: ${report.regex.avgScanMs} ms/case (${report.regex.casesPerSecond} cases/s)`);
  lines.push('');
  lines.push('## Vision models');
  if (report.visionModels.length === 0) {
    lines.push('- (no candidates supplied / no sample image)');
  }
  for (const m of report.visionModels) {
    if (m.status === 'ok') {
      lines.push(`- ${m.name}: EP=${m.executionProvider}, load=${m.loadMs}ms, infer=${m.avgInferenceMs}ms avg (${m.runs} runs)`);
    } else {
      lines.push(`- ${m.name}: ${m.status} — ${m.note ?? ''}`);
    }
  }
  lines.push('');
  lines.push('## Environment');
  lines.push(`- WebGPU: ${report.environment.webgpu}`);
  lines.push(`- CPU threads: ${report.environment.hardwareConcurrency}`);
  return lines.join('\n');
}

function metrics(tp: number, fp: number, fn: number): DetectionMetrics {
  const precision = tp + fp === 0 ? 1 : tp / (tp + fp);
  const recall = tp + fn === 0 ? 1 : tp / (tp + fn);
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  return {
    total: tp + fn,
    truePositives: tp,
    falsePositives: fp,
    falseNegatives: fn,
    precision: round3(precision),
    recall: round3(recall),
    f1: round3(f1),
  };
}

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}
function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/** Re-export for tests. */
export type { PrivacyFinding, PrivacyType };
