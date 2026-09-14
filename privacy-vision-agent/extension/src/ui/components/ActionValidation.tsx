import { Check as CheckIcon, X as XIcon, CheckCircle2, XCircle } from 'lucide-react';
import { useAgentStore } from '../state/agent-store';
import { Card, Empty, c } from './primitives';

function Check({ label, value }: { label: string; value?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12, padding: '3px 0' }}>
      <span style={{ color: c.dim }}>{label}</span>
      <span style={{ display: 'inline-flex', color: value === undefined ? c.dim : value ? c.ok : c.bad }}>
        {value === undefined ? '—' : value ? <CheckIcon size={13} strokeWidth={3} /> : <XIcon size={13} strokeWidth={3} />}
      </span>
    </div>
  );
}

export function ActionValidation() {
  const { actionValidation: v } = useAgentStore();
  if (v.status === 'idle') {
    return null;
  }
  return (
    <Card title="Local Action Validation">
      {v.actionSummary && <p style={{ fontSize: 12, marginBottom: 6 }}>Action requested: <strong>{v.actionSummary}</strong></p>}
      {Object.keys(v.checks).length === 0 && v.status === 'checking' ? (
        <Empty>Validating…</Empty>
      ) : (
        <>
          <Check label="Target exists" value={v.checks.targetExists} />
          <Check label="Target visible" value={v.checks.targetVisible} />
          <Check label="Page state valid" value={v.checks.pageStateValid} />
          <Check label="Action allowed" value={v.checks.actionAllowed} />
          <Check label="Schema valid" value={v.checks.schemaValid} />
        </>
      )}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 6,
          marginTop: 10,
          fontWeight: 700,
          fontSize: 13,
          color: v.status === 'approved' ? c.ok : v.status === 'blocked' || v.status === 'error' ? c.bad : c.dim,
        }}
      >
        {v.status === 'approved' && (
          <>
            <CheckCircle2 size={15} strokeWidth={2.25} /> APPROVED
          </>
        )}
        {v.status === 'blocked' && (
          <>
            <XCircle size={15} strokeWidth={2.25} /> BLOCKED
          </>
        )}
        {v.status === 'checking' && 'checking…'}
        {v.status === 'error' && (
          <>
            <XCircle size={15} strokeWidth={2.25} /> ERROR
          </>
        )}
      </div>
      {v.reason && <p style={{ fontSize: 11, color: c.dim, marginTop: 6 }}>Reason: {v.reason}</p>}
    </Card>
  );
}
