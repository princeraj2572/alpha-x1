/**
 * Background Service Worker
 * Manages extension state and coordinates between content scripts and popup
 */

import { AgentStatus } from '@/types/index';
import { wsClient, Message } from '@/communication/websocket-client';
import { killSwitch } from '@/security/kill-switch';
import { ActionPolicyValidator } from '@/security/action-policy';
import { validateSanitizedContext } from '@/ui/state/outbound';

console.log('[Privacy Vision Agent] Background service worker loaded');

// Extension state
const extensionState: AgentStatus = {
  ready: true,
};

// Backend state
let isConnectedToBackend = false;
let backendProvider: string | undefined;
let backendModel: string | undefined;

// Enable opening the inspection Side Panel from the toolbar icon.
try {
  chrome.sidePanel?.setPanelBehavior?.({ openPanelOnActionClick: false }).catch(() => {});
} catch {
  /* older Chrome without sidePanel */
}

/** Broadcast an event to any open Side Panel. */
function emitAgentEvent(kind: string, payload: Record<string, unknown>): void {
  chrome.runtime
    .sendMessage({ type: 'agentEvent', kind, payload, at: Date.now() })
    .catch(() => {
      /* no panel open */
    });
}

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

wsClient.onMessage('heartbeat', (msg) => {
  const p = msg.payload as Record<string, unknown>;
  if (typeof p.provider === 'string') {
    backendProvider = p.provider;
  }
  if (typeof p.model === 'string') {
    backendModel = p.model;
  }
});

wsClient.onMessage('action', (msg: Message) => {
  handleBackendAction(msg).catch(console.error);
});

// Backend errors (reasoning failures, DECISION-014's repeated-action-failure
// warning, ...) arrived over the socket but had no handler at all before
// this — silently dropped, invisible to the user. Surface them the same way
// every other backend signal reaches the panel.
wsClient.onMessage('error', (msg: Message) => {
  const p = msg.payload as Record<string, unknown>;
  console.error('[Privacy Vision Agent] Backend reported an error:', p);
  emitAgentEvent('backendError', {
    errorCode: p.error_code ?? null,
    message: p.message ?? 'Unknown backend error',
  });
});

/**
 * Handle action from backend
 */
async function handleBackendAction(msg: Message): Promise<void> {
  try {
    console.log('[Privacy Vision Agent] Action received from backend:', msg.payload.action);

    const p = msg.payload as Record<string, unknown>;
    const actionType = String(p.action_type ?? p.action ?? 'unknown');
    emitAgentEvent('cloudAction', {
      actionType,
      targetLabel: p.target_id ?? p.target ?? null,
      confidence: p.confidence ?? null,
      reason: p.reason ?? null,
    });

    // Kill switch: never execute cloud actions for a stopped session.
    if (killSwitch.isActive()) {
      killSwitch.recordIterationStopped();
      emitAgentEvent('actionValidation', { status: 'blocked', reason: 'agent stopped by user', actionSummary: actionType });
      await wsClient.send('action_result', { message_id: msg.message_id, success: false, error: 'agent stopped by user' }).catch(() => {});
      return;
    }

    // Surface the existing policy validator's verdict to the panel.
    const policy = ActionPolicyValidator.validate({
      action: actionType as never,
      target_id: (p.target_id as string) ?? undefined,
      value: p.value as string | number | undefined,
      url: p.url as string | undefined,
    });
    emitAgentEvent('actionValidation', {
      status: policy.valid ? 'approved' : 'blocked',
      riskLevel: policy.riskLevel,
      requiresConfirmation: policy.requiresConfirmation,
      reason: policy.reason ?? null,
      actionSummary: `${actionType} → ${p.target_id ?? ''}`,
      schemaValid: true,
    });
    if (!policy.valid) {
      await wsClient.send('action_result', { message_id: msg.message_id, success: false, error: policy.reason }).catch(() => {});
      return;
    }

    const tab = await getActiveTab();
    if (!tab || !tab.id) {
      console.error('[Privacy Vision Agent] No active tab found');
      return;
    }

    emitAgentEvent('execution', { status: 'executing', actionType });

    // Send action to content script for execution
    let result;
    try {
      result = await chrome.tabs.sendMessage(tab.id, {
        action: 'executeAction',
        payload: msg.payload,
      });
      console.log('[Privacy Vision Agent] Action executed, result:', result);
    } catch (tabError) {
      console.error('[Privacy Vision Agent] Failed to send message to tab:', tabError);
      throw new Error(`Failed to execute action on tab: ${tabError}`);
    }

    emitAgentEvent('execution', {
      status: result?.success ? 'done' : 'failed',
      success: result?.success ?? false,
      error: result?.error,
      executionTimeMs: result?.execution_time_ms ?? 0,
    });

    // Send result back to backend
    console.log('[Privacy Vision Agent] Sending action_result to backend');
    await wsClient.send('action_result', {
      message_id: msg.message_id,
      success: result?.success ?? true,
      execution_time_ms: result?.execution_time_ms ?? 0,
      error: result?.error,
      details: result?.details,
    });
    console.log('[Privacy Vision Agent] action_result sent');
  } catch (error) {
    console.error('[Privacy Vision Agent] Action handling failed:', error);
    const errorMsg = error instanceof Error ? error.message : String(error);
    await wsClient.send('action_result', {
      success: false,
      error: errorMsg,
    }).catch((err) => {
      console.error('[Privacy Vision Agent] Failed to send error result:', err);
    });
  }
}

