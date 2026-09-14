/**
 * Screenshot helpers for the side panel.
 *
 * Capture happens here (extension context has `chrome.tabs.captureVisibleTab`).
 * The raw bytes are turned into an `ImageData` for the local visual pipeline
 * and never written to storage, logs, or the network.
 */

import { ImageLike } from '@/privacy/redactor';
import { makeRawCapture, RawCapture, SanitizedScreenshot } from './outbound';

/** Capture the visible area of the active tab as a PNG data URL. */
export async function captureActiveTab(): Promise<RawCapture> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || tab.windowId === undefined) {
    throw new Error('No active tab to capture');
  }
  const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
  if (!dataUrl) {
    throw new Error('captureVisibleTab returned empty');
  }
  const { width, height } = await imageSize(dataUrl);
  const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
  return makeRawCapture(dataUrl, width, height, dpr);
}

export function imageSize(dataUrl: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => reject(new Error('failed to load screenshot image'));
    img.src = dataUrl;
  });
}

/** Decode a data URL into an ImageData via an offscreen canvas. */
export async function dataUrlToImageData(dataUrl: string): Promise<ImageData> {
  const img = await loadImage(dataUrl);
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('2d context unavailable');
  }
  ctx.drawImage(img, 0, 0);
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

/** Put an ImageData onto a fresh canvas (for CanvasImageSource consumers). */
export function imageDataToCanvas(image: ImageData): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('2d context unavailable');
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}

/** Encode an ImageData-like buffer back to a PNG data URL. */
export function imageDataToDataUrl(image: ImageLike): string {
  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('2d context unavailable');
  }
  const id = ctx.createImageData(image.width, image.height);
  id.data.set(image.data);
  ctx.putImageData(id, 0, 0);
  return canvas.toDataURL('image/png');
}

export async function toSanitizedScreenshot(image: ImageLike): Promise<SanitizedScreenshot> {
  const dataUrl = imageDataToDataUrl(image);
  return {
    dataUrl,
    width: image.width,
    height: image.height,
    sha256: await sha256Hex(dataUrl),
  };
}

export async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image load failed'));
    img.src = src;
  });
}

/**
 * Mask a raw string for diagnostic display. Never returns the full secret.
 * "prince@gmail.com" -> "p***@gmail.com"; "4111111111111111" -> "•••• •••• •••• 1111"
 */
export function maskForDisplay(value: string, type?: string): string {
  const v = value.trim();
  if (!v) {
    return '';
  }
  if (type === 'EMAIL' || v.includes('@')) {
    const [user, domain] = v.split('@');
    const head = user.slice(0, 1);
    return `${head}${'*'.repeat(Math.max(2, user.length - 1))}@${domain ?? '...'}`;
  }
  const digits = v.replace(/\D/g, '');
  if ((type === 'CREDIT_CARD' || digits.length >= 12) && digits.length >= 4) {
    return `•••• •••• •••• ${digits.slice(-4)}`;
  }
  if (type === 'PASSWORD') {
    return '•'.repeat(Math.min(12, Math.max(8, v.length)));
  }
  if (v.length <= 3) {
    return `${v[0]}${'*'.repeat(v.length - 1)}`;
  }
  return `${v.slice(0, 1)}${'*'.repeat(Math.max(3, v.length - 2))}${v.slice(-1)}`;
}
