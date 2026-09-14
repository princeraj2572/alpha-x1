/**
 * Tiny observable store for the side panel. Framework-free so the logic stays
 * in `.ts`; components read it through `useAgentStore` (useSyncExternalStore).
 */

import { useSyncExternalStore } from 'react';
import {
  AgentState,
  PipelineStageId,
  PIPELINE_STAGES,
  SessionEvent,
  StageStatus,
  UiFinding,
} from './types';
import { RawCapture, SanitizedContext, SanitizedScreenshot } from './outbound';

function initialStages() {
  return PIPELINE_STAGES.map((id) => ({ id, status: 'pending' as StageStatus }));
}

function initialState(): AgentState {
  return {
    status: 'ready',
    privacyMode: 'strict',
    stages: initialStages(),
    screenshotPhase: 'none',
    screenshotView: 'SANITIZED',
    showDetectionRegions: false,
    selectedFindingKey: null,
    rawCapture: null,
    sanitizedScreenshot: null,
    findings: [],
    detectionCounts: {},
    gate: {
      status: 'idle',
      sensitiveFindings: 0,
      redacted: 0,
      unresolvedHighRisk: 0,
      rawScreenshotTransmitted: false,
      rawDomTransmitted: false,
      rawPiiTransmitted: false,
      sanitizedScreenshotReady: false,
      sanitizedContextReady: false,
      verificationPassed: false,
      reasons: [],
    },
    metrics: {},
    timeline: [],
    outboundContext: null,
    approved: false,
    sent: false,
    cloud: { status: 'idle' },
    actionValidation: { status: 'idle', checks: {} },
    execution: { status: 'idle' },
    error: null,
    backendConnected: false,
    task: 'Complete the primary action on this page',
  };
}

type Listener = () => void;

class AgentStore {
  private state: AgentState = initialState();
  private listeners = new Set<Listener>();

  getState = (): AgentState => this.state;

  subscribe = (l: Listener): (() => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };

  private set(patch: Partial<AgentState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((l) => l());
  }

  /* ----- lifecycle ----- */

  reset() {
    // Explicitly drop the raw capture reference so it can be GC'd.
    this.state = initialState();
    this.listeners.forEach((l) => l());
  }

  resetForNewCapture() {
    const { privacyMode, task, backendConnected } = this.state;
    this.state = { ...initialState(), privacyMode, task, backendConnected };
    this.listeners.forEach((l) => l());
  }

  setStatus(status: AgentState['status']) {
    this.set({ status });
  }

  setMode(privacyMode: AgentState['privacyMode']) {
    this.set({ privacyMode });
  }

  setTask(task: string) {
    this.set({ task });
  }

  setBackendConnected(backendConnected: boolean) {
    this.set({ backendConnected });
  }

  setError(error: string | null) {
    this.set({ error, status: error ? 'error' : this.state.status });
  }

  /* ----- pipeline stages ----- */

  setStage(id: PipelineStageId, status: StageStatus, detail?: string, durationMs?: number) {
    const stages = this.state.stages.map((s) =>
      s.id === id ? { ...s, status, detail: detail ?? s.detail, durationMs: durationMs ?? s.durationMs } : s
    );
    this.set({ stages });
  }

  /* ----- screenshots ----- */

  setRawCapture(rawCapture: RawCapture | null) {
    this.set({ rawCapture, screenshotPhase: rawCapture ? 'raw-ready' : 'none' });
  }

  setScreenshotPhase(screenshotPhase: AgentState['screenshotPhase']) {
    this.set({ screenshotPhase });
  }

  setSanitizedScreenshot(sanitizedScreenshot: SanitizedScreenshot | null) {
    this.set({
      sanitizedScreenshot,
      screenshotPhase: sanitizedScreenshot ? 'sanitized-ready' : this.state.screenshotPhase,
    });
  }

  /** Release the raw screenshot from memory once it is no longer needed. */
  releaseRawCapture() {
    this.set({ rawCapture: null });
  }

  setScreenshotView(screenshotView: AgentState['screenshotView']) {
    this.set({ screenshotView });
  }

  toggleDetectionRegions(force?: boolean) {
    this.set({ showDetectionRegions: force ?? !this.state.showDetectionRegions });
  }

  selectFinding(selectedFindingKey: string | null) {
    this.set({ selectedFindingKey });
  }

  /* ----- detections ----- */

  setFindings(findings: UiFinding[]) {
    const detectionCounts: Record<string, number> = {};
    for (const f of findings) {
      detectionCounts[f.type] = (detectionCounts[f.type] ?? 0) + 1;
    }
    this.set({ findings, detectionCounts });
  }

  /* ----- gate / outbound ----- */

  setGate(gate: AgentState['gate']) {
    this.set({ gate });
  }

  setMetrics(patch: Partial<AgentState['metrics']>) {
    this.set({ metrics: { ...this.state.metrics, ...patch } });
  }

  setOutboundContext(outboundContext: SanitizedContext | null) {
    this.set({ outboundContext });
  }

  setApproved(approved: boolean) {
    this.set({ approved });
  }

  setSent(sent: boolean) {
    this.set({ sent });
  }

  /* ----- cloud / validation / execution ----- */

  setCloud(patch: Partial<AgentState['cloud']>) {
    this.set({ cloud: { ...this.state.cloud, ...patch } });
  }

  setActionValidation(patch: Partial<AgentState['actionValidation']>) {
    this.set({ actionValidation: { ...this.state.actionValidation, ...patch } });
  }

  setExecution(patch: Partial<AgentState['execution']>) {
    this.set({ execution: { ...this.state.execution, ...patch } });
  }

  /* ----- timeline ----- */

  addEvent(label: string, kind: SessionEvent['kind']) {
    const timeline = [...this.state.timeline, { at: Date.now(), label, kind }];
    this.set({ timeline });
  }
}

export const agentStore = new AgentStore();

/**
 * React binding. Returns the whole state. The store swaps the entire state
 * object on every change, so the snapshot reference is stable between changes
 * and `useSyncExternalStore` will not loop.
 */
export function useAgentStore(): AgentState {
  return useSyncExternalStore(agentStore.subscribe, agentStore.getState, agentStore.getState);
}
