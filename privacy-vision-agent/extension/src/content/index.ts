/**
 * Content script that runs in the context of web pages
 * Receives messages from the popup/background to scan DOM
 */

import { scanDOM } from '@/scanner/dom-scanner';

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
  }
});

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
