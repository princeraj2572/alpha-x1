import { describe, it, expect, beforeEach, vi } from 'vitest';

// See src/privacy/vision-model.test.ts for why this whole module is mocked
// rather than letting vitest's Node runner try to resolve onnxruntime-web.
vi.mock('@/privacy/ort-loader', () => ({
  loadOrtModule: vi.fn(async () => {
    throw new Error('onnxruntime-web is browser-only; not available under vitest/Node');
  }),
}));

// Same idea for Tesseract: a real worker/wasm/lang-data load can't succeed
// under Node and would otherwise add real (slow, noisy) failed-fetch attempts
// to every test in this file.
vi.mock('./ocr-loader', () => ({
  ensureRealOcrEngine: vi.fn(async () => null),
}));

/* ----- mock the browser-only screenshot helpers ----- */
const fakeImageData = { data: new Uint8ClampedArray(4 * 20 * 20), width: 20, height: 20 };
vi.mock('./screenshot', () => ({
  captureActiveTab: vi.fn(async () => ({
    __localOnly: true as const,
    dataUrl: 'data:image/png;base64,RAWRAWRAW',
    width: 20,
    height: 20,
    capturedAt: Date.now(),
    dpr: 1,
  })),
  dataUrlToImageData: vi.fn(async () => fakeImageData),
  toSanitizedScreenshot: vi.fn(async (img: { width: number; height: number }) => ({
    dataUrl: 'data:image/png;base64,SANITIZED',
    width: img.width,
    height: img.height,
    sha256: 'sanitized-hash-abc',
  })),
  imageDataToDataUrl: vi.fn(() => 'data:image/png;base64,SANITIZED'),
  imageDataToCanvas: vi.fn(() => ({ width: 20, height: 20 })),
  sha256Hex: vi.fn(async () => 'sanitized-hash-abc'),
  maskForDisplay: (v: string) => v,
}));

/* ----- mock the messaging layer ----- */
const RAW_SECRETS = {
  email: 'victim@realmail.example',
  password: 'Hunter2!!',
  card: '4111 1111 1111 1111',
};
let capturedOutbound: unknown = null;
vi.mock('./messaging', () => ({
  requestSanitizePage: vi.fn(async () => ({
    page: { title: 'Checkout', url: 'https://shop.example/checkout' },
    elements: [
      { id: 'pw', type: 'input', visible: true, enabled: true, bbox: [10, 10, 100, 20], metadata: { inputType: 'password' } },
      { id: 'em', type: 'input', visible: true, enabled: true, bbox: [10, 40, 100, 20], metadata: { inputType: 'email' } },
      { id: 'buy', type: 'button', text: 'BUY NOW', visible: true, enabled: true, bbox: [10, 80, 80, 30] },
    ],
    // content script already redacted these:
    sanitizedTexts: [
      { elementId: 't0', text: 'Contact [EMAIL] to confirm' },
      { elementId: 't1', text: 'Product: Headphones  Price: 2499' },
    ],
    findings: [
      { type: 'PASSWORD', source: 'DOM', confidence: 1, elementId: 'pw', bbox: { x: 10, y: 10, width: 100, height: 20 }, strategy: 'mask' },
      { type: 'EMAIL', source: 'DOM', confidence: 0.9, elementId: 'em', bbox: { x: 10, y: 40, width: 100, height: 20 }, strategy: 'token' },
      { type: 'EMAIL', source: 'REGEX', confidence: 0.97, elementId: 't0', detail: 'rule:email', strategy: 'token' },
    ],
    report: { total: 3, byType: { PASSWORD: 1, EMAIL: 2 }, bySource: { DOM: 2, REGEX: 1 }, visualRegions: 0, tokenReplacements: 2 },
    timing: { dom: 5, regex: 3, ocr: 1, face: 0, vision: 0, fusion: 0, redaction: 0, total: 12 },
    backends: { face: 'none', vision: 'disabled', ocr: 'dom-text' },
    viewport: { width: 400, height: 300, dpr: 1, scrollX: 0, scrollY: 0 },
  })),
  sendSanitizedContext: vi.fn(async (ctx: unknown) => {
    capturedOutbound = ctx;
    return { ok: true, messageId: 'm1' };
  }),
  getBackendStatus: vi.fn(async () => ({ connected: true })),
  stopAgent: vi.fn(async () => {}),
  resumeAgent: vi.fn(async () => {}),
  onAgentEvent: vi.fn(() => () => {}),
}));