/**
 * Send DOM context to backend for cloud reasoning
 */
async function sendContextForReasoning(task?: string): Promise<void> {
  try {
    if (killSwitch.isActive()) {
      console.warn('[Privacy Vision Agent] Kill switch active — not sending context');
      return;
    }
    if (!isConnectedToBackend) {
      console.log('[Privacy Vision Agent] Backend not connected, skipping reasoning');
      return;
    }

    const tab = await getActiveTab();
    if (!tab || !tab.id) {
      console.error('[Privacy Vision Agent] No active tab found');
      return;
    }

    // Scan current DOM
    const scanResult = await chrome.tabs.sendMessage(tab.id, { action: 'scanDOM' });

    if (!scanResult?.success) {
      console.error('[Privacy Vision Agent] DOM scan failed');
      return;
    }

    console.log('[Privacy Vision Agent] Sending DOM context to backend for reasoning');

    // Send context to backend
    await wsClient.send('context', {
      context: {
        url: tab.url || '',
        title: tab.title || '',
        elements: scanResult.data?.elements || [],
        page: scanResult.data?.page || {},
      },
      task: task,
    });

    console.log('[Privacy Vision Agent] Context sent to backend');
  } catch (error) {
    console.error('[Privacy Vision Agent] Failed to send context:', error);
  }
}

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
      provider: backendProvider,
      model: backendModel,
    });
  } else if (request.action === 'sendContextForReasoning') {
    sendContextForReasoning(request.task).then(() => {
      sendResponse({ success: true });
    }).catch((error) => {
      sendResponse({ success: false, error: String(error) });
    });
    return true; // Keep channel open for async response
  } else if (request.action === 'sendSanitizedContext') {
    handleSendSanitizedContext(request).then(sendResponse);
    return true; // Keep channel open for async response
  } else if (request.action === 'stopAgent') {
    if (!killSwitch.isActive()) {
      killSwitch.activate('user stop from side panel');
    }
    emitAgentEvent('stopped', { reason: 'user stop' });
    sendResponse({ ok: true });
  } else if (request.action === 'resumeAgent') {
    if (killSwitch.isActive()) {
      killSwitch.deactivate();
    }
    sendResponse({ ok: true });
  }
});

/**
 * The ONLY path from the side panel to the cloud. Re-validates the sanitized
 * context at the trust boundary and refuses anything unsafe. There is no
 * parameter here for a raw screenshot — it cannot be sent.
 */
async function handleSendSanitizedContext(request: {
  context: unknown;
  previewSha256?: string | null;
  task?: string;
}): Promise<{ ok: boolean; error?: string; messageId?: string }> {
  if (killSwitch.isActive()) {
    return { ok: false, error: 'agent stopped by user' };
  }
  if (!isConnectedToBackend) {
    return { ok: false, error: 'backend not connected' };
  }

  const check = validateSanitizedContext(request.context, { previewSha256: request.previewSha256 ?? null });
  if (!check.ok) {
    console.warn('[Privacy Vision Agent] REFUSED outbound context:', check.errors);
    return { ok: false, error: `blocked by privacy gate: ${check.errors[0]}` };
  }

  const ctx = request.context as {
    page: { title: string; url?: string };
    elements: unknown[];
    sanitizedTexts: unknown[];
    findings: unknown[];
    privacyReport: unknown;
    sanitizedScreenshot: { dataUrl: string; sha256: string } | null;
  };

  try {
    const messageId = await wsClient.send('context', {
      context: {
        title: ctx.page.title,
        url: ctx.page.url ?? '',
        elements: ctx.elements,
        sanitizedTexts: ctx.sanitizedTexts,
        findings: ctx.findings,
        privacyReport: ctx.privacyReport,
        sanitizedScreenshot: ctx.sanitizedScreenshot?.dataUrl ?? null,
      },
      task: request.task,
    });
    return { ok: true, messageId };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

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
