/**
 * Benchmark Runner
 * Orchestrates evaluation of all SIH metrics
 */

import { privacyEvaluator } from './privacy-evaluator';
import { visualEvaluator } from './visual-evaluator';
import { MetricsCollector } from './metrics-collector';

export interface BenchmarkReport {
  timestamp: string;
  sessionId: string;
  sihMetrics: {
    visualContextAccuracy: any;
    piiDetectionAccuracy: any;
    redactionPrecision: any;
    clientResourceUsage: any;
    endToEndLatency: any;
  };
  summary: {
    totalTestsPassed: number;
    totalTestsRun: number;
    successRate: number;
    overallStatus: 'PASS' | 'PARTIAL' | 'FAIL';
  };
}

export class BenchmarkRunner {
  /**
   * Run full evaluation suite
   */
  static async runFullEvaluation(metricsCollector: MetricsCollector, iterationCount: number): Promise<BenchmarkReport> {
    console.log('[Benchmark] Starting full evaluation suite');

    // Evaluate each SIH metric
    const [privacyResults, visualResults] = await Promise.all([
      this.evaluatePrivacy(),
      this.evaluateVisual(),
    ]);

    const metricsReport = metricsCollector.generateReport(iterationCount);
    const resourceMetrics = this.evaluateResources(metricsReport);
    const latencyMetrics = this.evaluateLatency(metricsReport);

    // Aggregate results
    const testsPassed = this.countPassedTests([privacyResults, visualResults, resourceMetrics, latencyMetrics]);
    const totalTests = 4; // One for each SIH category

    const report: BenchmarkReport = {
      timestamp: new Date().toISOString(),
      sessionId: metricsCollector.getMeasurements().latencies.length > 0 ? 'benchmark-session' : 'empty',
      sihMetrics: {
        visualContextAccuracy: visualResults,
        piiDetectionAccuracy: privacyResults.piiDetection,
        redactionPrecision: privacyResults.redaction,
        clientResourceUsage: resourceMetrics,
        endToEndLatency: latencyMetrics,
      },
      summary: {
        totalTestsPassed: testsPassed,
        totalTestsRun: totalTests,
        successRate: testsPassed / totalTests,
        overallStatus: this.getOverallStatus(testsPassed, totalTests),
      },
    };

    console.log('[Benchmark] Evaluation complete');
    return report;
  }

  /**
   * Evaluate privacy metrics
   */
  private static async evaluatePrivacy() {
    console.log('[Benchmark] Evaluating privacy metrics...');
    return privacyEvaluator.evaluateSummary();
  }

  /**
   * Evaluate visual metrics
   */
  private static async evaluateVisual() {
    console.log('[Benchmark] Evaluating visual accuracy...');
    return visualEvaluator.evaluateSummary();
  }

  /**
   * Evaluate resource usage
   */
  private static evaluateResources(metricsReport: any) {
    console.log('[Benchmark] Evaluating resource usage...');

    const avgMemory = metricsReport.resource?.memoryUsageMb ?? 0;
    const avgCpu = metricsReport.resource?.cpuPercentage ?? 0;

    return {
      title: 'Client Resource Usage',
      timestamp: new Date().toISOString(),
      memory: {
        passed: avgMemory < 100,
        averageMemoryMb: avgMemory.toFixed(2),
        category: avgMemory < 50 ? 'excellent' : avgMemory < 100 ? 'good' : 'high',
      },
      cpu: {
        passed: avgCpu < 30,
        averageCpuPercentage: avgCpu.toFixed(1),
        category: avgCpu < 10 ? 'excellent' : avgCpu < 30 ? 'good' : 'high',
      },
      overall: {
        allTestsPassed: avgMemory < 100 && avgCpu < 30,
      },
    };
  }

  /**
   * Evaluate latency metrics
   */
  private static evaluateLatency(metricsReport: any) {
    console.log('[Benchmark] Evaluating latency...');

    const avgIterationTime = metricsReport.latency?.iterationTotalMs ?? 0;
    const avgEndToEnd = metricsReport.latency?.endToEndMs ?? 0;

    return {
      title: 'End-to-End Latency',
      timestamp: new Date().toISOString(),
      perIteration: {
        averageTimeMs: avgIterationTime.toFixed(2),
        category: this.categorizeLatency(avgIterationTime),
        breakdown: {
          observeMs: (metricsReport.latency?.phaseObserveMs ?? 0).toFixed(2),
          sanitizeMs: (metricsReport.latency?.phaseSanitizeMs ?? 0).toFixed(2),
          reasonMs: (metricsReport.latency?.phaseReasonMs ?? 0).toFixed(2),
          validateMs: (metricsReport.latency?.phaseValidateMs ?? 0).toFixed(2),
          executeMs: (metricsReport.latency?.phaseExecuteMs ?? 0).toFixed(2),
          detectMs: (metricsReport.latency?.phaseDetectMs ?? 0).toFixed(2),
        },
      },
      endToEnd: {
        averageTimeMs: avgEndToEnd.toFixed(2),
        category: this.categorizeLatency(avgEndToEnd),
      },
      overall: {
        allTestsPassed: avgIterationTime < 5000 && avgEndToEnd < 30000,
      },
    };
  }

