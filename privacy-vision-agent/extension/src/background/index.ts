/**
 * Background Service Worker
 * Manages extension state and coordinates between content scripts and popup
 */

import { AgentStatus } from '@/types/index';
import { wsClient } from '@/communication/websocket-client';

console.log('[Privacy Vision Agent] Background service worker loaded');

// Extension state
const extensionState: AgentStatus = {
  ready: true,
};

// Backend state
let isConnectedToBackend = false;

// Initialize backend connection
async function initializeBackend(): Promise<void> {
  try {
    console.log('[Privacy Vision Agent] Initializing backend connection...');
    await wsClient.connect();
    isConnectedToBackend = true;
    console.log('[Privacy Vision Agent] Backend connection established');
  } catch (error) {
    console.error('[Privacy Vision Agent] Failed to connect to backend:', error);
    isConnectedToBackend = false;
  }
}

// Handle backend connection
wsClient.onConnect(() => {
  console.log('[Privacy Vision Agent] Connected to backend');
  isConnectedToBackend = true;
});

wsClient.onDisconnect(() => {
  console.log('[Privacy Vision Agent] Disconnected from backend');
  isConnectedToBackend = false;
});

wsClient.onError((error) => {
  console.error('[Privacy Vision Agent] Backend error:', error);
});

// Handle backend messages
wsClient.onMessage('heartbeat', (msg) => {
  console.log('[Privacy Vision Agent] Heartbeat received');
  // Auto-ack heartbeats
  const sequence = (msg.payload as Record<string, unknown>).sequence as number || 0;
  wsClient.sendHeartbeatAck(sequence).catch(console.error);
});

// Initialize on background load
initializeBackend();

/**
 * Gets current active tab
 */
async function getActiveTab(): Promise<chrome.tabs.Tab | null> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab || null;
}

/**
 * Updates active tab information
 */
chrome.tabs.onActivated.addListener(async () => {
  const tab = await getActiveTab();
  if (tab) {
    extensionState.activeTab = tab;
  }
});

/**
 * Handles tab updates (URL change, title change, etc.)
 */
chrome.tabs.onUpdated.addListener((_tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete') {
    extensionState.activeTab = tab;
  }
});

/**
 * Handles messages from content scripts
 */
chrome.runtime.onMessage.addListener((request, _sender, _sendResponse) => {
  if (request.action === 'pageChanged') {
    console.log('[Privacy Vision Agent] Page changed detected');
    // Notify popup if it's open
    chrome.runtime.sendMessage(
      { action: 'notifyPageChanged' },
      () => {
        // Ignore if popup isn't listening
      }
    );
  }
});

/**
 * Handles messages from popup
 */
chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  if (request.action === 'getStatus') {
    sendResponse(extensionState);
  } else if (request.action === 'scanCurrentTab') {
    scanCurrentTab().then((result) => {
      sendResponse({ success: true, data: result });
    });
    return true; // Keep channel open for async response
  } else if (request.action === 'getBackendStatus') {
    sendResponse({
      connected: isConnectedToBackend,
      sessionId: wsClient.getSessionId(),
    });
  }
});

/**
 * Scans the DOM of the current active tab
 */
async function scanCurrentTab() {
  try {
    const tab = await getActiveTab();
    if (!tab || !tab.id) {
      return null;
    }

    const response = await chrome.tabs.sendMessage(tab.id, { action: 'scanDOM' });
    if (response?.success) {
      extensionState.lastScanTime = Date.now();
      extensionState.elementCount = response.data?.elements?.length || 0;
      return response.data;
    }
    return null;
  } catch (error) {
    console.error('Tab scan error:', error);
    return null;
  }
}

// Initialize
getActiveTab().then((tab) => {
  if (tab) {
    extensionState.activeTab = tab;
  }
});