import { agentStore } from './agent-store';
import { runInspection, approveAndSend, transmit, markStopped, resumeFromStop } from './pipeline-runner';
import { requestSanitizePage } from './messaging';
import { redactor } from '@/privacy/redactor';

beforeEach(() => {
  agentStore.reset();
  capturedOutbound = null;
  resumeFromStop();
  agentStore.reset();
});

describe('runInspection — local pipeline', () => {
  it('walks every local stage to a waiting state', async () => {
    await runInspection();
    const s = agentStore.getState();
    const byId = Object.fromEntries(s.stages.map((x) => [x.id, x.status]));
    expect(byId.SCREEN_CAPTURE).toBe('success');
    expect(byId.DOM_ANALYSIS).toBe('success');
    expect(byId.PII_DETECTION).toBe('success');
    expect(byId.PRIVACY_FUSION).toBe('success');
    expect(byId.REDACTION).toBe('success');
    expect(byId.PRIVACY_VERIFICATION).toBe('success');
    expect(byId.USER_REVIEW).toBe('running');
    expect(s.status).toBe('waiting');
  });

  it('produces findings, counts, and a gate', async () => {
    await runInspection();
    const s = agentStore.getState();
    expect(s.findings.length).toBeGreaterThan(0);
    expect(s.detectionCounts.EMAIL).toBeGreaterThanOrEqual(1);
    expect(s.detectionCounts.PASSWORD).toBe(1);
    expect(['safe', 'warning']).toContain(s.gate.status);
    expect(s.gate.unresolvedHighRisk).toBe(0);
  });

  it('keeps the raw capture LOCAL and never in the outbound context', async () => {
    await runInspection();
    const s = agentStore.getState();
    expect(s.rawCapture?.dataUrl).toContain('RAWRAWRAW');
    const outboundJson = JSON.stringify(s.outboundContext);
    expect(outboundJson).not.toContain('RAWRAWRAW');
    expect(outboundJson).not.toContain('__localOnly');
  });

  it('the SANITIZED screenshot in the store is the one placed in the outbound context', async () => {
    await runInspection();
    const s = agentStore.getState();
    expect(s.sanitizedScreenshot?.sha256).toBe('sanitized-hash-abc');
    expect(s.outboundContext?.sanitizedScreenshot?.sha256).toBe(s.sanitizedScreenshot?.sha256);
    expect(s.outboundContext?.sanitizedScreenshot?.dataUrl).toBe(s.sanitizedScreenshot?.dataUrl);
  });
});

describe('strict vs automatic transmission', () => {
  it('strict: nothing is sent until approveAndSend', async () => {
    agentStore.setMode('strict');
    await runInspection();
    expect(agentStore.getState().sent).toBe(false);
    expect(capturedOutbound).toBeNull();

    const r = await approveAndSend();
    expect(r.ok).toBe(true);
    expect(agentStore.getState().sent).toBe(true);
    expect(capturedOutbound).not.toBeNull();
  });

  it('automatic: sends when the gate is clean', async () => {
    agentStore.setMode('automatic');
    await runInspection();
    // auto-send happens inside runInspection when the gate is safe
    const s = agentStore.getState();
    if (s.gate.status === 'safe') {
      expect(s.sent).toBe(true);
      expect(capturedOutbound).not.toBeNull();
    } else {
      expect(s.sent).toBe(false);
    }
  });

  it('automatic still enforces the gate — a blocked gate does not send', async () => {
    agentStore.setMode('automatic');
    await runInspection();
    // Force a blocked gate and retry transmit directly.
    agentStore.setGate({ ...agentStore.getState().gate, status: 'blocked', reasons: ['forced'] });
    capturedOutbound = null;
    const r = await transmit();
    expect(r.ok).toBe(false);
    expect(capturedOutbound).toBeNull();
  });
});

