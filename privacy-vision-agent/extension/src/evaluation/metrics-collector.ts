/**
 * Metrics Collector
 * Collects and aggregates performance and accuracy metrics
 */

export interface LatencyMetrics {
  phaseObserveMs: number;
  phaseSanitizeMs: number;
  phaseReasonMs: number;
  phaseValidateMs: number;
  phaseExecuteMs: number;
  phaseDetectMs: number;
  iterationTotalMs: number;
  endToEndMs: number;
}

export interface ResourceMetrics {
  memoryUsageMb: number;
  cpuPercentage: number;
  domElementsCount: number;
  visualElementsCount: number;
  redactedElementsCount: number;
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
      phaseObserveMs: metrics.phaseObserveMs ?? 0,
      phaseSanitizeMs: metrics.phaseSanitizeMs ?? 0,
      phaseReasonMs: metrics.phaseReasonMs ?? 0,
      phaseValidateMs: metrics.phaseValidateMs ?? 0,
      phaseExecuteMs: metrics.phaseExecuteMs ?? 0,
      phaseDetectMs: metrics.phaseDetectMs ?? 0,
      iterationTotalMs: metrics.iterationTotalMs ?? 0,
      endToEndMs: metrics.endToEndMs ?? 0,
    };
    this.measurements.latencies.push(fullMetrics);
  }

  /**
   * Record resource usage metrics
   */
  recordResource(metrics: Partial<ResourceMetrics>): void {
    const fullMetrics: ResourceMetrics = {
      memoryUsageMb: metrics.memoryUsageMb ?? 0,
      cpuPercentage: metrics.cpuPercentage ?? 0,
      domElementsCount: metrics.domElementsCount ?? 0,
      visualElementsCount: metrics.visualElementsCount ?? 0,
      redactedElementsCount: metrics.redactedElementsCount ?? 0,
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
        phaseObserveMs: 0,
        phaseSanitizeMs: 0,
        phaseReasonMs: 0,
        phaseValidateMs: 0,
        phaseExecuteMs: 0,
        phaseDetectMs: 0,
        iterationTotalMs: 0,
        endToEndMs: 0,
      };
    }

    const sum = this.measurements.latencies.reduce(
      (acc, m) => ({
        phaseObserveMs: acc.phaseObserveMs + m.phaseObserveMs,
        phaseSanitizeMs: acc.phaseSanitizeMs + m.phaseSanitizeMs,
        phaseReasonMs: acc.phaseReasonMs + m.phaseReasonMs,
        phaseValidateMs: acc.phaseValidateMs + m.phaseValidateMs,
        phaseExecuteMs: acc.phaseExecuteMs + m.phaseExecuteMs,
        phaseDetectMs: acc.phaseDetectMs + m.phaseDetectMs,
        iterationTotalMs: acc.iterationTotalMs + m.iterationTotalMs,
        endToEndMs: acc.endToEndMs + m.endToEndMs,
      }),
      {
        phaseObserveMs: 0,
        phaseSanitizeMs: 0,
        phaseReasonMs: 0,
        phaseValidateMs: 0,
        phaseExecuteMs: 0,
        phaseDetectMs: 0,
        iterationTotalMs: 0,
        endToEndMs: 0,
      }
    );

    const count = this.measurements.latencies.length;
    return {
      phaseObserveMs: sum.phaseObserveMs / count,
      phaseSanitizeMs: sum.phaseSanitizeMs / count,
      phaseReasonMs: sum.phaseReasonMs / count,
      phaseValidateMs: sum.phaseValidateMs / count,
      phaseExecuteMs: sum.phaseExecuteMs / count,
      phaseDetectMs: sum.phaseDetectMs / count,
      iterationTotalMs: sum.iterationTotalMs / count,
      endToEndMs: sum.endToEndMs / count,
    };
  }

  /**
   * Calculate average resource metrics
   */
  private getAverageResource(): ResourceMetrics {
    if (this.measurements.resources.length === 0) {
      return {
        memoryUsageMb: 0,
        cpuPercentage: 0,
        domElementsCount: 0,
        visualElementsCount: 0,
        redactedElementsCount: 0,
      };
    }

    const sum = this.measurements.resources.reduce(
      (acc, m) => ({
        memoryUsageMb: acc.memoryUsageMb + m.memoryUsageMb,
        cpuPercentage: acc.cpuPercentage + m.cpuPercentage,
        domElementsCount: acc.domElementsCount + m.domElementsCount,
        visualElementsCount: acc.visualElementsCount + m.visualElementsCount,
        redactedElementsCount: acc.redactedElementsCount + m.redactedElementsCount,
      }),
      {
        memoryUsageMb: 0,
        cpuPercentage: 0,
        domElementsCount: 0,
        visualElementsCount: 0,
        redactedElementsCount: 0,
      }
    );

    const count = this.measurements.resources.length;
    return {
      memoryUsageMb: sum.memoryUsageMb / count,
      cpuPercentage: sum.cpuPercentage / count,
      domElementsCount: sum.domElementsCount / count,
      visualElementsCount: sum.visualElementsCount / count,
      redactedElementsCount: sum.redactedElementsCount / count,
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
