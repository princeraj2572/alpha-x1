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
  safe: '🟢 SAFE TO SEND',
  warning: '🟡 SEND WITH CAUTION',
  blocked: '🔴 BLOCKED',
  error: '🔴 ERROR',
  idle: '⚪ NOT READY',
};

export function PrivacyGate() {
  const { gate, metrics } = useAgentStore();
  return (
    <Card title="Privacy Gate">
      <Row label="Sensitive findings" value={gate.sensitiveFindings} />
      <Row label="Redacted" value={gate.redacted} />
      <Row label="Unresolved high-risk" value={gate.unresolvedHighRisk} />
      <div style={{ height: 1, background: c.border, margin: '6px 0' }} />
      <Row label="Raw screenshot transmitted" value={<span style={{ color: c.ok }}>NO</span>} />
      <Row label="Raw DOM transmitted" value={<span style={{ color: c.ok }}>NO</span>} />
      <Row label="Raw PII transmitted" value={<span style={{ color: c.ok }}>NO</span>} />
      <div style={{ height: 1, background: c.border, margin: '6px 0' }} />
      <Row
        label="Sanitized screenshot"
        value={gate.sanitizedScreenshotReady ? 'READY' : '—'}
      />
      <Row label="Sanitized context" value={gate.sanitizedContextReady ? 'READY' : '—'} />
      <Row label="Verification" value={gate.verificationPassed ? 'PASSED' : 'PENDING'} />
      {metrics.sanitizedPayloadBytes !== undefined && (
        <Row label="Payload size" value={`${metrics.sanitizedPayloadBytes.toLocaleString()} bytes`} mono />
      )}
      <div style={{ textAlign: 'center', marginTop: 10 }}>
        <Pill tone={GATE_TONE[gate.status] ?? 'dim'}>{GATE_LABEL[gate.status] ?? gate.status}</Pill>
      </div>
      {gate.reasons.length > 0 && (
        <ul style={{ marginTop: 6, paddingLeft: 16, color: c.dim, fontSize: 11 }}>
          {gate.reasons.map((r, i) => (
            <li key={i}>{r}</li>
          ))}
        </ul>
      )}
    </Card>
  );
}
