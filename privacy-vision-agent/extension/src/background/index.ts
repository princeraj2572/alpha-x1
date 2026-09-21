/**
 * Background Service Worker
 * Manages extension state and coordinates between content scripts and popup
 */

import { AgentStatus } from '@/types/index';
import { wsClient, Message } from '@/communication/websocket-client';
import { killSwitch } from '@/security/kill-switch';
import { createSessionManager, SessionManager } from '@/security/session-manager';
import { ActionPolicyValidator } from '@/security/action-policy';
import { validateSanitizedContext } from '@/ui/state/outbound';
import { ConfirmationGate } from './confirmation-gate';

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
 * Dangerous cloud actions (navigate/finish — see ActionPolicyValidator) wait
 * here for the user's explicit approve/reject from the side panel before
 * `handleBackendAction` proceeds to execute them (DECISION-029). Before this,
 * `requiresConfirmation` was computed and displayed but never actually
 * gated anything — execution went ahead regardless.
 */
const confirmationGate = new ConfirmationGate(undefined, (id, details) => {
  emitAgentEvent('pendingConfirmation', { id, ...details });
});

/**
 * Idle-session enforcement: SessionManager was fully built (heartbeat,
 * exponential-backoff-aware reconnect bookkeeping, kill-switch-on-timeout)
 * but never instantiated anywhere — nothing enforced session inactivity
 * timeout at all before this. Created lazily on the first real activity
 * once a session ID exists (`wsClient` only learns it from the backend's
 * first message — see `processMessage`), not at module load.
 */
const EXPLICIT_STOP_REASON = 'user stop from side panel';
let sessionManager: SessionManager | null = null;

function ensureSessionManager(): SessionManager | null {
  const id = wsClient.getSessionId();
  if (!id) {
    return null;
  }
  if (!sessionManager) {
    sessionManager = createSessionManager({ sessionId: id });
    sessionManager.subscribe((state) => {
      // Only react to the session dying on its own (idle timeout / reconnect
      // exhaustion) — an explicit stop already runs these same two steps
      // itself, right where it calls killSwitch.activate() below.
      if (!state.isActive && state.reason !== EXPLICIT_STOP_REASON) {
        confirmationGate.rejectAll();
        emitAgentEvent('stopped', { reason: state.reason ?? 'session terminated' });
      }
    });
  }
  return sessionManager;
}

wsClient.onConnect(() => {
  sessionManager?.markConnected();
});

wsClient.onDisconnect(() => {
  sessionManager?.markDisconnected();
});

// Every backend message counts as session activity, whatever its type.
wsClient.onMessage(() => {
  ensureSessionManager()?.recordActivity();
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
    const actionSummary = `${actionType} → ${p.target_id ?? ''}`;
    emitAgentEvent('actionValidation', {
      status: !policy.valid ? 'blocked' : policy.requiresConfirmation ? 'checking' : 'approved',
      riskLevel: policy.riskLevel,
      requiresConfirmation: policy.requiresConfirmation,
      reason: policy.reason ?? null,
      actionSummary,
      schemaValid: true,
    });
    if (!policy.valid) {
      await wsClient.send('action_result', { message_id: msg.message_id, success: false, error: policy.reason }).catch(() => {});
      return;
    }

    // Dangerous actions (navigate/finish) wait for explicit user approval
    // before proceeding — see confirmationGate above.
    if (policy.requiresConfirmation) {
      const approved = await confirmationGate.request(msg.message_id, {
        actionType,
        targetLabel: p.target_id ?? p.target ?? null,
        reason: p.reason ?? null,
        riskLevel: policy.riskLevel,
      });
      if (!approved) {
        emitAgentEvent('actionValidation', {
          status: 'blocked',
          reason: 'rejected by user (confirmation required)',
          actionSummary,
        });
        await wsClient
          .send('action_result', {
            message_id: msg.message_id,
            success: false,
            error: 'rejected by user (confirmation required)',
          })
          .catch(() => {});
        return;
      }
      emitAgentEvent('actionValidation', { status: 'approved', actionSummary, reason: 'confirmed by user' });
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
  sessionManager?.recordActivity();

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
  } else if (request.action === 'sendSanitizedContext') {
    handleSendSanitizedContext(request).then(sendResponse);
    return true; // Keep channel open for async response
  } else if (request.action === 'stopAgent') {
    if (!killSwitch.isActive()) {
      killSwitch.activate(EXPLICIT_STOP_REASON);
    }
    confirmationGate.rejectAll();
    emitAgentEvent('stopped', { reason: 'user stop' });
    // Tear down the idle-timeout tracker so it doesn't keep ticking toward a
    // pointless timeout in the background — a fresh one is created lazily
    // from the next real activity (see ensureSessionManager).
    sessionManager?.terminate(EXPLICIT_STOP_REASON);
    sessionManager = null;
    sendResponse({ ok: true });
  } else if (request.action === 'resumeAgent') {
    if (killSwitch.isActive()) {
      killSwitch.deactivate();
    }
    sendResponse({ ok: true });
  } else if (request.action === 'confirmCloudAction') {
    confirmationGate.resolve(String(request.id), Boolean(request.approved));
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
