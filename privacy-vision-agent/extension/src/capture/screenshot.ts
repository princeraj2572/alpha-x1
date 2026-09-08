import { ScreenshotResult } from '@/types/index';

/**
 * Captures a screenshot of the active tab
 * Uses Chrome extension API - screenshot stays local, never transmitted
 */
export async function captureActiveTabScreenshot(): Promise<ScreenshotResult | null> {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!tab || !tab.id) {
      console.error('No active tab found');
      return null;
    }

    // Use chrome.tabs.captureVisibleTab to get screenshot
    // This API only works in extension context and keeps data local
    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
      format: 'png',
    });

    if (!dataUrl) {
      console.error('Screenshot capture returned empty');
      return null;
    }

    // Parse image dimensions
    const img = new Image();
    return new Promise((resolve) => {
      img.onload = () => {
        resolve({
          dataUrl,
          width: img.width,
          height: img.height,
          timestamp: Date.now(),
        });
      };
      img.onerror = () => {
        console.error('Failed to load screenshot image');
        resolve(null);
      };
      img.src = dataUrl;
    });
  } catch (error) {
    console.error('Screenshot capture error:', error);
    return null;
  }
}

/**
 * Stores screenshot in memory (session storage within extension context)
 * IMPORTANT: Does not persist to any external storage
 */
let screenshotCache: ScreenshotResult | null = null;

export function cacheScreenshot(screenshot: ScreenshotResult): void {
  screenshotCache = screenshot;
}

export function getCachedScreenshot(): ScreenshotResult | null {
  return screenshotCache;
}

export function clearScreenshotCache(): void {
  screenshotCache = null;
}
