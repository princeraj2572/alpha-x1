/**
 * Metrics Collector
 * Collects and aggregates performance and accuracy metrics.
 *
 * Field names match `ui/state/types.ts`'s `Metrics` (what `pipeline-runner.ts`
 * actually measures and `agentStore.setMetrics` actually stores) — this used
 * to use a different phase-name shape (`phaseObserveMs`, `phaseReasonMs`, ...)
 * matching the `agent/loop.ts` prototype removed elsewhere this session,
 * which was this collector's only real producer. See DECISION-031's revisit
 * note and the follow-up decision documenting this wiring.
 */

export interface LatencyMetrics {
  domAnalysisMs: number;
  piiDetectionMs: number;
  visionInferenceMs: number;
  fusionMs: number;
  redactionMs: number;
  networkLatencyMs: number;
  cloudLatencyMs: number;
  totalLatencyMs: number;
}

/**
 * `cpuPercentage` deliberately does NOT exist here — there's still no
 * reliable in-extension CPU API, and wiring a fake/zero value in would make
 * `BenchmarkRunner.evaluateResources()` trivially "pass" a resource budget
 * nothing actually measured — the same false-confidence failure mode
 * DECISION-031 called out for the visual evaluator.
 *
 * `jsHeapUsedMb` DOES exist, per DECISION-031's own revisit note ("if real
 * memory ... measurement becomes feasible, e.g. `performance.memory` where
 * available"). It's optional and honestly labeled: Chrome-only (not in
 * lib.dom.d.ts, absent in Firefox/Safari/Node), approximate (Chrome
 * buckets/rounds the value for privacy), and JS heap only — not full process
 * memory. `getJsHeapUsedMb()` returns `undefined` wherever it isn't
 * available; never fabricated as 0.
 */
export interface ResourceMetrics {
  domElementsCount: number;
  visualElementsCount: number;
  redactedElementsCount: number;
  jsHeapUsedMb?: number;
}

interface ChromePerformanceMemory {
  usedJSHeapSize: number;
  totalJSHeapSize: number;
  jsHeapSizeLimit: number;
}

/**
 * Reads Chrome's non-standard `performance.memory.usedJSHeapSize`, in MB.
 * Returns `undefined` anywhere it doesn't exist (Firefox, Safari, Node/vitest)
 * rather than a fabricated 0 — see `ResourceMetrics.jsHeapUsedMb`.
 */
export function getJsHeapUsedMb(): number | undefined {
  const memory = (performance as Performance & { memory?: ChromePerformanceMemory }).memory;
  return memory ? memory.usedJSHeapSize / (1024 * 1024) : undefined;
}

export interface AccuracyMetrics {
  actionSuccessRate: number;
  stateChangeDetectionRate: number;
  confidenceScores: number[];
  failureReasons: string[];
}

export interface PrivacyMetrics {
  piiDetected: number;
  piiRedacted: number;
  piiPrecision: number; // true positives / (true positives + false positives)
  piiRecall: number; // true positives / (true positives + false negatives)
  facesDetected: number;
  facesRedacted: number;
}

export interface EvaluationReport {
  sessionId: string;
  startTime: number;
  endTime: number;
  durationMs: number;
  iterationCount: number;
  latency: LatencyMetrics;
  resource: ResourceMetrics;
  accuracy: AccuracyMetrics;
  privacy: PrivacyMetrics;
}

export class MetricsCollector {
  private sessionId: string;
  private startTime: number;
  private measurements: {
    latencies: LatencyMetrics[];
    resources: ResourceMetrics[];
    accuracies: AccuracyMetrics[];
    privacyEvents: PrivacyMetrics[];
  } = {
    latencies: [],
    resources: [],
    accuracies: [],
    privacyEvents: [],
  };

  constructor(sessionId: string) {
    this.sessionId = sessionId;
    this.startTime = performance.now();
  }

  /**
   * Record latency metrics for an iteration
   */
  recordLatency(metrics: Partial<LatencyMetrics>): void {
    const fullMetrics: LatencyMetrics = {
      domAnalysisMs: metrics.domAnalysisMs ?? 0,
      piiDetectionMs: metrics.piiDetectionMs ?? 0,
      visionInferenceMs: metrics.visionInferenceMs ?? 0,
      fusionMs: metrics.fusionMs ?? 0,
      redactionMs: metrics.redactionMs ?? 0,
      networkLatencyMs: metrics.networkLatencyMs ?? 0,
      cloudLatencyMs: metrics.cloudLatencyMs ?? 0,
      totalLatencyMs: metrics.totalLatencyMs ?? 0,
    };
    this.measurements.latencies.push(fullMetrics);
  }

