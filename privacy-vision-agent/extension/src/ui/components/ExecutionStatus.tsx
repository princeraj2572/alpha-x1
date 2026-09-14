import { CheckCircle2, XCircle } from 'lucide-react';
import { useAgentStore } from '../state/agent-store';
import { Card, Row, Empty, c } from './primitives';

export function ExecutionStatus() {
  const { execution: e } = useAgentStore();
  if (e.status === 'idle') {
    return null;
  }
  return (
    <Card title="Execution">
      {e.status === 'executing' ? (
        <Empty>Executing browser action…</Empty>
      ) : (
        <>
          <Row
            label="Result"
            value={
              <span style={{ color: e.success ? c.ok : c.bad, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                {e.success ? <CheckCircle2 size={13} strokeWidth={2.25} /> : <XCircle size={13} strokeWidth={2.25} />}
                {e.success ? 'executed' : 'failed'}
              </span>
            }
          />
          {e.executionTimeMs !== undefined && <Row label="Time" value={`${e.executionTimeMs.toFixed(0)} ms`} mono />}
          {e.error && <p style={{ fontSize: 11, color: c.bad, marginTop: 4 }}>{e.error}</p>}
        </>
      )}
    </Card>
  );
}
