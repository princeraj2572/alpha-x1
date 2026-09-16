/**
 * Orchestrates the local privacy pipeline for the side panel and drives the
 * store through every stage the user watches.
 *
 *   capture -> DOM/PII (content script) -> vision (panel) -> fusion ->
 *   redaction -> verification -> build SanitizedContext -> gate -> review ->
 *   approve -> transmit
 *
 * The raw screenshot never leaves this module except as pixels fed into the
 * local redactor. The only thing handed to the network is a `SanitizedContext`.
 */

import { detectionFusionEngine } from '@/privacy/detection-fusion';
import { faceDetectionService } from '@/privacy/face-detector';
import { ocrService } from '@/privacy/ocr';
import { redactor, ImageLike } from '@/privacy/redactor';
import { PrivacyFinding, PrivacyType, DetectionSource } from '@/privacy/types';
import { agentStore } from './agent-store';
import { computeGate, canTransmit, countUnresolvedHighRisk } from './privacy-gate';
import {
  buildSanitizedContext,
  SanitizedElement,
  validateSanitizedContext,
} from './outbound';
import { captureActiveTab, dataUrlToImageData, imageDataToCanvas, toSanitizedScreenshot } from './screenshot';
import { requestSanitizePage, sendSanitizedContext, SanitizePageResult } from './messaging';
import { getVisionModel, getVisionModelError } from './vision-loader';
import { getFaceModelError } from './face-loader';
import { ensureRealOcrEngine } from './ocr-loader';
import { UiFinding } from './types';
import { createMetricsCollector } from '@/evaluation/metrics-collector';

/** One collector per panel session, aggregating every inspection run for the SIH benchmark. */
export const metricsCollector = createMetricsCollector(crypto.randomUUID());

let running = false;
let stopped = false;
/** Decoded raw pixels, held only between the vision and redaction stages. */
let rawImageData: ImageData | null = null;

export function isStopped(): boolean {
  return stopped;
}

export function markStopped(reason = 'user stop') {
  stopped = true;
  running = false;
  agentStore.setStatus('stopped');
  agentStore.addEvent(`Agent stopped — ${reason}`, 'user');
  // Any stage not yet successful becomes blocked.
  for (const s of agentStore.getState().stages) {
    if (s.status === 'running' || s.status === 'pending') {
      agentStore.setStage(s.id, 'blocked', 'stopped by user');
    }
  }
}

export function resumeFromStop() {
  stopped = false;
  agentStore.reset();
}

function ensureNotStopped() {
  if (stopped) {
    throw new Error('agent stopped by user');
  }
}

/**
 * Run local capture + detection + redaction + verification. Does NOT transmit.
 */
