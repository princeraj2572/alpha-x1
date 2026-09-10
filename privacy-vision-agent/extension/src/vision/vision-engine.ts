/**
 * Local visual perception engine
 * Runs lightweight vision models in-browser using ONNX
 * Detects UI elements, text regions, and visual features
 */

export interface VisualElement {
  type: 'button' | 'input' | 'text' | 'image' | 'link' | 'unknown';
  bbox: { x: number; y: number; width: number; height: number };
  confidence: number;
  text?: string;
  label?: string;
}

export interface VisualScanResult {
  elements: VisualElement[];
  textRegions: Array<{ text: string; bbox: { x: number; y: number; width: number; height: number } }>;
  timestamp: number;
  inferenceTime: number;
}

export class VisionEngine {
  private modelLoaded = false;
  private inferenceCount = 0;
  private totalInferenceTime = 0;

  /**
   * Initialize vision engine
   * In production, loads ONNX model
   * For now, uses heuristic-based detection
   */
  async initialize(): Promise<void> {
    console.log('[Vision Engine] Initializing...');

    // TODO: Load ONNX model
    // const session = await ort.InferenceSession.create('model.onnx');

    this.modelLoaded = true;
    console.log('[Vision Engine] Ready');
  }

  /**
   * Run visual perception on current viewport
   */
  async detectVisualElements(): Promise<VisualScanResult> {
    if (!this.modelLoaded) {
      throw new Error('Vision engine not initialized');
    }

    const startTime = performance.now();
    this.inferenceCount++;

    // Use heuristic-based detection for now
    const elements = this.detectElementsHeuristic();
    const textRegions = this.detectTextRegions();

    const inferenceTime = performance.now() - startTime;
    this.totalInferenceTime += inferenceTime;

    console.log(`[Vision Engine] Detected ${elements.length} elements in ${inferenceTime.toFixed(2)}ms`);

    return {
      elements,
      textRegions,
      timestamp: Date.now(),
      inferenceTime,
    };
  }

  /**
   * Heuristic-based element detection
   * Detects buttons, inputs, links, images based on DOM
   */
  private detectElementsHeuristic(): VisualElement[] {
    const elements: VisualElement[] = [];

    // Detect buttons
    document.querySelectorAll('button, [role="button"]').forEach((el) => {
      if (this.isVisible(el)) {
        elements.push({
          type: 'button',
          bbox: this.getBoundingBox(el),
          confidence: 0.95,
          text: el.textContent?.trim() || undefined,
          label: el.getAttribute('aria-label') || undefined,
        });
      }
    });

    // Detect inputs
    document.querySelectorAll('input, textarea, [role="textbox"]').forEach((el) => {
      if (this.isVisible(el)) {
        elements.push({
          type: 'input',
          bbox: this.getBoundingBox(el),
          confidence: 0.95,
          label: (el as HTMLInputElement).placeholder || el.getAttribute('aria-label') || undefined,
        });
      }
    });

    // Detect links
    document.querySelectorAll('a, [role="link"]').forEach((el) => {
      if (this.isVisible(el)) {
        elements.push({
          type: 'link',
          bbox: this.getBoundingBox(el),
          confidence: 0.9,
          text: el.textContent?.trim() || undefined,
        });
      }
    });

    // Detect images
    document.querySelectorAll('img, [role="img"]').forEach((el) => {
      if (this.isVisible(el)) {
        elements.push({
          type: 'image',
          bbox: this.getBoundingBox(el),
          confidence: 0.85,
          label: el.getAttribute('alt') || el.getAttribute('aria-label') || undefined,
        });
      }
    });

    return elements;
  }

  /**
   * Detect text regions in viewport
   */
  private detectTextRegions(): Array<{ text: string; bbox: { x: number; y: number; width: number; height: number } }> {
    const textRegions: Array<{ text: string; bbox: { x: number; y: number; width: number; height: number } }> = [];

    // Detect headings
    document.querySelectorAll('h1, h2, h3, h4, h5, h6').forEach((el) => {
      if (this.isVisible(el)) {
        const text = el.textContent?.trim();
        if (text) {
          textRegions.push({
            text,
            bbox: this.getBoundingBox(el),
          });
        }
      }
    });

    // Detect paragraphs with text
    document.querySelectorAll('p, span, div').forEach((el) => {
      if (this.isVisible(el) && el.children.length === 0) {
        const text = el.textContent?.trim();
        if (text && text.length > 10 && text.length < 500) {
          textRegions.push({
            text,
            bbox: this.getBoundingBox(el),
          });
        }
      }
    });

    return textRegions;
  }

  /**
   * Check if element is visible
   */
  private isVisible(element: Element): boolean {
    if (!(element instanceof HTMLElement)) {
      return false;
    }

    const style = window.getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
      return false;
    }

    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && rect.top < window.innerHeight && rect.bottom > 0;
  }

  /**
   * Get bounding box for element
   */
  private getBoundingBox(element: Element): { x: number; y: number; width: number; height: number } {
    const rect = element.getBoundingClientRect();
    return {
      x: Math.round(rect.left),
      y: Math.round(rect.top),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    };
  }

  /**
   * Get performance statistics
   */
  getStats(): { inferences: number; avgInferenceTime: number } {
    return {
      inferences: this.inferenceCount,
      avgInferenceTime: this.inferenceCount > 0 ? this.totalInferenceTime / this.inferenceCount : 0,
    };
  }
}

export const visionEngine = new VisionEngine();
