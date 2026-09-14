import { useAgentStore } from '../state/agent-store';
import { Card, Empty, c } from './primitives';

const ICON: Record<string, string> = {
  PERSON: '👤',
  EMAIL: '✉',
  PHONE: '📞',
  PASSWORD: '🔒',
  CREDIT_CARD: '💳',
  CARD_EXPIRY: '📅',
  CARD_CVV: '🔑',
  AADHAAR_LIKE_ID: '🆔',
  PAN_LIKE_ID: '🆔',
  UPI_ID: '🏦',
  ACCOUNT_NUMBER: '🏦',
  ADDRESS: '🏠',
  IP_ADDRESS: '🌐',
  FACE: '🙂',
  DOCUMENT: '📄',
  OTHER_SENSITIVE: '⚠',
};

export function DetectionSummary() {
  const { detectionCounts } = useAgentStore();
  const entries = Object.entries(detectionCounts).sort((a, b) => b[1] - a[1]);
  return (
    <Card title="Detection Summary">
      {entries.length === 0 ? (
        <Empty>No detections yet — run an inspection.</Empty>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 6 }}>
          {entries.map(([type, count]) => (
            <div
              key={type}
              style={{
                background: c.panel2,
                borderRadius: 8,
                padding: '6px 8px',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
              }}
            >
              <span style={{ fontSize: 15 }}>{ICON[type] ?? '•'}</span>
              <span style={{ flex: 1, fontSize: 11, color: c.dim }}>{type.replace(/_/g, ' ').toLowerCase()}</span>
              <strong style={{ fontSize: 14 }}>{count}</strong>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
