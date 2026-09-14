/**
 * Visual Privacy Layer
 * Detects and redacts sensitive visual regions:
 * - Faces (facial recognition privacy)
 * - Text (OCR for visual PII)
 * - Sensitive visual elements
 */

export interface DetectedFace {
  bbox: { x: number; y: number; width: number; height: number };
  confidence: number;
}

export interface TextRegion {
  text: string;
  bbox: { x: number; y: number; width: number; height: number };
  confidence: number;
  isSensitive: boolean;
}

export interface VisualRedaction {
  faces: DetectedFace[];
  textRegions: TextRegion[];
  redactionMask: ImageData | null;
  timestamp: number;
  processingTime: number;
}

export class VisualPrivacyEngine {
  private processingCount = 0;
  private totalProcessingTime = 0;

  /**
   * Detect faces in current viewport
   * Uses heuristic detection (ready for ML models)
   */
  async detectFaces(): Promise<DetectedFace[]> {
    const startTime = performance.now();

    // TODO: Integrate face-api.js or TensorFlow.js face detection
    // For now, use heuristic detection of avatar images
    const faces = this.detectFacesHeuristic();

    console.log(`[Visual Privacy] Detected ${faces.length} faces in ${(performance.now() - startTime).toFixed(2)}ms`);

    return faces;
  }

  /**
   * Extract text from page images and DOM
   * Combines OCR and DOM text extraction
   */
  async extractText(): Promise<TextRegion[]> {
    const startTime = performance.now();

    // TODO: Integrate Tesseract.js for OCR
    // For now, extract text from DOM and check for PII
    const textRegions = this.extractTextHeuristic();

    const processingTime = performance.now() - startTime;
    this.processingCount++;
    this.totalProcessingTime += processingTime;

    console.log(`[Visual Privacy] Extracted ${textRegions.length} text regions in ${processingTime.toFixed(2)}ms`);

    return textRegions;
  }

  /**
   * Create redaction mask for sensitive regions
   */
  async createRedactionMask(
    faces: DetectedFace[],
    textRegions: TextRegion[]
  ): Promise<ImageData | null> {
    const startTime = performance.now();

    // Get canvas for drawing
    const canvas = document.createElement('canvas');
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    const ctx = canvas.getContext('2d');

    if (!ctx) {
      return null;
    }

    // Create transparent mask
    const imageData = ctx.createImageData(canvas.width, canvas.height);
    const data = imageData.data;

    // Mark face regions (RGBA, 0 = transparent, 255 = opaque)
    faces.forEach((face) => {
      this.markRegion(data, face.bbox, canvas.width, canvas.height, 255); // Red channel for faces
    });

    // Mark text regions
    textRegions.filter((tr) => tr.isSensitive).forEach((textRegion) => {
      this.markRegion(data, textRegion.bbox, canvas.width, canvas.height, 0); // Green channel for text
    });

    const processingTime = performance.now() - startTime;
    console.log(`[Visual Privacy] Created redaction mask in ${processingTime.toFixed(2)}ms`);

    return imageData;
  }

  /**
   * Heuristic face detection
   * Detects images that might contain faces
   */
  private detectFacesHeuristic(): DetectedFace[] {
    const faces: DetectedFace[] = [];

    // Look for images with alt text suggesting faces
    document.querySelectorAll('img').forEach((img) => {
      const alt = img.alt?.toLowerCase() || '';
      const src = img.src?.toLowerCase() || '';

      if (
        alt.includes('avatar') ||
        alt.includes('profile') ||
        alt.includes('person') ||
        alt.includes('face') ||
        src.includes('avatar') ||
        src.includes('profile')
      ) {
        const rect = img.getBoundingClientRect();
        faces.push({
          bbox: {
            x: Math.round(rect.left),
            y: Math.round(rect.top),
            width: Math.round(rect.width),
            height: Math.round(rect.height),
          },
          confidence: 0.8,
        });
      }
    });

    return faces;
  }

  /**
   * Extract text from DOM
   * Check for sensitive content
   */
  private extractTextHeuristic(): TextRegion[] {
    const textRegions: TextRegion[] = [];
    const sensitiveKeywords = ['email', 'phone', 'ssn', 'password', 'credit', 'account', 'secret'];

    // Extract from images with text
    document.querySelectorAll('img').forEach((img) => {
      const alt = img.alt;
      if (alt && alt.length > 5) {
        const rect = img.getBoundingClientRect();
        const isSensitive = sensitiveKeywords.some((keyword) => alt.toLowerCase().includes(keyword));

        textRegions.push({
          text: alt,
          bbox: {
            x: Math.round(rect.left),
            y: Math.round(rect.top),
            width: Math.round(rect.width),
            height: Math.round(rect.height),
          },
          confidence: 0.7,
          isSensitive,
        });
      }
    });

    // Extract from visible text elements
    document.querySelectorAll('h1, h2, h3, h4, h5, h6, p, span').forEach((el) => {
      const text = el.textContent?.trim() || '';
      if (text.length > 10 && text.length < 200) {
        const isSensitive = sensitiveKeywords.some((keyword) => text.toLowerCase().includes(keyword));

        if (isSensitive) {
          const rect = el.getBoundingClientRect();
          textRegions.push({
            text,
            bbox: {
              x: Math.round(rect.left),
              y: Math.round(rect.top),
              width: Math.round(rect.width),
              height: Math.round(rect.height),
            },
            confidence: 0.85,
            isSensitive: true,
          });
        }
      }
    });

    return textRegions;
  }

  /**
   * Mark region in image data
   */
  private markRegion(
    data: Uint8ClampedArray,
    bbox: { x: number; y: number; width: number; height: number },
    canvasWidth: number,
    canvasHeight: number,
    color: number
  ): void {
    const x1 = Math.max(0, Math.floor(bbox.x));
    const y1 = Math.max(0, Math.floor(bbox.y));
    const x2 = Math.min(canvasWidth, Math.ceil(bbox.x + bbox.width));
    const y2 = Math.min(canvasHeight, Math.ceil(bbox.y + bbox.height));

    for (let y = y1; y < y2; y++) {
      for (let x = x1; x < x2; x++) {
        const idx = (y * canvasWidth + x) * 4;
        data[idx] = color; // R channel
        data[idx + 3] = 255; // Alpha
      }
    }
  }

  /**
   * Get statistics
   */
  getStats(): { processings: number; avgProcessingTime: number } {
    return {
      processings: this.processingCount,
      avgProcessingTime: this.processingCount > 0 ? this.totalProcessingTime / this.processingCount : 0,
    };
  }
}

export const visualPrivacyEngine = new VisualPrivacyEngine();
