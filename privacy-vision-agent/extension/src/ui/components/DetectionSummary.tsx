import { useState } from 'react';
import {
  User,
  Mail,
  Phone,
  Lock,
  CreditCard,
  Calendar,
  KeyRound,
  IdCard,
  Landmark,
  Home,
  Globe,
  ScanFace,
  FileText,
  AlertTriangle,
  CircleHelp,
  type LucideIcon,
} from 'lucide-react';
import { useAgentStore } from '../state/agent-store';
import { Card, Empty, c } from './primitives';

const ICON: Record<string, LucideIcon> = {
  PERSON: User,
  EMAIL: Mail,
  PHONE: Phone,
  PASSWORD: Lock,
  CREDIT_CARD: CreditCard,
  CARD_EXPIRY: Calendar,
  CARD_CVV: KeyRound,
  AADHAAR_LIKE_ID: IdCard,
  PAN_LIKE_ID: IdCard,
  UPI_ID: Landmark,
  ACCOUNT_NUMBER: Landmark,
  ADDRESS: Home,
  IP_ADDRESS: Globe,
  FACE: ScanFace,
  DOCUMENT: FileText,
  OTHER_SENSITIVE: AlertTriangle,
};

function DetectionTile({ type, count }: { type: string; count: number }) {
  const [hover, setHover] = useState(false);
  const Icon = ICON[type] ?? CircleHelp;
  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        background: hover ? c.panelHover : c.panel2,
        border: `1px solid ${c.borderSoft}`,
        borderRadius: c.radiusSm,
        padding: '8px 10px',
        display: 'flex',
        alignItems: 'center',
        gap: 9,
        transition: 'background-color 120ms ease, transform 120ms ease',
        transform: hover ? 'translateY(-1px)' : 'none',
      }}
    >
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 26,
          height: 26,
          borderRadius: 8,
          background: c.accentSoft,
          color: c.accent2,
          flexShrink: 0,
        }}
      >
        <Icon size={14} strokeWidth={2} />
      </span>
      <span style={{ flex: 1, fontSize: 11, color: c.dim, textTransform: 'capitalize' }}>
        {type.replace(/_/g, ' ').toLowerCase()}
      </span>
      <strong style={{ fontSize: 14 }}>{count}</strong>
    </div>
  );
}

export function DetectionSummary() {
  const { detectionCounts } = useAgentStore();
  const entries = Object.entries(detectionCounts).sort((a, b) => b[1] - a[1]);
  return (
    <Card title="Detection Summary">
      {entries.length === 0 ? (
        <Empty>No detections yet — run an inspection.</Empty>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 8 }}>
          {entries.map(([type, count]) => (
            <DetectionTile key={type} type={type} count={count} />
          ))}
        </div>
      )}
    </Card>
  );
}