  /**
   * Record resource usage metrics
   */
  recordResource(metrics: Partial<ResourceMetrics>): void {
    const fullMetrics: ResourceMetrics = {
      domElementsCount: metrics.domElementsCount ?? 0,
      visualElementsCount: metrics.visualElementsCount ?? 0,
      redactedElementsCount: metrics.redactedElementsCount ?? 0,
      jsHeapUsedMb: metrics.jsHeapUsedMb,
    };
    this.measurements.resources.push(fullMetrics);
  }

  /**
   * Record action accuracy metrics
   */
  recordAccuracy(metrics: Partial<AccuracyMetrics>): void {
    const fullMetrics: AccuracyMetrics = {
      actionSuccessRate: metrics.actionSuccessRate ?? 0,
      stateChangeDetectionRate: metrics.stateChangeDetectionRate ?? 0,
      confidenceScores: metrics.confidenceScores ?? [],
      failureReasons: metrics.failureReasons ?? [],
    };
    this.measurements.accuracies.push(fullMetrics);
  }

  /**
   * Record privacy detection metrics
   */
  recordPrivacy(metrics: Partial<PrivacyMetrics>): void {
    const fullMetrics: PrivacyMetrics = {
      piiDetected: metrics.piiDetected ?? 0,
      piiRedacted: metrics.piiRedacted ?? 0,
      piiPrecision: metrics.piiPrecision ?? 0,
      piiRecall: metrics.piiRecall ?? 0,
      facesDetected: metrics.facesDetected ?? 0,
      facesRedacted: metrics.facesRedacted ?? 0,
    };
    this.measurements.privacyEvents.push(fullMetrics);
  }

  /**
   * Calculate average latency metrics
   */
  private getAverageLatency(): LatencyMetrics {
    if (this.measurements.latencies.length === 0) {
      return {
        domAnalysisMs: 0,
        piiDetectionMs: 0,
        visionInferenceMs: 0,
        fusionMs: 0,
        redactionMs: 0,
        networkLatencyMs: 0,
        cloudLatencyMs: 0,
        totalLatencyMs: 0,
      };
    }

    const sum = this.measurements.latencies.reduce(
      (acc, m) => ({
        domAnalysisMs: acc.domAnalysisMs + m.domAnalysisMs,
        piiDetectionMs: acc.piiDetectionMs + m.piiDetectionMs,
        visionInferenceMs: acc.visionInferenceMs + m.visionInferenceMs,
        fusionMs: acc.fusionMs + m.fusionMs,
        redactionMs: acc.redactionMs + m.redactionMs,
        networkLatencyMs: acc.networkLatencyMs + m.networkLatencyMs,
        cloudLatencyMs: acc.cloudLatencyMs + m.cloudLatencyMs,
        totalLatencyMs: acc.totalLatencyMs + m.totalLatencyMs,
      }),
      {
        domAnalysisMs: 0,
        piiDetectionMs: 0,
        visionInferenceMs: 0,
        fusionMs: 0,
        redactionMs: 0,
        networkLatencyMs: 0,
        cloudLatencyMs: 0,
        totalLatencyMs: 0,
      }
    );

    const count = this.measurements.latencies.length;
    return {
      domAnalysisMs: sum.domAnalysisMs / count,
      piiDetectionMs: sum.piiDetectionMs / count,
      visionInferenceMs: sum.visionInferenceMs / count,
      fusionMs: sum.fusionMs / count,
      redactionMs: sum.redactionMs / count,
      networkLatencyMs: sum.networkLatencyMs / count,
      cloudLatencyMs: sum.cloudLatencyMs / count,
      totalLatencyMs: sum.totalLatencyMs / count,
    };
  }

