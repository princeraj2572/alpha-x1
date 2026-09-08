/**
 * Popup UI script
 * Handles user interactions and displays extension status
 */

import { DOMScanResult } from '@/types/index';
import { captureActiveTabScreenshot, cacheScreenshot, getCachedScreenshot } from '@/capture/screenshot';

// DOM elements
const pageTitle = document.getElementById('pageTitle')!;
const pageUrl = document.getElementById('pageUrl')!;
const buttonCount = document.getElementById('buttonCount')!;
const inputCount = document.getElementById('inputCount')!;
const linkCount = document.getElementById('linkCount')!;
const otherCount = document.getElementById('otherCount')!;
const lastScan = document.getElementById('lastScan')!;
const screenshotStatus = document.getElementById('screenshotStatus')!;
const scanBtn = document.getElementById('scanBtn')! as HTMLButtonElement;
const screenshotBtn = document.getElementById('screenshotBtn')! as HTMLButtonElement;
const resetBtn = document.getElementById('resetBtn')! as HTMLButtonElement;
const errorEl = document.getElementById('error')!;
const successEl = document.getElementById('success')!;
const backendStatus = document.getElementById('backendStatus')!;
const sessionId = document.getElementById('sessionId')!;

let currentScan: DOMScanResult | null = null;

function showError(message: string): void {
  errorEl.textContent = message;
  errorEl.classList.add('show');
  setTimeout(() => {
    errorEl.classList.remove('show');
  }, 3000);
}

function showSuccess(message: string): void {
  successEl.textContent = message;
  successEl.classList.add('show');
  setTimeout(() => {
    successEl.classList.remove('show');
  }, 3000);
}

function updatePageInfo(): void {
  if (currentScan) {
    pageTitle.textContent = currentScan.page.title;
    pageUrl.textContent = currentScan.page.url;
  }
}

function updateElementCounts(): void {
  if (!currentScan) {
    return;
  }

  const elements = currentScan.elements;
  let buttons = 0;
  let inputs = 0;
  let links = 0;
  let others = 0;

  elements.forEach((el) => {
    switch (el.type) {
      case 'button':
        buttons++;
        break;
      case 'input':
      case 'textarea':
        inputs++;
        break;
      case 'link':
        links++;
        break;
      default:
        others++;
    }
  });

  buttonCount.textContent = String(buttons);
  inputCount.textContent = String(inputs);
  linkCount.textContent = String(links);
  otherCount.textContent = String(others);

  lastScan.textContent = new Date(currentScan.timestamp).toLocaleTimeString();
}

function logScanResult(): void {
  if (currentScan) {
    const logData = {
      pageTitle: currentScan.page.title,
      pageUrl: currentScan.page.url,
      elementCount: currentScan.elements.length,
      elements: currentScan.elements.map((el) => ({
        id: el.id,
        type: el.type,
        visible: el.visible,
        enabled: el.enabled,
        text: el.text?.substring(0, 50) || '(no text)',
        bbox: el.bbox,
      })),
    };

    console.log('[Privacy Vision Agent] DOM Scan Result:', logData);

    // Also log to page for visibility
    console.log('✓ Scan complete - see details above');
    console.log(`Found: ${currentScan.elements.length} elements`);
    console.log('No sensitive data exposed - only metadata collected');
  }
}

async function handleScan(): Promise<void> {
  scanBtn.disabled = true;
  scanBtn.textContent = 'Scanning...';

  try {
    const response = await chrome.runtime.sendMessage({ action: 'scanCurrentTab' });

    if (response?.success && response.data) {
      currentScan = response.data;
      updatePageInfo();
      updateElementCounts();
      logScanResult();
      showSuccess(`DOM scanned: ${response.data.elements.length} elements found`);
    } else {
      showError('Failed to scan DOM');
    }
  } catch (error) {
    console.error('Scan error:', error);
    showError('Error scanning DOM');
  } finally {
    scanBtn.disabled = false;
    scanBtn.textContent = 'Scan DOM';
  }
}

async function handleScreenshot(): Promise<void> {
  screenshotBtn.disabled = true;
  screenshotBtn.textContent = 'Capturing...';

  try {
    const screenshot = await captureActiveTabScreenshot();

    if (screenshot) {
      cacheScreenshot(screenshot);
      screenshotStatus.textContent = `Captured (${screenshot.width}x${screenshot.height})`;
      showSuccess('Screenshot captured locally');

      console.log('[Privacy Vision Agent] Screenshot captured:', {
        width: screenshot.width,
        height: screenshot.height,
        timestamp: screenshot.timestamp,
        note: 'Screenshot stored in memory only, never transmitted',
      });
    } else {
      showError('Failed to capture screenshot');
    }
  } catch (error) {
    console.error('Screenshot error:', error);
    showError('Error capturing screenshot');
  } finally {
    screenshotBtn.disabled = false;
    screenshotBtn.textContent = 'Capture Screenshot';
  }
}

function handleReset(): void {
  currentScan = null;
  pageTitle.textContent = '—';
  pageUrl.textContent = '';
  buttonCount.textContent = '—';
  inputCount.textContent = '—';
  linkCount.textContent = '—';
  otherCount.textContent = '—';
  lastScan.textContent = 'Never';
  screenshotStatus.textContent = 'Not captured';
  showSuccess('Reset complete');
}

// Event listeners
scanBtn.addEventListener('click', handleScan);
screenshotBtn.addEventListener('click', handleScreenshot);
resetBtn.addEventListener('click', handleReset);

// Update backend status
function updateBackendStatus(): void {
  // Send message to background to get backend status
  chrome.runtime.sendMessage(
    { action: 'getBackendStatus' },
    (response) => {
      if (response?.connected) {
        backendStatus.textContent = '✓ Connected';
        backendStatus.style.color = '#c8e6c9';
        sessionId.textContent = response.sessionId?.substring(0, 8) || '—';
      } else {
        backendStatus.textContent = '✗ Disconnected';
        backendStatus.style.color = '#ffcdd2';
        sessionId.textContent = '—';
      }
    }
  );
}

// Initialize on popup open
async function initialize(): Promise<void> {
  try {
    const response = await chrome.runtime.sendMessage({ action: 'getStatus' });
    if (response?.activeTab) {
      pageTitle.textContent = response.activeTab.title || '—';
      pageUrl.textContent = response.activeTab.url || '—';
    }

    // Check if there's a cached screenshot
    const cached = getCachedScreenshot();
    if (cached) {
      screenshotStatus.textContent = `Captured (${cached.width}x${cached.height})`;
    }

    // Update backend status
    updateBackendStatus();

    // Refresh backend status every 2 seconds
    setInterval(updateBackendStatus, 2000);
  } catch (error) {
    console.error('Initialization error:', error);
  }
}

initialize();
