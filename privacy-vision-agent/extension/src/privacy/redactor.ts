/**
 * Redaction engine.
 *
 * Takes fused `PrivacyFinding`s and produces the sanitized representation:
 *   - text findings  -> semantic token replacement in strings
 *   - DOM field findings -> value masked / omitted (we never had the value)
 *   - visual findings -> blur / blackout rectangles applied to a screenshot
 *
 * Guiding principle (README §13): redact the sensitive value, keep everything
 * else. "Email: [EMAIL]" not "Email: [REDACTED PAGE]". The cloud agent must
 * still be able to tell what the page is and what controls it has.
 */

import {
  PrivacyFinding,
  PrivacyType,
  BoundingBox,
  RedactionStrategy,
  tokenFor,
} from './types';

export interface RedactedTextResult {
  text: string;
  appliedCount: number;
  tokens: string[];
}

/**
 * Structural stand-in for `ImageData` so the redactor works in a service
 * worker / test environment where the DOM `ImageData` constructor is absent.
 * A real `ImageData` satisfies this shape.
 */
export interface ImageLike {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

export interface VisualRedactionRegion {
  bbox: BoundingBox;
  strategy: RedactionStrategy;
  type: PrivacyType;
}

export class Redactor {
  /**
   * Replace every text-span finding in `text` with its semantic token.
   * Findings without a `textSpan` are ignored here (handled elsewhere).
   * Spans are applied right-to-left so earlier offsets stay valid.
   */
  redactText(text: string, findings: PrivacyFinding[]): RedactedTextResult {
    const spans = findings
      .filter((f) => f.textSpan && f.strategy !== 'blur' && f.strategy !== 'blackout')
      .slice()
      .sort((a, b) => b.textSpan![0] - a.textSpan![0]);

    let out = text;
    const tokens: string[] = [];
    for (const f of spans) {
      const [s, e] = f.textSpan!;
      if (s < 0 || e > out.length || s >= e) {
        continue;
      }
      const token = tokenFor(f);
      out = out.slice(0, s) + token + out.slice(e);
      tokens.push(token);
    }
    return { text: out, appliedCount: tokens.length, tokens: tokens.reverse() };
  }

  /**
   * Redact a plain object's string fields in place-safe fashion. Used to
   * sanitize element labels / text before they go into the context payload.
   * Only string values are scanned; the caller supplies a text scanner.
   */
  redactRecordStrings<T>(record: T, scanText: (s: string) => PrivacyFinding[]): T {
    const walk = (value: unknown): unknown => {
      if (typeof value === 'string') {
        const findings = scanText(value);
        return findings.length ? this.redactText(value, findings).text : value;
      }
      if (Array.isArray(value)) {
        return value.map(walk);
      }
      if (value && typeof value === 'object') {
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
          out[k] = walk(v);
        }
        return out;
      }
      return value;
    };
    return walk(record) as T;
  }

  /**
   * For a DOM field finding, return the metadata patch that removes any value
   * and annotates the sensitivity. The scanner merges this into its output.
   */
  maskFieldPatch(finding: PrivacyFinding): Record<string, unknown> {
    return {
      value: undefined,
      valueOmitted: true,
      sensitiveType: finding.type,
      redaction: 'mask',
    };
  }

  /**
   * Collect the visual regions that need pixel redaction on the screenshot.
   */
  visualRegions(findings: PrivacyFinding[]): VisualRedactionRegion[] {
    return findings
      .filter((f) => f.bbox && (f.strategy === 'blur' || f.strategy === 'blackout'))
      .map((f) => ({ bbox: f.bbox!, strategy: f.strategy as RedactionStrategy, type: f.type }));
  }

  /**
   * Apply blur / blackout rectangles to an ImageData-like screenshot.
   * Returns a NEW ImageData; the input is not mutated.
   *
   * Blur is a cheap box blur over the region only (not the whole frame) so
   * it stays fast even on large screenshots.
   */
  applyVisualRedaction(image: ImageLike, regions: VisualRedactionRegion[]): ImageLike {
    const out: ImageLike = {
      data: new Uint8ClampedArray(image.data),
      width: image.width,
      height: image.height,
    };
    for (const region of regions) {
      const box = clampBox(region.bbox, image.width, image.height);
      if (box.width <= 0 || box.height <= 0) {
        continue;
      }
      if (region.strategy === 'blackout') {
        fillRegion(out, box, [0, 0, 0, 255]);
      } else {
        boxBlurRegion(out, box, 8);
      }
    }
    return out;
  }

  /**
   * Build a human-readable redaction report for the privacy dashboard / logs.
   * Contains counts and types only — never raw values.
   */
  report(findings: PrivacyFinding[]): {
    total: number;
    byType: Record<string, number>;
    bySource: Record<string, number>;
    visualRegions: number;
    tokenReplacements: number;
  } {
    const byType: Record<string, number> = {};
    const bySource: Record<string, number> = {};
    let visualRegions = 0;
    let tokenReplacements = 0;
    for (const f of findings) {
      byType[f.type] = (byType[f.type] ?? 0) + 1;
      bySource[f.source] = (bySource[f.source] ?? 0) + 1;
      if (f.strategy === 'blur' || f.strategy === 'blackout') {
        visualRegions++;
      } else {
        tokenReplacements++;
      }
    }
    return { total: findings.length, byType, bySource, visualRegions, tokenReplacements };
  }
}

// --- pixel helpers -------------------------------------------------------

function clampBox(b: BoundingBox, w: number, h: number): BoundingBox {
  const x = Math.max(0, Math.min(Math.round(b.x), w));
  const y = Math.max(0, Math.min(Math.round(b.y), h));
  return {
    x,
    y,
    width: Math.max(0, Math.min(Math.round(b.width), w - x)),
    height: Math.max(0, Math.min(Math.round(b.height), h - y)),
  };
}

function fillRegion(image: ImageLike, box: BoundingBox, rgba: [number, number, number, number]): void {
  const { data, width } = image;
  for (let y = box.y; y < box.y + box.height; y++) {
    for (let x = box.x; x < box.x + box.width; x++) {
      const i = (y * width + x) * 4;
      data[i] = rgba[0];
      data[i + 1] = rgba[1];
      data[i + 2] = rgba[2];
      data[i + 3] = rgba[3];
    }
  }
}

function boxBlurRegion(image: ImageLike, box: BoundingBox, radius: number): void {
  const { data, width } = image;
  const src = new Uint8ClampedArray(data);
  for (let y = box.y; y < box.y + box.height; y++) {
    for (let x = box.x; x < box.x + box.width; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let count = 0;
      for (let dy = -radius; dy <= radius; dy += 2) {
        for (let dx = -radius; dx <= radius; dx += 2) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < box.x || nx >= box.x + box.width || ny < box.y || ny >= box.y + box.height) {
            continue;
          }
          const i = (ny * width + nx) * 4;
          r += src[i];
          g += src[i + 1];
          b += src[i + 2];
          count++;
        }
      }
      if (count === 0) {
        continue;
      }
      const i = (y * width + x) * 4;
      data[i] = r / count;
      data[i + 1] = g / count;
      data[i + 2] = b / count;
    }
  }
}

export const redactor = new Redactor();