  /**
   * Categorize latency
   */
  private static categorizeLatency(ms: number): string {
    if (ms < 500) return 'excellent';
    if (ms < 1000) return 'good';
    if (ms < 3000) return 'acceptable';
    if (ms < 10000) return 'slow';
    return 'very_slow';
  }

  /**
   * Count passed tests
   */
  private static countPassedTests(results: any[]): number {
    let passed = 0;

    for (const result of results) {
      if (result?.overall?.allTestsPassed) {
        passed++;
      }
    }

    return passed;
  }

  /**
   * Determine overall status
   */
  private static getOverallStatus(passed: number, total: number): 'PASS' | 'PARTIAL' | 'FAIL' {
    if (passed === total) return 'PASS';
    if (passed > 0) return 'PARTIAL';
    return 'FAIL';
  }

  /**
   * Format report as readable text
   */
  static formatReport(report: BenchmarkReport): string {
    const lines: string[] = [];

    lines.push(`\n${'='.repeat(60)}`);
    lines.push('PRIVACY VISION AGENT - EVALUATION REPORT');
    lines.push(`${'='.repeat(60)}`);
    lines.push(`Timestamp: ${report.timestamp}`);
    lines.push(`\nOVERALL RESULT: ${report.summary.overallStatus}`);
    lines.push(`Tests Passed: ${report.summary.totalTestsPassed}/${report.summary.totalTestsRun}`);
    lines.push(`Success Rate: ${(report.summary.successRate * 100).toFixed(1)}%`);

    lines.push(`\n${'-'.repeat(60)}`);
    lines.push('SIH METRIC 1: Visual Context Accuracy');
    lines.push(`${'-'.repeat(60)}`);
    lines.push(`Status: ${report.sihMetrics.visualContextAccuracy.overall?.allTestsPassed ? 'PASS' : 'FAIL'}`);
    lines.push(
      `Detection Rate: ${report.sihMetrics.visualContextAccuracy.elementDetection?.detectionRate || 'N/A'}`
    );
    lines.push(
      `Precision: ${report.sihMetrics.visualContextAccuracy.elementDetection?.precisionRate || 'N/A'}`
    );

    lines.push(`\n${'-'.repeat(60)}`);
    lines.push('SIH METRIC 2 & 3: PII Detection & Redaction');
    lines.push(`${'-'.repeat(60)}`);
    lines.push(`Detection Status: ${report.sihMetrics.piiDetectionAccuracy?.passed ? 'PASS' : 'FAIL'}`);
    lines.push(`Precision: ${report.sihMetrics.piiDetectionAccuracy?.precision || 'N/A'}`);
    lines.push(`Recall: ${report.sihMetrics.piiDetectionAccuracy?.recall || 'N/A'}`);
    lines.push(`Redaction Status: ${report.sihMetrics.redactionPrecision?.passed ? 'PASS' : 'FAIL'}`);

    lines.push(`\n${'-'.repeat(60)}`);
    lines.push('SIH METRIC 4: Client Resource Usage');
    lines.push(`${'-'.repeat(60)}`);
    lines.push(`Memory: ${report.sihMetrics.clientResourceUsage?.memory?.averageMemoryMb} MB`);
    lines.push(`CPU: ${report.sihMetrics.clientResourceUsage?.cpu?.averageCpuPercentage}%`);
    lines.push(
      `Status: ${report.sihMetrics.clientResourceUsage?.overall?.allTestsPassed ? 'PASS' : 'FAIL'}`
    );

    lines.push(`\n${'-'.repeat(60)}`);
    lines.push('SIH METRIC 5: End-to-End Latency');
    lines.push(`${'-'.repeat(60)}`);
    lines.push(
      `Per-Iteration: ${report.sihMetrics.endToEndLatency?.perIteration?.averageTimeMs} ms (${report.sihMetrics.endToEndLatency?.perIteration?.category})`
    );
    lines.push(`End-to-End: ${report.sihMetrics.endToEndLatency?.endToEnd?.averageTimeMs} ms`);
    lines.push(
      `Status: ${report.sihMetrics.endToEndLatency?.overall?.allTestsPassed ? 'PASS' : 'FAIL'}`
    );

    lines.push(`\n${'='.repeat(60)}\n`);

    return lines.join('\n');
  }

  /**
   * Export report as JSON
   */
  static exportReportJson(report: BenchmarkReport): string {
    return JSON.stringify(report, null, 2);
  }
}

export const benchmarkRunner = new BenchmarkRunner();