export async function runInspection(): Promise<void> {
  if (running) {
    return;
  }
  running = true;
  stopped = false;
  const t0 = performance.now();

  agentStore.resetForNewCapture();
  agentStore.setStatus('processing');
  agentStore.addEvent('Inspection started', 'user');

  try {
    /* 1. SCREEN CAPTURE ---------------------------------------------------- */
    agentStore.setStage('SCREEN_CAPTURE', 'running');
    agentStore.setScreenshotPhase('capturing');
    const capMark = performance.now();
    const raw = await captureActiveTab();
    ensureNotStopped();
    agentStore.setRawCapture(raw);
    agentStore.setStage('SCREEN_CAPTURE', 'success', `${raw.width}×${raw.height}`, performance.now() - capMark);
    agentStore.addEvent('Screen captured (local only)', 'capture');

    /* 2. DOM ANALYSIS + PII DETECTION (content script) -------------------- */
    agentStore.setStage('DOM_ANALYSIS', 'running');
    agentStore.setStage('PII_DETECTION', 'running');
    let page: SanitizePageResult;
    try {
      page = await requestSanitizePage();
    } catch (err) {
      agentStore.setStage('DOM_ANALYSIS', 'error', String(err));
      agentStore.setStage('PII_DETECTION', 'error');
      throw err;
    }
    ensureNotStopped();
    agentStore.setStage('DOM_ANALYSIS', 'success', `${page.elements.length} elements`, page.timing.dom);
    const contentFindings = rehydrate(page.findings);
    agentStore.setStage(
      'PII_DETECTION',
      'success',
      `${contentFindings.filter((f) => f.source !== DetectionSource.DOM).length} PII / ${contentFindings.length} total`,
      page.timing.regex
    );
    agentStore.setMetrics({ domAnalysisMs: page.timing.dom, piiDetectionMs: page.timing.regex });
    agentStore.addEvent(`DOM analyzed — ${contentFindings.length} findings`, 'detect');

    /* 3. VISION DETECTION (panel, on the captured screenshot) ------------- */
    agentStore.setStage('VISION_DETECTION', 'running');
    const visMark = performance.now();
    const visualFindings: PrivacyFinding[] = [];
    const visionNotes: string[] = [];
    try {
      rawImageData = await dataUrlToImageData(raw.dataUrl);
      const canvas = imageDataToCanvas(rawImageData);

      const faceBackend = await faceDetectionService.activeBackend();
      if (faceBackend !== 'none') {
        const faceFindings = await faceDetectionService.detectFindings(canvas);
        visualFindings.push(...faceFindings);
        visionNotes.push(`${faceFindings.length} face region(s) via ${faceBackend}`);
      } else {
        const reason = getFaceModelError();
        visionNotes.push(
          reason ? `face detection unavailable (${reason})` : 'face detection unavailable in this browser'
        );
      }

      const model = await getVisionModel();
      if (model) {
        const objectFindings = await model.detectFindings(rawImageData);
        visualFindings.push(...objectFindings);
        visionNotes.push(`${objectFindings.length} object region(s) via yolov8n/${model.getExecutionProvider()}`);
      } else {
        visionNotes.push(`vision model unavailable (${getVisionModelError() ?? 'no model file / execution provider'})`);
      }

      // Real pixel OCR on the screenshot — catches PII rendered as an image
      // (a photographed ID card, a screenshot pasted into the page) that DOM
      // text scanning can never see, since it has no textContent at all.
      const ocrEngine = await ensureRealOcrEngine();
      if (ocrEngine) {
        const { findings: ocrFindings, regionCount } = await ocrService.detectVerbose({ kind: 'canvas', canvas });
        visualFindings.push(...ocrFindings);
        // Report BOTH numbers: "0 PII finding(s)" alone can't distinguish
        // "tesseract recognized no text at all" from "it recognized text,
        // none of which matched a PII pattern" — the first points at OCR
        // itself, the second means OCR worked and there's nothing to flag.
        visionNotes.push(`${ocrFindings.length} OCR PII finding(s) via tesseract (${regionCount} text region(s) read)`);
      } else {
        visionNotes.push('OCR engine unavailable');
      }

      const anySucceeded = faceBackend !== 'none' || Boolean(model) || Boolean(ocrEngine);
      agentStore.setStage(
        'VISION_DETECTION',
        anySucceeded ? 'success' : 'warning',
        visionNotes.join(' · '),
        performance.now() - visMark
      );
      agentStore.setMetrics({ visionInferenceMs: performance.now() - visMark });
    } catch (err) {
      agentStore.setStage('VISION_DETECTION', 'warning', `skipped: ${err instanceof Error ? err.message : err}`);
    }
    ensureNotStopped();

    /* 4. PRIVACY FUSION ------------------------------------------------- */
    agentStore.setStage('PRIVACY_FUSION', 'running');
    const fuseMark = performance.now();
    // Normalize bboxes into screenshot pixel space BEFORE fusion, not after.
    // Content-script findings (DOM/REGEX/OCR) come back in CSS px; panel-side
    // detectors (face/vision model) already ran on the screenshot's own
    // pixels. Fusion can merge two findings into one `source: FUSED` result,
    // which erases which original source contributed the winning bbox — so
    // per-source scaling has to happen while that information still exists,
    // not on the post-merge output. This also makes fusion's own IoU/overlap
    // checks compare same-space coordinates instead of mixing CSS px and
    // device px.
    const scaledContentFindings = contentFindings.map((f) =>
      f.bbox ? { ...f, bbox: scaleBox(f.bbox, page.viewport.dpr) } : f
    );
    let fused = detectionFusionEngine.fuse([...scaledContentFindings, ...visualFindings]);
    fused = detectionFusionEngine.applyRiskPolicy(fused);
    agentStore.setStage('PRIVACY_FUSION', 'success', `${fused.length} after merge`, performance.now() - fuseMark);
    agentStore.setMetrics({ fusionMs: performance.now() - fuseMark });

    const uiFindings: UiFinding[] = fused.map((f, i) => ({
      key: `f${i}-${f.type}-${f.source}`,
      type: f.type,
      source: f.source,
      confidence: f.confidence,
      bbox: f.bbox,
      elementId: f.elementId,
      detail: f.detail,
      strategy: f.strategy,
    }));
    agentStore.setFindings(uiFindings);
    agentStore.addEvent(`Privacy fusion — ${fused.length} findings`, 'detect');

    /* 5. REDACTION ---------------------------------------------------- */
    agentStore.setStage('REDACTION', 'running');
    agentStore.setScreenshotPhase('sanitizing');
    const redMark = performance.now();

    let sanitizedShot = null;
    if (rawImageData) {
      // Any finding with a known screen location gets its region blacked out
      // in the screenshot — not just findings whose *text*-domain strategy
      // happens to be 'blur'/'blackout'. A DOM password/email field is
      // 'mask'/'token' in text terms (its value is simply never read), but
      // the browser has still rendered whatever the user typed as pixels in
      // the screenshot itself, and that rendering is invisible to the text
      // pipeline entirely. Skipping visual redaction for anything but
      // FACE/DOCUMENT findings left every visibly-typed sensitive value
      // fully legible in the "sanitized" image. `blur` is reserved for faces
      // (de-identifies while staying recognizable as a person); everything
      // else gets a solid blackout, since there's no safe partial-redaction
      // of arbitrary rendered text.
      // `fused` bboxes are already normalized to screenshot pixel space
      // (see the fusion step above) — no per-source scaling needed here.
      const regions = fused
        .filter((f) => f.bbox)
        .map((f) => ({
          bbox: f.bbox!,
          strategy: (f.strategy === 'blur' ? 'blur' : 'blackout') as 'blur' | 'blackout',
          type: f.type,
        }));
      const redacted: ImageLike = regions.length
        ? redactor.applyVisualRedaction(rawImageData, regions)
        : { data: new Uint8ClampedArray(rawImageData.data), width: rawImageData.width, height: rawImageData.height };
      sanitizedShot = await toSanitizedScreenshot(redacted);
      agentStore.setSanitizedScreenshot(sanitizedShot);
    }
    // Free the decoded raw pixels — they are no longer needed.
    rawImageData = null;

    agentStore.setStage('REDACTION', 'success', `${fused.filter((f) => f.bbox).length} visual, ${page.report.tokenReplacements} text`, performance.now() - redMark);
    agentStore.setMetrics({ redactionMs: performance.now() - redMark });
    agentStore.addEvent('Redaction complete', 'redact');

    /* 6. PRIVACY VERIFICATION -------------------------------------------- */
    agentStore.setStage('PRIVACY_VERIFICATION', 'running');
    const unresolvedHighRisk = countUnresolvedHighRisk(fused);
    const elements: SanitizedElement[] = page.elements.map((el) => toSanitizedElement(el, fused));

    const draft = buildSanitizedContext({
      page: { title: page.page.title, url: page.page.url },
      elements,
      sanitizedTexts: page.sanitizedTexts,
      findings: fused,
      report: page.report,
      unresolvedHighRisk,
      verificationPassed: false,
      sanitizedScreenshot: sanitizedShot,
      task: agentStore.getState().task,
    });

    const check = validateSanitizedContext({ ...draft, privacyReport: { ...draft.privacyReport, verificationPassed: true } });
    const verificationPassed = check.ok && unresolvedHighRisk === 0;

    const verified = { ...draft, privacyReport: { ...draft.privacyReport, verificationPassed } };
    agentStore.setOutboundContext(verified);
    agentStore.setStage(
      'PRIVACY_VERIFICATION',
      verificationPassed ? 'success' : 'blocked',
      verificationPassed ? 'passed' : check.errors[0] ?? `${unresolvedHighRisk} unresolved high-risk`,
    );
    agentStore.addEvent(verificationPassed ? 'Privacy verification passed' : 'Privacy verification blocked', 'verify');

    /* 7. GATE + payload size ------------------------------------------- */
    const payloadBytes = new TextEncoder().encode(JSON.stringify(verified)).length;
    agentStore.setMetrics({ sanitizedPayloadBytes: payloadBytes });
    const gate = computeGate({
      findings: fused,
      verificationPassed,
      sanitizedScreenshotReady: Boolean(sanitizedShot),
      sanitizedContextReady: true,
      // Text-domain replacements (content script) + the panel's own visual
      // (screenshot pixel) redactions — `page.report.visualRegions` only
      // covers the content script's own limited DOM+regex+OCR pipeline
      // (always 0 in practice, since it runs with vision/face disabled) and
      // would otherwise undercount what actually got blacked out above.
      redactedCount: page.report.tokenReplacements + fused.filter((f) => f.bbox).length,
    });
    agentStore.setGate(gate);

    /* 8. USER REVIEW / AUTO ------------------------------------------- */
    agentStore.setStage('USER_REVIEW', 'running', agentStore.getState().privacyMode === 'strict' ? 'awaiting approval' : 'automatic mode');
    agentStore.setScreenshotPhase(verificationPassed ? 'sanitized-ready' : 'blocked');
    agentStore.setStatus('waiting');
    agentStore.setMetrics({ totalLatencyMs: performance.now() - t0 });

    // Feed this run into the session's MetricsCollector (DECISION-031's
    // follow-up) — real per-stage timings and element counts, all already
    // computed above for the UI's own MetricsPanel, just also recorded here
    // for cross-run aggregation.
    metricsCollector.recordLatency(agentStore.getState().metrics);
    metricsCollector.recordResource({
      domElementsCount: page.elements.length,
      visualElementsCount: visualFindings.length,
      redactedElementsCount: fused.filter((f) => f.bbox).length,
    });

    if (agentStore.getState().privacyMode === 'automatic') {
      await maybeAutoSend();
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('stopped by user')) {
      markStopped();
    } else {
      agentStore.setError(message);
      agentStore.addEvent(`Error: ${message}`, 'error');
    }
  } finally {
    running = false;
    // Belt-and-suspenders: release decoded raw pixels on every exit path
    // (including Stop mid-pipeline), not just the redaction stage's happy
    // path — the whole point of decoding them locally is that they don't
    // outlive the moment they're needed (README §17, DECISION-020).
    rawImageData = null;
  }
}

