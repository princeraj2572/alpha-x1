import { describe, it, expect, vi } from 'vitest';

// benchmark-runner.ts pulls in visual-evaluator.ts -> vision-loader.ts ->
// ort-loader.ts, whose `import('onnxruntime-web/webgpu')` specifier vitest's
// Vite-powered Node runner can't resolve (onnxruntime-web declares
// `"node": null`) — see visual-evaluator.test.ts for the full explanation.
vi.mock('@/privacy/ort-loader', () => ({
  loadOrtModule: vi.fn(async () => {
    throw new Error('onnxruntime-web is browser-only; not available under vitest/Node');
  }),
}));

import { MetricsCollector } from './metrics-collector';
import { BenchmarkRunner } from './benchmark-runner';

describe('MetricsCollector', () => {
  it('averages latency across multiple recorded runs', () => {
    const collector = new MetricsCollector('test-session');
    collector.recordLatency({ domAnalysisMs: 10, totalLatencyMs: 100 });
    collector.recordLatency({ domAnalysisMs: 20, totalLatencyMs: 200 });

    const report = collector.generateReport(2);
    expect(report.latency.domAnalysisMs).toBeCloseTo(15);
    expect(report.latency.totalLatencyMs).toBeCloseTo(150);
    expect(report.iterationCount).toBe(2);
  });

  it('averages resource counts across multiple recorded runs', () => {
    const collector = new MetricsCollector('test-session');
    collector.recordResource({ domElementsCount: 40, redactedElementsCount: 2 });
    collector.recordResource({ domElementsCount: 60, redactedElementsCount: 4 });

    const report = collector.generateReport(2);
    expect(report.resource.domElementsCount).toBeCloseTo(50);
    expect(report.resource.redactedElementsCount).toBeCloseTo(3);
  });

  it('returns all-zero metrics when nothing has been recorded yet', () => {
    const collector = new MetricsCollector('empty-session');
    const report = collector.generateReport(0);
    expect(report.latency.totalLatencyMs).toBe(0);
    expect(report.resource.domElementsCount).toBe(0);
  });

  it('unset fields default to 0, not undefined, when only some are recorded', () => {
    const collector = new MetricsCollector('partial-session');
    collector.recordLatency({ domAnalysisMs: 42 });
    const report = collector.generateReport(1);
    expect(report.latency.domAnalysisMs).toBe(42);
    expect(report.latency.cloudLatencyMs).toBe(0);
  });
});

describe('BenchmarkRunner.evaluateLatency / evaluateResources (real MetricsCollector data)', () => {
  it('categorizes a fast, real-shaped run as passing with no fabricated resource pass', () => {
    const collector = new MetricsCollector('bench-session');
    collector.recordLatency({ domAnalysisMs: 5, piiDetectionMs: 3, totalLatencyMs: 250 });
    collector.recordResource({ domElementsCount: 80, visualElementsCount: 12, redactedElementsCount: 3 });
    const report = collector.generateReport(1);

    const latency = BenchmarkRunner.evaluateLatency(report);
    expect(latency.overall.allTestsPassed).toBe(true);
    expect(latency.perIteration.category).toBe('excellent'); // 250ms < 500ms threshold

    const resources = BenchmarkRunner.evaluateResources(report);
    // No CPU field anywhere — still no reliable in-extension API for it.
    expect(resources.elementCounts.averageDomElements).toBe('80.0');
    expect(resources).not.toHaveProperty('cpu');
    // `performance.memory` doesn't exist under vitest/Node, so jsHeapUsedMb
    // was never recorded for this run — reported as null, not fabricated.
    expect(resources.memory.averageJsHeapUsedMb).toBeNull();
  });

  it('averages jsHeapUsedMb across runs that recorded it, real MetricsCollector data', () => {
    const collector = new MetricsCollector('heap-session');
    collector.recordLatency({ totalLatencyMs: 100 });
    collector.recordResource({ domElementsCount: 10, jsHeapUsedMb: 20 });
    collector.recordResource({ domElementsCount: 10, jsHeapUsedMb: 40 });
    const report = collector.generateReport(2);

    expect(report.resource.jsHeapUsedMb).toBeCloseTo(30);

    const resources = BenchmarkRunner.evaluateResources(report);
    expect(resources.memory.averageJsHeapUsedMb).toBe('30.0');
  });

  it('does not let an unmeasured run pull down the average of runs that did measure jsHeapUsedMb', () => {
    const collector = new MetricsCollector('mixed-session');
    collector.recordResource({ domElementsCount: 10, jsHeapUsedMb: 50 });
    collector.recordResource({ domElementsCount: 10 }); // no performance.memory this run
    const report = collector.generateReport(2);

    expect(report.resource.jsHeapUsedMb).toBe(50);
  });
});
