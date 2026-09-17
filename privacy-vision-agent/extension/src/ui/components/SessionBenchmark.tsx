import { BenchmarkRunner } from '@/evaluation/benchmark-runner';
import { metricsCollector } from '../state/pipeline-runner';
import { useAgentStore } from '../state/agent-store';
import { Card, Row, c } from './primitives';

/**
 * Aggregate latency/resource view across every inspection run this panel
 * session has done — DECISION-031's follow-up: metricsCollector now has a
 * real producer (pipeline-runner.ts), this is its first real consumer.
 * Hidden until at least one run has completed so it doesn't clutter the
 * panel on first load.
 */
export function SessionBenchmark() {
  // Subscribing here isn't about this component's own state — it's the
  // re-render trigger: metricsCollector is a plain singleton outside
  // agentStore, and a new run's data is only visible on the NEXT render
  // after agentStore itself changes (every stage update ends up here).
  useAgentStore();

  const measurements = metricsCollector.getMeasurements();
  const runCount = measurements.latencies.length;
  if (runCount === 0) {
    return null;
  }

  const report = metricsCollector.generateReport(runCount);
  const latency = BenchmarkRunner.evaluateLatency(report);
  const resources = BenchmarkRunner.evaluateResources(report);

  return (
    <Card title={`Session Benchmark — ${runCount} run${runCount === 1 ? '' : 's'}`}>
      <Row
        label="Avg local pipeline"
        value={`${latency.perIteration.averageTimeMs} ms (${latency.perIteration.category})`}
        mono
      />
      <Row
        label="Avg end-to-end"
        value={`${latency.endToEnd.averageTimeMs} ms (${latency.endToEnd.category})`}
        mono
      />
      <Row label="Avg DOM elements" value={resources.elementCounts.averageDomElements} mono />
      <Row label="Avg visual elements" value={resources.elementCounts.averageVisualElements} mono />
      <Row label="Avg redacted elements" value={resources.elementCounts.averageRedactedElements} mono />
      {resources.memory.averageJsHeapUsedMb !== null && (
        <Row label="Avg JS heap used" value={`${resources.memory.averageJsHeapUsedMb} MB`} mono />
      )}
      <p style={{ fontSize: 10, color: c.dim, marginTop: 6 }}>{resources.note}</p>
    </Card>
  );
}