  /**
   * Calculate average resource metrics
   */
  private getAverageResource(): ResourceMetrics {
    if (this.measurements.resources.length === 0) {
      return { domElementsCount: 0, visualElementsCount: 0, redactedElementsCount: 0 };
    }

    const sum = this.measurements.resources.reduce(
      (acc, m) => ({
        domElementsCount: acc.domElementsCount + m.domElementsCount,
        visualElementsCount: acc.visualElementsCount + m.visualElementsCount,
        redactedElementsCount: acc.redactedElementsCount + m.redactedElementsCount,
      }),
      { domElementsCount: 0, visualElementsCount: 0, redactedElementsCount: 0 }
    );

    const count = this.measurements.resources.length;
    const heapSamples = this.measurements.resources
      .map((m) => m.jsHeapUsedMb)
      .filter((v): v is number => v !== undefined);

    return {
      domElementsCount: sum.domElementsCount / count,
      visualElementsCount: sum.visualElementsCount / count,
      redactedElementsCount: sum.redactedElementsCount / count,
      jsHeapUsedMb:
        heapSamples.length > 0 ? heapSamples.reduce((a, b) => a + b, 0) / heapSamples.length : undefined,
    };
  }

  /**
   * Calculate average accuracy metrics
   */
  private getAverageAccuracy(): AccuracyMetrics {
    if (this.measurements.accuracies.length === 0) {
      return {
        actionSuccessRate: 0,
        stateChangeDetectionRate: 0,
        confidenceScores: [],
        failureReasons: [],
      };
    }

    const allConfidences = this.measurements.accuracies.flatMap((a) => a.confidenceScores);
    const allReasons = this.measurements.accuracies.flatMap((a) => a.failureReasons);

    const avgSuccessRate =
      this.measurements.accuracies.reduce((sum, a) => sum + a.actionSuccessRate, 0) /
      this.measurements.accuracies.length;

    const avgDetectionRate =
      this.measurements.accuracies.reduce((sum, a) => sum + a.stateChangeDetectionRate, 0) /
      this.measurements.accuracies.length;

    return {
      actionSuccessRate: avgSuccessRate,
      stateChangeDetectionRate: avgDetectionRate,
      confidenceScores: allConfidences,
      failureReasons: allReasons,
    };
  }

  /**
   * Calculate average privacy metrics
   */
  private getAveragePrivacy(): PrivacyMetrics {
    if (this.measurements.privacyEvents.length === 0) {
      return {
        piiDetected: 0,
        piiRedacted: 0,
        piiPrecision: 0,
        piiRecall: 0,
        facesDetected: 0,
        facesRedacted: 0,
      };
    }

    const sum = this.measurements.privacyEvents.reduce(
      (acc, m) => ({
        piiDetected: acc.piiDetected + m.piiDetected,
        piiRedacted: acc.piiRedacted + m.piiRedacted,
        piiPrecision: acc.piiPrecision + m.piiPrecision,
        piiRecall: acc.piiRecall + m.piiRecall,
        facesDetected: acc.facesDetected + m.facesDetected,
        facesRedacted: acc.facesRedacted + m.facesRedacted,
      }),
      {
        piiDetected: 0,
        piiRedacted: 0,
        piiPrecision: 0,
        piiRecall: 0,
        facesDetected: 0,
        facesRedacted: 0,
      }
    );

    const count = this.measurements.privacyEvents.length;
    return {
      piiDetected: Math.round(sum.piiDetected / count),
      piiRedacted: Math.round(sum.piiRedacted / count),
      piiPrecision: sum.piiPrecision / count,
      piiRecall: sum.piiRecall / count,
      facesDetected: Math.round(sum.facesDetected / count),
      facesRedacted: Math.round(sum.facesRedacted / count),
    };
  }

  /**
   * Generate evaluation report
   */
  generateReport(iterationCount: number): EvaluationReport {
    const endTime = performance.now();

    return {
      sessionId: this.sessionId,
      startTime: this.startTime,
      endTime: endTime,
      durationMs: endTime - this.startTime,
      iterationCount,
      latency: this.getAverageLatency(),
      resource: this.getAverageResource(),
      accuracy: this.getAverageAccuracy(),
      privacy: this.getAveragePrivacy(),
    };
  }

  /**
   * Export report as JSON
   */
  exportReport(iterationCount: number): string {
    const report = this.generateReport(iterationCount);
    return JSON.stringify(report, null, 2);
  }

  /**
   * Get raw measurements
   */
  getMeasurements() {
    return {
      latencies: [...this.measurements.latencies],
      resources: [...this.measurements.resources],
      accuracies: [...this.measurements.accuracies],
      privacyEvents: [...this.measurements.privacyEvents],
    };
  }
}

export const createMetricsCollector = (sessionId: string) => new MetricsCollector(sessionId);
