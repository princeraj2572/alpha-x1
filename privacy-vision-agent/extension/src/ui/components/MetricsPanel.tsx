import { useAgentStore } from '../state/agent-store';
import { Card, Row, Empty } from './primitives';

function ms(v?: number): string {
  return v === undefined ? '—' : `${v.toFixed(v < 10 ? 1 : 0)} ms`;
}

export function MetricsPanel() {
  const { metrics: m } = useAgentStore();
  const any = Object.values(m).some((v) => v !== undefined);
  return (
    <Card title="Performance Metrics">
      {!any ? (
        <Empty>Measured during an inspection run.</Empty>
      ) : (
        <>
          <Row label="DOM analysis" value={ms(m.domAnalysisMs)} mono />
          <Row label="PII detection" value={ms(m.piiDetectionMs)} mono />
          <Row label="Vision inference" value={ms(m.visionInferenceMs)} mono />
          <Row label="Fusion" value={ms(m.fusionMs)} mono />
          <Row label="Redaction" value={ms(m.redactionMs)} mono />
          <Row label="Sanitized payload" value={m.sanitizedPayloadBytes ? `${m.sanitizedPayloadBytes.toLocaleString()} B` : '—'} mono />
          <Row label="Network latency" value={ms(m.networkLatencyMs)} mono />
          <Row label="Cloud latency" value={ms(m.cloudLatencyMs)} mono />
          <Row label="Total latency" value={ms(m.totalLatencyMs)} mono />
        </>
      )}
    </Card>
  );
}