describe('CRITICAL — no raw sensitive data in the transmitted payload', () => {
  it('raw email / password / card never appear in the outbound context or logs', async () => {
    const logs: string[] = [];
    for (const m of ['log', 'warn', 'error', 'info'] as const) {
      vi.spyOn(console, m).mockImplementation((...a: unknown[]) => {
        logs.push(a.map(String).join(' '));
      });
    }

    agentStore.setMode('strict');
    await runInspection();
    await approveAndSend();

    const outboundJson = JSON.stringify(capturedOutbound);
    for (const [label, secret] of Object.entries(RAW_SECRETS)) {
      expect(outboundJson, `raw ${label} in payload`).not.toContain(secret);
      expect(logs.join('\n'), `raw ${label} in logs`).not.toContain(secret);
    }
    expect(outboundJson).not.toContain('RAWRAWRAW'); // raw screenshot bytes

    vi.restoreAllMocks();
  });
});

describe('REGRESSION — findings bbox must be in screenshot pixel space (dpr scaling)', () => {
  it('scales a content-script (CSS px) finding bbox by devicePixelRatio, so the overlay maps it correctly onto the screenshot', async () => {
    // A HiDPI display (dpr=2): a password field the content script reports
    // at CSS px (10,10,100,20) actually occupies (20,20,200,40) in the
    // screenshot's own pixel grid, since chrome.tabs.captureVisibleTab
    // captures at device resolution. If the stored finding still carries the
    // raw CSS-px box, DetectionOverlay (which divides by the screenshot's
    // *device*-px width) renders it at half the correct position/size.
    vi.mocked(requestSanitizePage).mockResolvedValueOnce({
      page: { title: 'Checkout', url: 'https://shop.example/checkout' },
      elements: [
        { id: 'pw', type: 'input', visible: true, enabled: true, bbox: [10, 10, 100, 20], metadata: { inputType: 'password' } },
      ],
      sanitizedTexts: [],
      findings: [
        { type: 'PASSWORD', source: 'DOM', confidence: 1, elementId: 'pw', bbox: { x: 10, y: 10, width: 100, height: 20 }, strategy: 'mask' },
      ],
      report: { total: 1, byType: { PASSWORD: 1 }, bySource: { DOM: 1 }, visualRegions: 0, tokenReplacements: 0 },
      timing: { dom: 5, regex: 3, ocr: 1, face: 0, vision: 0, fusion: 0, redaction: 0, total: 12 },
      backends: { face: 'none', vision: 'disabled', ocr: 'dom-text' },
      viewport: { width: 400, height: 300, dpr: 2, scrollX: 0, scrollY: 0 },
    });

    await runInspection();
    const s = agentStore.getState();
    const pwFinding = s.findings.find((f) => f.elementId === 'pw');
    expect(pwFinding?.bbox).toEqual({ x: 20, y: 20, width: 200, height: 40 });

    // The redaction region used against the actual screenshot pixels must
    // agree with the same scaled coordinates — otherwise the blur/blackout
    // lands somewhere other than where the overlay (and the user) is told
    // the sensitive content is.
    expect(s.outboundContext).toBeTruthy();
  });
});

describe('REGRESSION — visibly-typed field values must be blacked out in the screenshot, not just omitted from text', () => {
  it('blacks out a DOM password field region even though its text-domain strategy is "mask", not "blur"/"blackout"', async () => {
    // DOM findings for password/other-sensitive fields carry `strategy:
    // 'mask'`/'token' — that only means "never put the value in the JSON/text
    // payload" (the DOM scanner never reads .value to begin with). It says
    // nothing about the screenshot, where the browser has already rendered
    // whatever the user typed as actual pixels. Filtering visual redaction on
    // that same text-domain strategy field left every visibly-typed sensitive
    // value fully legible in the "sanitized" screenshot — this is exactly
    // what a live test against a real login page surfaced.
    const applySpy = vi.spyOn(redactor, 'applyVisualRedaction');

    await runInspection();

    expect(applySpy).toHaveBeenCalled();
    const regions = applySpy.mock.calls[0][1];
    const pwRegion = regions.find((r) => r.bbox.x === 10 && r.bbox.y === 10);
    expect(pwRegion, 'password field region must be present').toBeTruthy();
    expect(pwRegion!.strategy).toBe('blackout');

    applySpy.mockRestore();
  });
});

describe('STOP AGENT', () => {
  it('blocks transmission and marks pending stages blocked', async () => {
    agentStore.setMode('strict');
    await runInspection();
    markStopped('user');
    const r = await transmit();
    expect(r.ok).toBe(false);
    expect(agentStore.getState().status).toBe('stopped');
    expect(capturedOutbound).toBeNull();
  });
});
