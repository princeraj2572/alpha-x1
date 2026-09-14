import { useState } from 'react';
import { useAgentStore, agentStore } from '../state/agent-store';
import { canTransmit } from '../state/privacy-gate';
import { approveAndSend, transmit, isStopped } from '../state/pipeline-runner';
import { Card, Button, c } from './primitives';
import { SanitizedContextViewer } from './SanitizedContextViewer';
import { OutboundDataViewer } from './OutboundDataViewer';

/**
 * The transmission control. The SEND button is disabled unless `canTransmit`
 * says yes — which requires sanitization complete, verification passed, a valid
 * context, no unresolved high-risk finding, and (strict mode) user approval.
 */
export function PrivacyReview() {
  const s = useAgentStore();
  const [showContext, setShowContext] = useState(false);
  const [showOutbound, setShowOutbound] = useState(false);
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const decision = canTransmit({
    mode: s.privacyMode,
    gate: s.gate,
    approved: s.approved,
    sent: s.sent,
    stopped: isStopped(),
    outboundContext: s.outboundContext,
    previewSha256: s.sanitizedScreenshot?.sha256 ?? null,
  });

  const onSend = async () => {
    setPending(true);
    setResult(null);
    const r = s.privacyMode === 'strict' && !s.approved ? await approveAndSend() : await transmit();
    setResult(r.ok ? 'Sent.' : `Blocked: ${r.reason}`);
    setPending(false);
  };

  return (
    <Card
      title="Privacy Review"
      right={
        <select
          value={s.privacyMode}
          onChange={(e) => agentStore.setMode(e.target.value as 'strict' | 'automatic')}
          style={{
            fontSize: 10,
            background: c.panel2,
            color: c.text,
            border: `1px solid ${c.border}`,
            borderRadius: 6,
            padding: '2px 4px',
          }}
        >
          <option value="strict">strict review</option>
          <option value="automatic">automatic</option>
        </select>
      }
    >
      <p style={{ fontSize: 11, color: c.dim }}>
        {s.privacyMode === 'strict'
          ? 'Nothing is transmitted until you approve the sanitized context below.'
          : 'Automatic mode still enforces the Privacy Gate — it will not send if the gate is not clean.'}
      </p>

      <Button tone="ghost" onClick={() => setShowContext((v) => !v)}>
        {showContext ? 'Hide' : 'View'} Sanitized Context
      </Button>
      {showContext && <SanitizedContextViewer />}

      <Button tone="ghost" onClick={() => setShowOutbound((v) => !v)}>
        {showOutbound ? 'Hide' : 'View'} Outbound Data
      </Button>
      {showOutbound && <OutboundDataViewer />}

      {s.privacyMode === 'strict' && !s.approved && !s.sent && (
        <Button tone="default" disabled={s.gate.status === 'blocked' || s.gate.status === 'idle'} onClick={() => agentStore.setApproved(true)}>
          Approve sanitized context
        </Button>
      )}

      <Button tone="primary" disabled={!decision.allowed || pending} onClick={onSend} title={decision.reason}>
        {s.sent ? 'Sent to cloud ✓' : pending ? 'Sending…' : 'Send to Cloud'}
      </Button>
      {!decision.allowed && !s.sent && (
        <p style={{ fontSize: 10, color: c.dim, marginTop: 4 }}>Send disabled: {decision.reason}</p>
      )}
      {result && (
        <p style={{ fontSize: 11, color: result.startsWith('Sent') ? c.ok : c.bad, marginTop: 4 }}>{result}</p>
      )}
    </Card>
  );
}
