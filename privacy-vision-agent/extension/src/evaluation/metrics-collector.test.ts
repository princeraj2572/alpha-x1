import { describe, it, expect } from 'vitest';
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
    // No memory/CPU field anywhere — only counts that were actually recorded.
    expect(resources.elementCounts.averageDomElements).toBe('80.0');
    expect(resources).not.toHaveProperty('memory');
    expect(resources).not.toHaveProperty('cpu');
  });
});
