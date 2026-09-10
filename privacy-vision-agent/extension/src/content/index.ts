/**
 * Content script that runs in the context of web pages
 * Receives messages from the popup/background to scan DOM and execute actions
 */

import { scanDOM } from '@/scanner/dom-scanner';
import { actionExecutor, ActionPayload } from '@/executor/action-executor';
import { visionEngine } from '@/vision/vision-engine';
import { privacyFusionEngine } from '@/vision/fusion';
import { visualPrivacyEngine } from '@/vision/privacy';

console.log('[Privacy Vision Agent] Content script loaded');

// Initialize vision engine on page load
visionEngine.initialize().catch((error) => {
  console.error('[Privacy Vision Agent] Failed to initialize vision engine:', error);
});

// Listen for messages from popup or background
chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  if (request.action === 'scanDOM') {
    try {
      const result = scanDOM();
      sendResponse({ success: true, data: result });
    } catch (error) {
      console.error('DOM scan error:', error);
      sendResponse({ success: false, error: String(error) });
    }
  } else if (request.action === 'scanWithVision') {
    handleScanWithVision(sendResponse);
    return true; // Keep channel open for async response
  } else if (request.action === 'detectVisualPrivacy') {
    handleDetectVisualPrivacy(sendResponse);
    return true; // Keep channel open for async response
  } else if (request.action === 'executeAction') {
    handleExecuteAction(request.payload, sendResponse);
    return true; // Keep channel open for async response
  }
});

async function handleScanWithVision(sendResponse: (response: unknown) => void): Promise<void> {
  try {
    console.log('[Privacy Vision Agent] Starting DOM + Vision scan');

    // Scan DOM
    const domResult = scanDOM();

    // Run visual perception
    const visualResult = await visionEngine.detectVisualElements();

    // Fuse DOM and visual data
    const fused = privacyFusionEngine.fuse(domResult.elements, visualResult.elements);

    const combinedResult = {
      ...domResult,
      elements: fused,
      visual: {
        elements: visualResult.elements,
        textRegions: visualResult.textRegions,
        inferenceTime: visualResult.inferenceTime,
      },
    };

    console.log('[Privacy Vision Agent] Scan complete: DOM + Vision fused');
    sendResponse({ success: true, data: combinedResult });
  } catch (error) {
    console.error('[Privacy Vision Agent] Scan with vision error:', error);
    sendResponse({ success: false, error: String(error) });
  }
}

async function handleDetectVisualPrivacy(sendResponse: (response: unknown) => void): Promise<void> {
  try {
    console.log('[Privacy Vision Agent] Starting visual privacy detection');

    // Detect faces
    const faces = await visualPrivacyEngine.detectFaces();

    // Extract text
    const textRegions = await visualPrivacyEngine.extractText();

    // Create redaction mask
    const redactionMask = await visualPrivacyEngine.createRedactionMask(faces, textRegions);

    const privacyResult = {
      faces,
      textRegions,
      redactionMask,
      timestamp: Date.now(),
      stats: {
        facesDetected: faces.length,
        textRegionsFound: textRegions.length,
        sensitiveTextRegions: textRegions.filter((tr) => tr.isSensitive).length,
      },
    };

    console.log(
      `[Privacy Vision Agent] Visual privacy detection complete: ${faces.length} faces, ${textRegions.length} text regions`
    );
    sendResponse({ success: true, data: privacyResult });
  } catch (error) {
    console.error('[Privacy Vision Agent] Visual privacy detection error:', error);
    sendResponse({ success: false, error: String(error) });
  }
}

async function handleExecuteAction(payload: ActionPayload, sendResponse: (response: unknown) => void): Promise<void> {
  try {
    console.log('[Privacy Vision Agent] Executing action:', payload.action);
    const result = await actionExecutor.execute(payload);
    sendResponse(result);
  } catch (error) {
    console.error('[Privacy Vision Agent] Action execution error:', error);
    sendResponse({
      action_id: payload.target_id || 'unknown',
      action_type: payload.action || 'unknown',
      success: false,
      error: error instanceof Error ? error.message : String(error),
      execution_time_ms: 0,
    });
  }
}

// Setup mutation observer to detect page changes
let mutationTimeout: NodeJS.Timeout | null = null;

const observer = new MutationObserver(() => {
  // Debounce page change notifications
  if (mutationTimeout) {
    clearTimeout(mutationTimeout);
  }

  mutationTimeout = setTimeout(() => {
    chrome.runtime.sendMessage({ action: 'pageChanged' }, () => {
      // Ignore errors if background isn't listening
    });
  }, 500);
});

// Observe DOM changes
observer.observe(document.documentElement, {
  childList: true,
  subtree: true,
  attributes: true,
  attributeFilter: ['disabled', 'aria-disabled', 'style', 'class'],
  characterData: false,
});

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
  observer.disconnect();
  if (mutationTimeout) {
    clearTimeout(mutationTimeout);
  }
});
