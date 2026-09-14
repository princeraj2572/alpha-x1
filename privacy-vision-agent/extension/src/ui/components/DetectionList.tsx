import { useState } from 'react';
import { MapPin } from 'lucide-react';
import { useAgentStore, agentStore } from '../state/agent-store';
import { Card, Empty, c } from './primitives';
import type { UiFinding } from '../state/types';

/**
 * Findings list. Clicking a finding selects it, switches to the screenshot view
 * that can show its region, and enables the overlay. The secret value is never
 * shown — only type / source / confidence / detail.
 */

function confidenceColor(v: number): string {
  if (v >= 0.75) return c.ok;
  if (v >= 0.5) return c.warn;
  return c.bad;
}

function FindingRow({
  f,
  selected,
  onClick,
}: {
  f: UiFinding;
  selected: boolean;
  onClick: () => void;
}) {
  const [hover, setHover] = useState(false);
  const hasRegion = Boolean(f.bbox);
  const pct = f.confidence * 100;

  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        width: '100%',
        textAlign: 'left',
        background: selected ? c.accent : hover ? c.panelHover : c.panel2,
        color: selected ? '#fff' : c.text,
        border: `1px solid ${selected ? c.accent : c.borderSoft}`,
        borderRadius: c.radiusSm,
        padding: '8px 10px',
        cursor: 'pointer',
        transition: 'background-color 120ms ease, transform 120ms ease',
        transform: hover && !selected ? 'translateX(1px)' : 'none',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ flex: 1, fontSize: 12, fontWeight: 700 }}>{f.type.replace(/_/g, ' ')}</span>
        <span
          style={{
            fontSize: 10,
            fontWeight: 700,
            padding: '1px 6px',
            borderRadius: 999,
            color: selected ? '#fff' : confidenceColor(f.confidence),
            background: selected ? 'rgba(255,255,255,0.16)' : 'transparent',
            border: selected ? 'none' : `1px solid ${confidenceColor(f.confidence)}`,
          }}
        >
          {pct.toFixed(0)}%
        </span>
      </div>
      <div style={{ fontSize: 10, opacity: selected ? 0.85 : 0.65, display: 'flex', gap: 8, marginTop: 3, alignItems: 'center' }}>
        <span>source: {f.source}</span>
        {hasRegion && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
            <MapPin size={10} strokeWidth={2.25} /> region
          </span>
        )}
        {f.elementId && <span>#{f.elementId}</span>}
      </div>
      {selected && f.detail && <div style={{ fontSize: 10, marginTop: 5, opacity: 0.9 }}>{f.detail}</div>}
    </button>
  );
}

export function DetectionList() {
  const { findings, selectedFindingKey } = useAgentStore();

  const onClick = (key: string, hasRegion: boolean) => {
    agentStore.selectFinding(selectedFindingKey === key ? null : key);
    if (hasRegion) {
      agentStore.setScreenshotView('SANITIZED');
      agentStore.toggleDetectionRegions(true);
    }
  };

  return (
    <Card title={`Findings (${findings.length})`}>
      {findings.length === 0 ? (
        <Empty>Nothing detected yet.</Empty>
      ) : (
        <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 5, maxHeight: 260, overflowY: 'auto' }}>
          {findings.map((f) => (
            <li key={f.key}>
              <FindingRow
                f={f}
                selected={f.key === selectedFindingKey}
                onClick={() => onClick(f.key, Boolean(f.bbox))}
              />
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
