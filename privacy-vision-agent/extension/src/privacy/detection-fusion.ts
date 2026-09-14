/**
 * Detection fusion.
 *
 * Every detector emits `PrivacyFinding`s independently, so the same piece of
 * sensitive data often shows up two or three times (DOM says a field is an
 * email field, regex finds the address in the label text, OCR finds it again
 * inside a screenshot). This module merges those into one normalized list.
 *
 * Merge rules (see DECISION-016):
 *   - Two findings merge when they refer to the same thing: same `elementId`,
 *     OR overlapping text spans, OR overlapping bounding boxes (IoU > 0.5).
 *   - The merged finding keeps the higher-ranked source's `type`
 *     (DOM > REGEX > OCR/FACE > VISION), its `elementId`/`bbox`, and the
 *     MAX confidence of the group.
 *   - When merged findings disagree on `type`, the higher-ranked source wins
 *     and the disagreement is noted in `detail`.
 *
 * Fail-closed: `applyRiskPolicy` promotes low-confidence findings on
 * high-risk types to "redact anyway" rather than dropping them.
 */

import {
  PrivacyFinding,
  PrivacyType,
  DetectionSource,
  BoundingBox,
  SOURCE_RANK,
  REPLACEMENT_TOKENS,
  DEFAULT_STRATEGY,
} from './types';

/** Types where a missed redaction is costly — treat uncertainty as sensitive. */
export const HIGH_RISK_TYPES: ReadonlySet<PrivacyType> = new Set([
  PrivacyType.PASSWORD,
  PrivacyType.CREDIT_CARD,
  PrivacyType.CARD_CVV,
  PrivacyType.AADHAAR_LIKE_ID,
  PrivacyType.PAN_LIKE_ID,
  PrivacyType.ACCOUNT_NUMBER,
  PrivacyType.FACE,
]);

export interface FusionOptions {
  /** IoU above which two boxes are "the same region". Default 0.5. */
  iouThreshold?: number;
  /** Drop findings below this confidence unless high-risk. Default 0.4. */
  minConfidence?: number;
  /** Apply fail-closed promotion for high-risk types. Default true. */
  failClosed?: boolean;
}

export class DetectionFusionEngine {
  fuse(findings: PrivacyFinding[], options: FusionOptions = {}): PrivacyFinding[] {
    const iouThreshold = options.iouThreshold ?? 0.5;
    const minConfidence = options.minConfidence ?? 0.4;
    const failClosed = options.failClosed ?? true;

    // 1. Group findings that refer to the same underlying item.
    const groups: PrivacyFinding[][] = [];
    for (const finding of findings) {
      const group = groups.find((g) => g.some((existing) => this.sameItem(existing, finding, iouThreshold)));
      if (group) {
        group.push(finding);
      } else {
        groups.push([finding]);
      }
    }

    // 2. Collapse each group to a single normalized finding.
    let merged = groups.map((g) => this.mergeGroup(g));

    // 3. Confidence filter with fail-closed exception.
    merged = merged.filter((f) => {
      if (f.confidence >= minConfidence) {
        return true;
      }
      if (failClosed && HIGH_RISK_TYPES.has(f.type)) {
        f.detail = `${f.detail ?? ''} | kept: fail-closed (low confidence, high-risk)`.trim();
        return true;
      }
      return false;
    });

    // 4. Stable ordering: DOM/element findings first, then by position.
    return merged.sort((a, b) => {
      if (a.elementId && !b.elementId) {
        return -1;
      }
      if (!a.elementId && b.elementId) {
        return 1;
      }
      const ay = a.bbox?.y ?? a.textSpan?.[0] ?? 0;
      const by = b.bbox?.y ?? b.textSpan?.[0] ?? 0;
      return ay - by;
    });
  }

  /**
   * Fail-closed risk policy as a standalone step. Given the fused findings and
   * the set of regions the pipeline was *uncertain* about, ensure every
   * high-risk uncertain region still ends up redacted.
   */
  applyRiskPolicy(findings: PrivacyFinding[]): PrivacyFinding[] {
    return findings.map((f) => {
      if (HIGH_RISK_TYPES.has(f.type) && f.confidence < 0.6) {
        return {
          ...f,
          strategy: f.strategy ?? DEFAULT_STRATEGY[f.type],
          detail: `${f.detail ?? ''} | risk-policy: redact despite low confidence`.trim(),
        };
      }
      return f;
    });
  }

  private sameItem(a: PrivacyFinding, b: PrivacyFinding, iouThreshold: number): boolean {
    if (a.elementId && b.elementId) {
      // Same element. If both also carry spans, require the spans to overlap
      // (two different PII hits in one label are two findings, not one).
      if (a.textSpan && b.textSpan) {
        const [as, ae] = a.textSpan;
        const [bs, be] = b.textSpan;
        return as < be && bs < ae;
      }
      return a.elementId === b.elementId;
    }
    // Text-span overlap is only meaningful WITHIN the same source text. Without
    // a shared elementId we cannot assume two spans index the same string, so
    // we do not merge on spans alone (that caused cross-block false merges).
    // Fall through to bounding-box comparison.
    if (a.bbox && b.bbox && hasArea(a.bbox) && hasArea(b.bbox)) {
      // Same region by overlap, OR one box sits fully inside the other
      // (a regex/OCR hit landing inside a DOM field's box). Degenerate
      // zero-area boxes (common in headless DOM) are never "the same".
      return (
        iou(a.bbox, b.bbox) > iouThreshold ||
        contains(a.bbox, b.bbox) ||
        contains(b.bbox, a.bbox)
      );
    }
    return false;
  }

  private mergeGroup(group: PrivacyFinding[]): PrivacyFinding {
    if (group.length === 1) {
      return { ...group[0] };
    }
    // Winner = highest source rank, then highest confidence.
    const winner = [...group].sort((a, b) => {
      const rank = SOURCE_RANK[b.source] - SOURCE_RANK[a.source];
      return rank !== 0 ? rank : b.confidence - a.confidence;
    })[0];

    const maxConfidence = Math.max(...group.map((f) => f.confidence));
    const sources = [...new Set(group.map((f) => f.source))];
    const types = [...new Set(group.map((f) => f.type))];
    const disagreement = types.length > 1 ? ` | type-conflict resolved to ${winner.type} from [${types.join(', ')}]` : '';

    return {
      type: winner.type,
      source: sources.length > 1 ? DetectionSource.FUSED : winner.source,
      confidence: round2(maxConfidence),
      elementId: winner.elementId ?? group.find((f) => f.elementId)?.elementId,
      bbox: winner.bbox ?? group.find((f) => f.bbox)?.bbox,
      textSpan: winner.textSpan ?? group.find((f) => f.textSpan)?.textSpan,
      rawValue: winner.rawValue ?? group.find((f) => f.rawValue)?.rawValue,
      replacement: winner.replacement ?? REPLACEMENT_TOKENS[winner.type],
      strategy: winner.strategy ?? DEFAULT_STRATEGY[winner.type],
      detail: `merged from [${sources.join(', ')}]${disagreement}`,
    };
  }
}

function iou(a: BoundingBox, b: BoundingBox): number {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.width, b.x + b.width);
  const y2 = Math.min(a.y + a.height, b.y + b.height);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const union = a.width * a.height + b.width * b.height - inter;
  return union <= 0 ? 0 : inter / union;
}

function hasArea(b: BoundingBox): boolean {
  return b.width > 0 && b.height > 0;
}

function contains(outer: BoundingBox, inner: BoundingBox): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export const detectionFusionEngine = new DetectionFusionEngine();
