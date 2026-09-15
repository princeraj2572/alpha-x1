/**
 * UI-facing state types for the Privacy Inspection Side Panel.
 *
 * These describe what the panel renders. The authoritative detection/redaction
 * types live in `@/privacy/*` and the transmission boundary in `./outbound`.
 */

import { PrivacyFinding } from '@/privacy/types';
import { RawCapture, SanitizedContext, SanitizedScreenshot } from './outbound';

/** The conceptual pipeline the user watches, in order. */
export const PIPELINE_STAGES = [
  'SCREEN_CAPTURE',
  'DOM_ANALYSIS',
  'PII_DETECTION',
  'VISION_DETECTION',
  'PRIVACY_FUSION',
  'REDACTION',
  'PRIVACY_VERIFICATION',
  'USER_REVIEW',
  'TRANSMISSION',
  'CLOUD_REASONING',
  'ACTION_VALIDATION',
  'EXECUTION',
] as const;

export type PipelineStageId = (typeof PIPELINE_STAGES)[number];

export type StageStatus = 'pending' | 'running' | 'success' | 'warning' | 'blocked' | 'error';

export interface StageState {
  id: PipelineStageId;
  status: StageStatus;
  /** short human line, e.g. "5 sensitive findings" */
  detail?: string;
  /** measured duration in ms, when the stage records timing */
  durationMs?: number;
}

export type AgentStatus = 'ready' | 'processing' | 'waiting' | 'running' | 'stopped' | 'error';

export type ScreenshotPhase =
  | 'none'
  | 'capturing'
  | 'raw-ready'
  | 'sanitizing'
  | 'sanitized-ready'
  | 'blocked'
  | 'error';

export type ScreenshotView = 'RAW' | 'SANITIZED' | 'SPLIT';

export type PrivacyMode = 'strict' | 'automatic';

export type PrivacyGateStatus = 'idle' | 'safe' | 'warning' | 'blocked' | 'error';

export interface PrivacyGateState {
  status: PrivacyGateStatus;
  sensitiveFindings: number;
  redacted: number;
  unresolvedHighRisk: number;
  rawScreenshotTransmitted: boolean; // always false
  rawDomTransmitted: boolean; // always false
  rawPiiTransmitted: boolean; // always false
  sanitizedScreenshotReady: boolean;
  sanitizedContextReady: boolean;
  verificationPassed: boolean;
  reasons: string[];
}

export interface SessionEvent {
  at: number;
  label: string;
  kind: 'capture' | 'detect' | 'redact' | 'verify' | 'user' | 'network' | 'cloud' | 'validate' | 'execute' | 'error';
}

export interface Metrics {
  domAnalysisMs?: number;
  piiDetectionMs?: number;
  visionInferenceMs?: number;
  redactionMs?: number;
  fusionMs?: number;
  sanitizedPayloadBytes?: number;
  networkLatencyMs?: number;
  cloudLatencyMs?: number;
  totalLatencyMs?: number;
}

export interface CloudDecisionState {
  status: 'idle' | 'sending' | 'processing' | 'received' | 'error';
  provider?: string;
  model?: string;
  actionType?: string;
  targetLabel?: string;
  confidence?: number;
  note?: string;
}

export interface ActionValidationState {
  status: 'idle' | 'checking' | 'approved' | 'blocked' | 'error';
  actionSummary?: string;
  checks: {
    targetExists?: boolean;
    targetVisible?: boolean;
    pageStateValid?: boolean;
    actionAllowed?: boolean;
    schemaValid?: boolean;
  };
  reason?: string;
}

/**
 * A dangerous cloud action (navigate/finish — see ActionPolicyValidator)
 * waiting on the user's explicit approval before it executes (DECISION-029).
 */
export interface PendingCloudAction {
  id: string;
  actionType: string;
  targetLabel?: string | null;
  reason?: string | null;
  riskLevel?: string | null;
}

export interface ExecutionState {
  status: 'idle' | 'executing' | 'done' | 'failed';
  success?: boolean;
  error?: string;
  executionTimeMs?: number;
}

/** A finding projected for the UI list — never carries the secret value. */
export interface UiFinding {
  key: string;
  type: PrivacyFinding['type'];
  source: PrivacyFinding['source'];
  confidence: number;
  bbox?: { x: number; y: number; width: number; height: number };
  elementId?: string;
  detail?: string;
  strategy?: PrivacyFinding['strategy'];
}

export interface AgentState {
  status: AgentStatus;
  privacyMode: PrivacyMode;
  stages: StageState[];
  screenshotPhase: ScreenshotPhase;
  screenshotView: ScreenshotView;
  showDetectionRegions: boolean;
  selectedFindingKey: string | null;

  /** LOCAL ONLY — never leaves this object into any send path. */
  rawCapture: RawCapture | null;
  /** the redacted screenshot shown in the SANITIZED tab AND sent to cloud. */
  sanitizedScreenshot: SanitizedScreenshot | null;

  findings: UiFinding[];
  detectionCounts: Record<string, number>;

  gate: PrivacyGateState;
  metrics: Metrics;
  timeline: SessionEvent[];

  /** the exact object queued for / sent to the cloud. */
  outboundContext: SanitizedContext | null;
  approved: boolean;
  sent: boolean;

  cloud: CloudDecisionState;
  actionValidation: ActionValidationState;
  pendingCloudAction: PendingCloudAction | null;
  execution: ExecutionState;

  error: string | null;
  backendConnected: boolean;
  task: string;
}
