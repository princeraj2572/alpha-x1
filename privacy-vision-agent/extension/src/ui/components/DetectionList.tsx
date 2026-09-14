import { useAgentStore, agentStore } from '../state/agent-store';
import { Card, Empty, c } from './primitives';

/**
 * Findings list. Clicking a finding selects it, switches to the screenshot view
 * that can show its region, and enables the overlay. The secret value is never
 * shown — only type / source / confidence / detail.
 */
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
        <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 260, overflowY: 'auto' }}>
          {findings.map((f) => {
            const selected = f.key === selectedFindingKey;
            const hasRegion = Boolean(f.bbox);
            return (
              <li key={f.key}>
                <button
                  onClick={() => onClick(f.key, hasRegion)}
                  style={{
                    width: '100%',
                    textAlign: 'left',
                    background: selected ? c.accent : c.panel2,
                    color: selected ? '#fff' : c.text,
                    border: `1px solid ${selected ? c.accent : c.border}`,
                    borderRadius: 8,
                    padding: '6px 8px',
                    cursor: 'pointer',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, fontWeight: 700 }}>
                    <span>{f.type.replace(/_/g, ' ')}</span>
                    <span>{(f.confidence * 100).toFixed(0)}%</span>
                  </div>
                  <div style={{ fontSize: 10, opacity: 0.8, display: 'flex', gap: 8 }}>
                    <span>source: {f.source}</span>
                    {hasRegion ? <span>· has region</span> : <span>· no region</span>}
                    {f.elementId && <span>· #{f.elementId}</span>}
                  </div>
                  {selected && f.detail && <div style={{ fontSize: 10, marginTop: 4, opacity: 0.9 }}>{f.detail}</div>}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
