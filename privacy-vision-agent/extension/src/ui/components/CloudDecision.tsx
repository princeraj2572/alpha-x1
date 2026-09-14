import { useAgentStore } from '../state/agent-store';
import { Card, Row, Empty, c } from './primitives';

export function CloudDecision() {
  const { cloud, sent } = useAgentStore();
  if (!sent && cloud.status === 'idle') {
    return null;
  }
  return (
    <Card title="Cloud Reasoning">
      {cloud.status === 'idle' ? (
        <Empty>Not sent yet.</Empty>
      ) : (
        <>
          <Row label="Status" value={cloud.status} />
          <Row label="Model" value={cloud.model ? `${cloud.provider ?? ''} / ${cloud.model}` : cloud.provider ?? 'configured on backend'} />
          {cloud.actionType && <Row label="Action" value={cloud.actionType.toUpperCase()} />}
          {cloud.targetLabel && <Row label="Target" value={cloud.targetLabel} />}
          {cloud.confidence !== undefined && <Row label="Confidence" value={(cloud.confidence * 100).toFixed(0) + '%'} />}
          {cloud.note && <p style={{ fontSize: 11, color: c.dim, marginTop: 4 }}>{cloud.note}</p>}
          <p style={{ fontSize: 10, color: c.dim, marginTop: 6 }}>
            Only sanitized information is shown — raw PII never reaches the cloud.
          </p>
        </>
      )}
    </Card>
  );
}
