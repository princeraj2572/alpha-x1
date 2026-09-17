/**
 * Content script that runs in the context of web pages
 * Receives messages from the popup/background to scan DOM and execute actions
 */

import { scanDOM } from '@/scanner/dom-scanner';
import { actionExecutor, ActionPayload } from '@/executor/action-executor';
import { privacyPipeline, toWireFinding } from '@/privacy/pipeline';

console.log('[Privacy Vision Agent] Content script loaded');

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
  } else if (request.action === 'sanitizePage') {
    handleSanitizePage(sendResponse);
    return true; // Keep channel open for async response
  } else if (request.action === 'executeAction') {
    handleExecuteAction(request.payload, sendResponse);
    return true; // Keep channel open for async response
  }
});

/**
 * Run the local detection & sanitization pipeline over the current page and
 * return the sanitized context. This is the artifact that is safe to send to
 * the backend — findings are stripped of raw values via `toWireFinding`.
 */
async function handleSanitizePage(sendResponse: (response: unknown) => void): Promise<void> {
  try {
    const domResult = scanDOM();

    // Collect visible text blocks (labels, headings, short paragraphs) so the
    // regex layer can catch PII that lives in page copy rather than in fields.
    const texts: Array<{ text: string; elementId?: string }> = [];
    document.querySelectorAll('label, h1, h2, h3, h4, p, span, li, td, div').forEach((el, i) => {
      if (el.children.length > 0) {
        return;
      }
      const text = (el.textContent || '').trim();
      if (text.length >= 4 && text.length <= 400) {
        texts.push({ text, elementId: (el as HTMLElement).id || `text-${i}` });
      }
    });

    const result = await privacyPipeline.run(
      { document, texts },
      { enableFace: false, enableVision: false }
    );

    sendResponse({
      success: true,
      data: {
        page: domResult.page,
        elements: domResult.elements,
        sanitizedTexts: result.redactedTexts,
        findings: result.findings.map(toWireFinding),
        report: result.report,
        timing: result.timing,
        backends: result.backends,
        viewport: {
          width: window.innerWidth,
          height: window.innerHeight,
          dpr: window.devicePixelRatio || 1,
          scrollX: window.scrollX,
          scrollY: window.scrollY,
        },
      },
    });
  } catch (error) {
    console.error('[Privacy Vision Agent] sanitizePage error:', error);
    sendResponse({ success: false, error: error instanceof Error ? error.message : String(error) });
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