async function maybeAutoSend() {
  const s = agentStore.getState();
  const decision = canTransmit({
    mode: 'automatic',
    gate: s.gate,
    approved: false,
    sent: s.sent,
    stopped,
    outboundContext: s.outboundContext,
    previewSha256: s.sanitizedScreenshot?.sha256 ?? null,
  });
  if (decision.allowed) {
    await transmit();
  } else {
    agentStore.setStage('USER_REVIEW', 'warning', `automatic hold: ${decision.reason}`);
  }
}

/** Strict-mode approval. */
export function approve() {
  agentStore.setApproved(true);
  agentStore.addEvent('User approved sanitized context', 'user');
}

export async function approveAndSend(): Promise<{ ok: boolean; reason: string }> {
  approve();
  return transmit();
}

/**
 * The single transmission path. Re-checks the gate + runtime validation and
 * hands ONLY the SanitizedContext to the background.
 */
export async function transmit(): Promise<{ ok: boolean; reason: string }> {
  const s = agentStore.getState();
  const decision = canTransmit({
    mode: s.privacyMode,
    gate: s.gate,
    approved: s.approved,
    sent: s.sent,
    stopped,
    outboundContext: s.outboundContext,
    previewSha256: s.sanitizedScreenshot?.sha256 ?? null,
  });
  if (!decision.allowed || !s.outboundContext) {
    agentStore.setStage('TRANSMISSION', 'blocked', decision.reason);
    return { ok: false, reason: decision.reason };
  }

  agentStore.setStage('TRANSMISSION', 'running');
  agentStore.setCloud({ status: 'sending' });
  const netMark = performance.now();
  const res = await sendSanitizedContext(
    s.outboundContext,
    s.sanitizedScreenshot?.sha256 ?? null,
    s.task
  );
  const netMs = performance.now() - netMark;
  agentStore.setMetrics({ networkLatencyMs: netMs });

  if (!res.ok) {
    agentStore.setStage('TRANSMISSION', 'error', res.error);
    agentStore.setCloud({ status: 'error', note: res.error });
    agentStore.addEvent(`Transmission rejected: ${res.error}`, 'error');
    return { ok: false, reason: res.error ?? 'transmission failed' };
  }

  agentStore.setSent(true);
  agentStore.setStage('TRANSMISSION', 'success', `${agentStore.getState().metrics.sanitizedPayloadBytes ?? 0} bytes`);
  agentStore.setStage('USER_REVIEW', 'success');
  agentStore.setStage('CLOUD_REASONING', 'running');
  agentStore.setStatus('running');
  agentStore.setCloud({ status: 'processing' });
  agentStore.addEvent('Sanitized context sent to cloud', 'network');
  return { ok: true, reason: 'sent' };
}

