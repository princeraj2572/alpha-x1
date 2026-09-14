import { useAgentStore } from '../state/agent-store';
import { Card, StatusGlyph, c } from './primitives';

const NICE: Record<string, string> = {
  SCREEN_CAPTURE: 'Screen Capture',
  DOM_ANALYSIS: 'DOM Analysis',
  PII_DETECTION: 'PII Detection',
  VISION_DETECTION: 'Vision Detection',
  PRIVACY_FUSION: 'Privacy Fusion',
  REDACTION: 'Redaction',
  PRIVACY_VERIFICATION: 'Privacy Verification',
  USER_REVIEW: 'User Review',
  TRANSMISSION: 'Cloud Transmission',
  CLOUD_REASONING: 'Cloud Reasoning',
  ACTION_VALIDATION: 'Action Validation',
  EXECUTION: 'Execution',
};

export function ProcessingPipeline() {
  const { stages } = useAgentStore();
  return (
    <Card title="Processing Pipeline">
      <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 2 }}>
        {stages.map((s) => (
          <li key={s.id} style={{ display: 'flex', alignItems: 'baseline', gap: 8, fontSize: 12, padding: '2px 0' }}>
            <StatusGlyph status={s.status} />
            <span style={{ flex: 1, color: s.status === 'pending' ? c.dim : c.text }}>{NICE[s.id] ?? s.id}</span>
            {s.detail && <span style={{ color: c.dim, fontSize: 11, textAlign: 'right' }}>{s.detail}</span>}
            {s.durationMs !== undefined && (
              <span style={{ color: c.dim, fontSize: 10, minWidth: 44, textAlign: 'right' }}>{s.durationMs.toFixed(0)} ms</span>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}
