/**
 * Privacy Gate — the decision on whether the sanitized context may be sent.
 *
 * Pure functions only; the UI renders whatever this returns and the transport
 * layer independently re-checks via `validateSanitizedContext`. The gate never
 * relies on the UI to enforce anything.
 */

import { HIGH_RISK_TYPES } from '@/privacy/detection-fusion';
import { PrivacyFinding } from '@/privacy/types';
import { PrivacyGateState, PrivacyGateStatus, PrivacyMode, UiFinding } from './types';
import { SanitizedContext, validateSanitizedContext } from './outbound';

export interface GateInputs {
  findings: PrivacyFinding[] | UiFinding[];
  verificationPassed: boolean;
  sanitizedScreenshotReady: boolean;
  sanitizedContextReady: boolean;
  /** total redactions the pipeline reported (token + visual). */
  redactedCount: number;
}

/**
 * Count findings on a high-risk type that were NOT confidently resolved.
 * "Resolved" = confidence >= 0.6 (fusion's fail-closed threshold) OR the
 * detail string shows the risk policy forced a redaction (still counts as
 * redacted, so it's resolved for transmission purposes).
 */
export function countUnresolvedHighRisk(findings: Array<{ type: PrivacyFinding['type']; confidence: number; detail?: string }>): number {
  return findings.filter((f) => {
    if (!HIGH_RISK_TYPES.has(f.type)) {
      return false;
    }
    const forcedRedaction = (f.detail ?? '').includes('risk-policy') || (f.detail ?? '').includes('fail-closed');
    return f.confidence < 0.6 && !forcedRedaction;
  }).length;
}

export function computeGate(inputs: GateInputs): PrivacyGateState {
  const findings = inputs.findings as Array<{ type: PrivacyFinding['type']; confidence: number; detail?: string }>;
  const sensitiveFindings = findings.length;
  const unresolvedHighRisk = countUnresolvedHighRisk(findings);

  const reasons: string[] = [];
  let status: PrivacyGateStatus = 'safe';

  if (!inputs.sanitizedContextReady) {
    status = 'idle';
    reasons.push('sanitized context not built yet');
  }
  if (inputs.sanitizedContextReady && !inputs.verificationPassed) {
    status = 'blocked';
    reasons.push('privacy verification did not pass');
  }
  if (unresolvedHighRisk > 0) {
    status = 'blocked';
    reasons.push(`${unresolvedHighRisk} unresolved high-risk finding(s)`);
  }
  if (inputs.sanitizedContextReady && inputs.verificationPassed && unresolvedHighRisk === 0) {
    if (!inputs.sanitizedScreenshotReady) {
      // context can still be sent without a screenshot, but flag it
      status = 'warning';
      reasons.push('no sanitized screenshot (context-only transmission)');
    } else {
      status = 'safe';
    }
  }

  return {
    status,
    sensitiveFindings,
    redacted: inputs.redactedCount,
    unresolvedHighRisk,
    rawScreenshotTransmitted: false,
    rawDomTransmitted: false,
    rawPiiTransmitted: false,
    sanitizedScreenshotReady: inputs.sanitizedScreenshotReady,
    sanitizedContextReady: inputs.sanitizedContextReady,
    verificationPassed: inputs.verificationPassed,
    reasons,
  };
}

/**
 * The single authority on whether the SEND button may fire.
 *
 * strict:    gate must be safe/warning AND user must have approved.
 * automatic: gate must be safe (not warning) — no manual approval, but the
 *            gate is still fully enforced.
 */
export function canTransmit(params: {
  mode: PrivacyMode;
  gate: PrivacyGateState;
  approved: boolean;
  sent: boolean;
  stopped: boolean;
  outboundContext: SanitizedContext | null;
  previewSha256: string | null;
}): { allowed: boolean; reason: string } {
  if (params.stopped) {
    return { allowed: false, reason: 'agent stopped by user' };
  }
  if (params.sent) {
    return { allowed: false, reason: 'already sent for this capture' };
  }
  if (!params.outboundContext) {
    return { allowed: false, reason: 'no sanitized context' };
  }

  const runtime = validateSanitizedContext(params.outboundContext, {
    previewSha256: params.previewSha256,
  });
  if (!runtime.ok) {
    return { allowed: false, reason: runtime.errors[0] };
  }

  if (params.gate.status === 'blocked' || params.gate.status === 'error') {
    return { allowed: false, reason: params.gate.reasons[0] ?? 'privacy gate blocked' };
  }
  if (params.gate.status === 'idle') {
    return { allowed: false, reason: 'sanitization not complete' };
  }

  if (params.mode === 'strict') {
    if (!params.approved) {
      return { allowed: false, reason: 'awaiting user approval (strict mode)' };
    }
    return { allowed: true, reason: 'approved' };
  }

  // automatic
  if (params.gate.status === 'warning') {
    return { allowed: false, reason: 'automatic mode requires a clean gate; ' + (params.gate.reasons[0] ?? '') };
  }
  return { allowed: true, reason: 'automatic — gate clean' };
}
