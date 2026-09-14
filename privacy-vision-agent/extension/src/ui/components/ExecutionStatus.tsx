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
              <span style={{ color: e.success ? c.ok : c.bad }}>
                {e.success ? '🟢 executed' : '🔴 failed'}
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
