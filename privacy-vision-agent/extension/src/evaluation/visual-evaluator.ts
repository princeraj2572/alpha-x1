/**
 * Visual Accuracy Evaluator
 * Measures visual perception accuracy against ground truth
 */

import { visionEngine, VisualElement } from '@/vision/vision-engine';

export interface VisualDetectionTarget {
  type: 'button' | 'input' | 'text' | 'image' | 'link';
  approximateSelector: string;
  minExpected: number;
}

export interface VisualAccuracyResult {
  totalTargets: number;
  detectedTargets: number;
  missedTargets: number;
  falsePositives: number;
  detectionRate: number;
  precisionRate: number;
  f1Score: number;
  detailsByType: Record<string, { expected: number; detected: number; accuracy: number }>;
}

export class VisualEvaluator {
  /**
   * Ground truth for common page elements
   */
  private static readonly EXPECTED_ELEMENTS: VisualDetectionTarget[] = [
    { type: 'button', approximateSelector: 'button, [role="button"]', minExpected: 1 },
    { type: 'input', approximateSelector: 'input, textarea, [role="textbox"]', minExpected: 1 },
    { type: 'link', approximateSelector: 'a, [role="link"]', minExpected: 1 },
    { type: 'image', approximateSelector: 'img, [role="img"]', minExpected: 1 },
  ];

  /**
   * Evaluate visual detection accuracy
   */
  static async evaluateDetection(): Promise<VisualAccuracyResult> {
    const detections = await visionEngine.detectVisualElements();

    let detectedTargets = 0;
    let totalTargets = 0;
    const detailsByType: Record<string, { expected: number; detected: number; accuracy: number }> = {};

    // Count expected elements by type
    for (const target of this.EXPECTED_ELEMENTS) {
      const elements = document.querySelectorAll(target.approximateSelector);
      const expectedCount = Math.max(elements.length, target.minExpected);
      const detected = detections.elements.filter((el) => el.type === target.type).length;

      totalTargets += expectedCount;
      detectedTargets += Math.min(detected, expectedCount);

      const accuracy = expectedCount > 0 ? detected / expectedCount : 0;
      detailsByType[target.type] = {
        expected: expectedCount,
        detected,
        accuracy: Math.min(accuracy, 1.0),
      };
    }

    const falsePositives = Math.max(
      0,
      detections.elements.length - totalTargets
    );

    const detectionRate = totalTargets > 0 ? detectedTargets / totalTargets : 0;
    const precisionRate = detections.elements.length > 0 ? detectedTargets / detections.elements.length : 0;
    const f1Score = (2 * detectionRate * precisionRate) / (detectionRate + precisionRate) || 0;

    return {
      totalTargets,
      detectedTargets,
      missedTargets: totalTargets - detectedTargets,
      falsePositives,
      detectionRate,
      precisionRate,
      f1Score,
      detailsByType,
    };
  }

  /**
   * Evaluate text region detection
   */
  static async evaluateTextDetection(): Promise<{
    textRegionsFound: number;
    headingsDetected: number;
    paragraphsDetected: number;
    qualityScore: number;
  }> {
    const detections = await visionEngine.detectVisualElements();

    const expectedHeadings = document.querySelectorAll('h1, h2, h3, h4, h5, h6').length;
    const expectedParagraphs = document.querySelectorAll('p').length;

    const textRegions = detections.textRegions.length;
    const headingsSeen = Math.min(textRegions, expectedHeadings);
    const paragraphsSeen = Math.min(textRegions - headingsSeen, expectedParagraphs);

    const qualityScore = textRegions > 0 ? (headingsSeen + paragraphsSeen) / textRegions : 0;

    return {
      textRegionsFound: textRegions,
      headingsDetected: headingsSeen,
      paragraphsDetected: paragraphsSeen,
      qualityScore,
    };
  }

  /**
   * Evaluate inference performance
   */
  static getInferenceMetrics() {
    const stats = visionEngine.getStats();

    return {
      totalInferences: stats.inferences,
      averageInferenceTimeMs: stats.avgInferenceTime,
      inferenceLatencyCategory: this.categorizeLatency(stats.avgInferenceTime),
    };
  }

  /**
   * Categorize latency
   */
  private static categorizeLatency(ms: number): string {
    if (ms < 50) return 'excellent';
    if (ms < 100) return 'good';
    if (ms < 200) return 'acceptable';
    if (ms < 500) return 'slow';
    return 'very_slow';
  }

  /**
   * Generate visual accuracy report
   */
  static async evaluateSummary() {
    const detection = await this.evaluateDetection();
    const textDetection = await this.evaluateTextDetection();
    const inference = this.getInferenceMetrics();

    return {
      title: 'Visual Accuracy Evaluation Summary',
      timestamp: new Date().toISOString(),
      elementDetection: {
        passed: detection.detectionRate >= 0.7,
        detectionRate: (detection.detectionRate * 100).toFixed(1) + '%',
        precisionRate: (detection.precisionRate * 100).toFixed(1) + '%',
        f1Score: (detection.f1Score * 100).toFixed(1) + '%',
        totalTargets: detection.totalTargets,
        detectedTargets: detection.detectedTargets,
        missedTargets: detection.missedTargets,
        detailsByType: Object.entries(detection.detailsByType).reduce(
          (acc, [type, metrics]) => ({
            ...acc,
            [type]: {
              expected: metrics.expected,
              detected: metrics.detected,
              accuracy: (metrics.accuracy * 100).toFixed(1) + '%',
            },
          }),
          {} as Record<string, any>
        ),
      },
      textDetection: {
        passed: textDetection.qualityScore >= 0.6,
        textRegionsFound: textDetection.textRegionsFound,
        headingsDetected: textDetection.headingsDetected,
        paragraphsDetected: textDetection.paragraphsDetected,
        qualityScore: (textDetection.qualityScore * 100).toFixed(1) + '%',
      },
      inference: {
        totalInferences: inference.totalInferences,
        averageLatencyMs: inference.averageInferenceTimeMs.toFixed(2),
        latencyCategory: inference.inferenceLatencyCategory,
        performanceScore: this.getPerformanceScore(inference.averageInferenceTimeMs),
      },
      overall: {
        allTestsPassed:
          detection.detectionRate >= 0.7 &&
          textDetection.qualityScore >= 0.6 &&
          inference.averageInferenceTimeMs < 500,
      },
    };
  }

  /**
   * Get performance score
   */
  private static getPerformanceScore(latencyMs: number): string {
    if (latencyMs < 100) return '⭐⭐⭐⭐⭐';
    if (latencyMs < 200) return '⭐⭐⭐⭐';
    if (latencyMs < 300) return '⭐⭐⭐';
    if (latencyMs < 500) return '⭐⭐';
    return '⭐';
  }
}

export const visualEvaluator = new VisualEvaluator();
