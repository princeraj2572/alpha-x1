/**
 * Privacy Fusion Engine
 * Combines DOM data with visual perception
 * Applies privacy rules at the fusion layer
 */

import { ExtractedElement } from '@/types/index';
import { VisualElement } from './vision-engine';
import { PrivacyDetector, SensitivityLevel } from '@/privacy/detector';

export interface FusedElement extends ExtractedElement {
  visualConfidence?: number;
  visualType?: VisualElement['type'];
  fusionScore?: number;
}

export class PrivacyFusionEngine {
  /**
   * Fuse DOM elements with visual detection results
   * Apply privacy rules to combined data
   */
  fuse(
    domElements: ExtractedElement[],
    visualElements: VisualElement[]
  ): FusedElement[] {
    const fused: FusedElement[] = [];

    // Create visual element map for quick lookup
    const visualMap = new Map<string, VisualElement>();
    visualElements.forEach((ve) => {
      const key = this.getBboxKey(ve.bbox);
      visualMap.set(key, ve);
    });

    // Fuse each DOM element with visual data
    domElements.forEach((domEl) => {
      const visualEl = this.findMatchingVisualElement(domEl, visualElements, visualMap);

      const fused: FusedElement = {
        ...domEl,
        visualConfidence: visualEl?.confidence,
        visualType: visualEl?.type,
        fusionScore: visualEl ? this.calculateFusionScore(domEl, visualEl) : undefined,
      };

      // Apply privacy rules to fused element
      this.applyPrivacyRules(fused);

      fused.push(fused);
    });

    return fused;
  }

  /**
   * Apply privacy rules to fused element
   */
  private applyPrivacyRules(element: FusedElement): void {
    // Don't expose values for sensitive fields
    if (element.type === 'input') {
      const sensitivity = PrivacyDetector.checkFieldSensitivity(
        element.id,
        (element.metadata as any)?.inputType,
        element.ariaLabel
      );

      if (sensitivity === SensitivityLevel.CONFIDENTIAL) {
        delete element.value;
        (element as any).sensitivity = 'confidential';
      }
    }

    // Redact PII in text content
    if (element.text) {
      const piiResult = PrivacyDetector.detectPii(element.text);
      if (piiResult.isSensitive) {
        element.text = piiResult.redactedValue;
      }
    }
  }

  /**
   * Find matching visual element for DOM element
   */
  private findMatchingVisualElement(
    domEl: ExtractedElement,
    visualElements: VisualElement[],
    visualMap: Map<string, VisualElement>
  ): VisualElement | undefined {
    if (!domEl.bbox) {
      return undefined;
    }

    const key = this.getBboxKey(domEl.bbox);
    const exactMatch = visualMap.get(key);
    if (exactMatch) {
      return exactMatch;
    }

    // Find closest visual element by IoU (Intersection over Union)
    let bestMatch: VisualElement | undefined;
    let bestIoU = 0;

    visualElements.forEach((ve) => {
      const iou = this.calculateIoU(domEl.bbox!, ve.bbox);
      if (iou > bestIoU && iou > 0.3) {
        bestIoU = iou;
        bestMatch = ve;
      }
    });

    return bestMatch;
  }

  /**
   * Calculate fusion score between DOM and visual element
   */
  private calculateFusionScore(domEl: ExtractedElement, visualEl: VisualElement): number {
    let score = 0;

    // Type match
    if (domEl.type === visualEl.type) {
      score += 0.4;
    }

    // Confidence in visual detection
    score += visualEl.confidence * 0.3;

    // Text match
    if (domEl.text && visualEl.text && domEl.text.includes(visualEl.text)) {
      score += 0.3;
    }

    return Math.min(score, 1.0);
  }

  /**
   * Calculate IoU (Intersection over Union) between bboxes
   */
  private calculateIoU(
    bbox1: { x: number; y: number; width: number; height: number },
    bbox2: { x: number; y: number; width: number; height: number }
  ): number {
    const x1 = Math.max(bbox1.x, bbox2.x);
    const y1 = Math.max(bbox1.y, bbox2.y);
    const x2 = Math.min(bbox1.x + bbox1.width, bbox2.x + bbox2.width);
    const y2 = Math.min(bbox1.y + bbox1.height, bbox2.y + bbox2.height);

    const intersection = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
    const union = bbox1.width * bbox1.height + bbox2.width * bbox2.height - intersection;

    return intersection / (union || 1);
  }

  /**
   * Get bounding box key for quick lookup
   */
  private getBboxKey(bbox: { x: number; y: number; width: number; height: number }): string {
    return `${bbox.x},${bbox.y},${bbox.width},${bbox.height}`;
  }
}

export const privacyFusionEngine = new PrivacyFusionEngine();
