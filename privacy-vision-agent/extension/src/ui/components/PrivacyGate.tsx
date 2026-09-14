import { ShieldCheck, ShieldAlert, ShieldX, ShieldQuestion } from 'lucide-react';
import { useAgentStore } from '../state/agent-store';
import { Card, Row, Pill, c } from './primitives';

const GATE_TONE: Record<string, 'ok' | 'warn' | 'bad' | 'dim'> = {
  safe: 'ok',
  warning: 'warn',
  blocked: 'bad',
  error: 'bad',
  idle: 'dim',
};

const GATE_LABEL: Record<string, string> = {
  safe: 'SAFE TO SEND',
  warning: 'SEND WITH CAUTION',
  blocked: 'BLOCKED',
  error: 'ERROR',
  idle: 'NOT READY',
};

const GATE_ICON: Record<string, typeof ShieldCheck> = {
  safe: ShieldCheck,
  warning: ShieldAlert,
  blocked: ShieldX,
  error: ShieldX,
  idle: ShieldQuestion,
};

function OkTag() {
  return <span style={{ color: c.ok, fontWeight: 700, fontSize: 11 }}>NO</span>;
}

export function PrivacyGate() {
  const { gate, metrics } = useAgentStore();
  const GateIcon = GATE_ICON[gate.status] ?? ShieldQuestion;
  return (
    <Card title="Privacy Gate">
      <Row label="Sensitive findings" value={gate.sensitiveFindings} />
      <Row label="Redacted" value={gate.redacted} />
      <Row label="Unresolved high-risk" value={gate.unresolvedHighRisk} />
      <div style={{ height: 1, background: c.borderSoft, margin: '8px 0' }} />
      <Row label="Raw screenshot transmitted" value={<OkTag />} />
      <Row label="Raw DOM transmitted" value={<OkTag />} />
      <Row label="Raw PII transmitted" value={<OkTag />} />
      <div style={{ height: 1, background: c.borderSoft, margin: '8px 0' }} />
      <Row label="Sanitized screenshot" value={gate.sanitizedScreenshotReady ? 'READY' : '—'} />
      <Row label="Sanitized context" value={gate.sanitizedContextReady ? 'READY' : '—'} />
      <Row label="Verification" value={gate.verificationPassed ? 'PASSED' : 'PENDING'} />
      {metrics.sanitizedPayloadBytes !== undefined && (
        <Row label="Payload size" value={`${metrics.sanitizedPayloadBytes.toLocaleString()} bytes`} mono />
      )}
      <div style={{ display: 'flex', justifyContent: 'center', marginTop: 12 }}>
        <Pill tone={GATE_TONE[gate.status] ?? 'dim'} icon={<GateIcon size={13} strokeWidth={2.25} />}>
          {GATE_LABEL[gate.status] ?? gate.status}
        </Pill>
      </div>
      {gate.reasons.length > 0 && (
        <ul style={{ marginTop: 8, paddingLeft: 16, color: c.dim, fontSize: 11, lineHeight: 1.6 }}>
          {gate.reasons.map((r, i) => (
            <li key={i}>{r}</li>
          ))}
        </ul>
      )}
    </Card>
  );
}