/* -------------------------------------------------------------------------- */

function rehydrate(raw: SanitizePageResult['findings']): PrivacyFinding[] {
  return raw.map((f) => ({
    type: f.type as PrivacyType,
    source: f.source as DetectionSource,
    confidence: f.confidence,
    bbox: f.bbox,
    elementId: f.elementId,
    detail: f.detail,
    strategy: f.strategy as PrivacyFinding['strategy'],
  }));
}

function scaleBox(b: { x: number; y: number; width: number; height: number }, k: number) {
  if (k === 1) {
    return b;
  }
  return { x: b.x * k, y: b.y * k, width: b.width * k, height: b.height * k };
}

function toSanitizedElement(
  el: SanitizePageResult['elements'][number],
  findings: PrivacyFinding[]
): SanitizedElement {
  const match = findings.find((f) => f.elementId === el.id);
  const out: SanitizedElement = {
    id: el.id,
    type: el.type,
    bbox: el.bbox,
  };
  const label = (el.metadata?.placeholder as string) || el.ariaLabel;
  if (label) {
    out.label = label;
  }
  if (el.text) {
    out.text = el.text;
  }
  if (match) {
    out.sensitiveType = match.type;
    out.value = match.replacement ?? `[${match.type}]`;
  }
  return out;
}

