import { useState } from 'react';
import { BenchmarkRunner, BenchmarkReport } from '@/evaluation/benchmark-runner';
import { metricsCollector } from '../state/pipeline-runner';
import { captureActiveTab, dataUrlToImageData, imageDataToCanvas } from '../state/screenshot';
import { useAgentStore } from '../state/agent-store';
import { Card, Row, Button, c } from './primitives';

type VisualSummary = BenchmarkReport['sihMetrics']['visualContextAccuracy'];

/**
 * Aggregate latency/resource view across every inspection run this panel
 * session has done — DECISION-031's follow-up: metricsCollector now has a
 * real producer (pipeline-runner.ts), this is its first real consumer.
 * Hidden until at least one run has completed so it doesn't clutter the
 * panel on first load.
 *
 * The "Run visual accuracy check" button is the first real UI call site for
 * `BenchmarkRunner.runFullEvaluation()` — until now it only ran under tests.
 * It captures a fresh screenshot on demand (the same `captureActiveTab` ->
 * `dataUrlToImageData` -> `imageDataToCanvas` path `pipeline-runner.ts` uses
 * for the live pipeline) and feeds it straight to the real detectors via
 * `VisualEvaluator`. Only the resulting counts/timing land in component
 * state — the decoded pixels never leave this handler's scope, matching
 * DECISION-020's boundary even though this path is local-only evaluation
 * tooling, not the transmit path that decision was written for.
 */
export function SessionBenchmark() {
  // Subscribing here isn't about this component's own state — it's the
  // re-render trigger: metricsCollector is a plain singleton outside
  // agentStore, and a new run's data is only visible on the NEXT render
  // after agentStore itself changes (every stage update ends up here).
  useAgentStore();

  const [checkingVisual, setCheckingVisual] = useState(false);
  const [visualError, setVisualError] = useState<string | null>(null);
  const [visualSummary, setVisualSummary] = useState<VisualSummary | null>(null);

  const measurements = metricsCollector.getMeasurements();
  const runCount = measurements.latencies.length;
  if (runCount === 0) {
    return null;
  }

  const report = metricsCollector.generateReport(runCount);
  const latency = BenchmarkRunner.evaluateLatency(report);
  const resources = BenchmarkRunner.evaluateResources(report);

  async function runVisualCheck() {
    setCheckingVisual(true);
    setVisualError(null);
    try {
      const raw = await captureActiveTab();
      const image = await dataUrlToImageData(raw.dataUrl);
      const canvas = imageDataToCanvas(image);
      const full = await BenchmarkRunner.runFullEvaluation(metricsCollector, runCount, { canvas, image });
      console.log(BenchmarkRunner.formatReport(full));
      setVisualSummary(full.sihMetrics.visualContextAccuracy);
    } catch (err) {
      setVisualError(err instanceof Error ? err.message : String(err));
    } finally {
      setCheckingVisual(false);
    }
  }

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

      <Button onClick={runVisualCheck} disabled={checkingVisual}>
        {checkingVisual ? 'Capturing…' : 'Run visual accuracy check'}
      </Button>
      {visualError && (
        <p style={{ fontSize: 11, color: c.bad, marginTop: 6 }}>Visual check failed: {visualError}</p>
      )}
      {visualSummary && !visualSummary.measured && (
        <p style={{ fontSize: 11, color: c.dim, marginTop: 6 }}>
          Visual accuracy not measured — {visualSummary.reason ?? 'unknown reason'}
        </p>
      )}
      {visualSummary?.measured && (
        <>
          <Row
            label="Visual object / face findings"
            value={`${visualSummary.detection?.objectFindingsCount} / ${visualSummary.detection?.faceFindingsCount}`}
            mono
          />
          <Row label="Visual inference time" value={`${visualSummary.detection?.inferenceTimeMs} ms`} mono />
        </>
      )}
    </Card>
  );
}
