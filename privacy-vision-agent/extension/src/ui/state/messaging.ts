/**
 * Typed messaging between the side panel, the content script, and the
 * background service worker.
 *
 * The panel cannot touch the web page DOM, so DOM/regex/OCR detection runs in
 * the content script (`sanitizePage`) and the result comes back here. The
 * panel does screenshot capture + visual detection + redaction locally, then
 * hands ONLY a `SanitizedContext` to the background for transmission.
 */

import { SanitizedContext } from './outbound';

/** True inside a real extension page; false in tests / plain browser. */
export function hasChrome(): boolean {
  return typeof chrome !== 'undefined' && !!chrome.runtime?.id;
}

export interface SanitizePageResult {
  page: { title: string; url: string; favicon?: string };
  elements: Array<{
    id: string;
    type: string;
    text?: string;
    visible: boolean;
    enabled: boolean;
    bbox: [number, number, number, number];
    ariaLabel?: string;
    metadata?: Record<string, unknown>;
    sensitivity?: string;
  }>;
  sanitizedTexts: Array<{ elementId?: string; text: string }>;
  findings: Array<{
    type: string;
    source: string;
    confidence: number;
    bbox?: { x: number; y: number; width: number; height: number };
    elementId?: string;
    detail?: string;
    strategy?: string;
  }>;
  report: {
    total: number;
    byType: Record<string, number>;
    bySource: Record<string, number>;
    visualRegions: number;
    tokenReplacements: number;
  };
  timing: Record<string, number>;
  backends: { face: string; vision: string; ocr: string };
  viewport: { width: number; height: number; dpr: number; scrollX: number; scrollY: number };
}

/** URL schemes Chrome never injects content scripts into. */
const RESTRICTED_URL_PREFIXES = [
  'chrome://',
  'chrome-extension://',
  'edge://',
  'about:',
  'devtools://',
  'https://chrome.google.com/webstore',
  'https://chromewebstore.google.com',
];

export function isRestrictedUrl(url: string | undefined): boolean {
  if (!url) {
    return true; // e.g. a still-loading tab with no URL yet
  }
  return RESTRICTED_URL_PREFIXES.some((p) => url.startsWith(p));
}

async function activeTab(): Promise<chrome.tabs.Tab> {
  if (!hasChrome() || !chrome.tabs) {
    throw new Error('extension APIs unavailable (open this from the extension Side Panel)');
  }
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    throw new Error('No active tab found. Click on a normal web page tab and try again.');
  }
  if (isRestrictedUrl(tab.url)) {
    throw new Error(
      'This page does not support the agent (browser-internal pages, the Web Store, and blank new-tab pages cannot run content scripts). ' +
        'Switch to a normal http(s) page and try again.'
    );
  }
  return tab;
}

async function activeTabId(): Promise<number> {
  const tab = await activeTab();
  return tab.id!;
}

export async function requestSanitizePage(): Promise<SanitizePageResult> {
  const tabId = await activeTabId();
  let res: { success?: boolean; error?: string; data?: unknown } | undefined;
  try {
    res = await chrome.tabs.sendMessage(tabId, { action: 'sanitizePage' });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('Could not establish connection') || message.includes('Receiving end does not exist')) {
      throw new Error(
        'No content script is running on this tab. This usually means the page was already open before the ' +
          'extension was loaded/reloaded — reload the page (F5) and try again.'
      );
    }
    throw err;
  }
  if (!res?.success) {
    throw new Error(res?.error ?? 'sanitizePage failed');
  }
  return res.data as SanitizePageResult;
}

export interface BackendStatus {
  connected: boolean;
  sessionId?: string | null;
  provider?: string;
  model?: string;
}

export async function getBackendStatus(): Promise<BackendStatus> {
  if (!hasChrome()) {
    return { connected: false };
  }
  const res = await chrome.runtime.sendMessage({ action: 'getBackendStatus' });
  return res ?? { connected: false };
}

/**
 * Hand the sanitized context to the background for transmission. The background
 * re-validates and refuses anything that fails `validateSanitizedContext`.
 * There is deliberately NO parameter for a raw screenshot.
 */
export async function sendSanitizedContext(
  ctx: SanitizedContext,
  previewSha256: string | null,
  task?: string
): Promise<{ ok: boolean; error?: string; messageId?: string }> {
  if (!hasChrome()) {
    return { ok: false, error: 'extension APIs unavailable' };
  }
  const res = await chrome.runtime.sendMessage({
    action: 'sendSanitizedContext',
    context: ctx,
    previewSha256,
    task,
  });
  return res ?? { ok: false, error: 'no response from background' };
}

export async function stopAgent(): Promise<void> {
  if (hasChrome()) {
    await chrome.runtime.sendMessage({ action: 'stopAgent' });
  }
}

export async function resumeAgent(): Promise<void> {
  if (hasChrome()) {
    await chrome.runtime.sendMessage({ action: 'resumeAgent' });
  }
}

/* ---- events pushed from the background to the panel ---- */

export interface AgentEvent {
  type: 'agentEvent';
  kind: 'cloudAction' | 'actionValidation' | 'execution' | 'backendStatus' | 'stopped' | 'backendError';
  payload: Record<string, unknown>;
  at: number;
}

export function onAgentEvent(handler: (e: AgentEvent) => void): () => void {
  if (!hasChrome() || !chrome.runtime?.onMessage) {
    return () => {};
  }
  const listener = (msg: unknown) => {
    if (msg && typeof msg === 'object' && (msg as AgentEvent).type === 'agentEvent') {
      handler(msg as AgentEvent);
    }
  };
  chrome.runtime.onMessage.addListener(listener);
  return () => chrome.runtime.onMessage.removeListener(listener);
}
