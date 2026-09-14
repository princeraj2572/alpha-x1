import { useAgentStore } from '../state/agent-store';
import { Card, Empty, c } from './primitives';

const KIND_COLOR: Record<string, string> = {
  capture: c.accent2,
  detect: c.accent2,
  redact: c.accent2,
  verify: c.ok,
  user: c.warn,
  network: c.accent2,
  cloud: c.accent2,
  validate: c.ok,
  execute: c.ok,
  error: c.bad,
};

function fmt(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour12: false }) + '.' + String(d.getMilliseconds()).padStart(3, '0');
}

export function SessionTimeline() {
  const { timeline } = useAgentStore();
  return (
    <Card title="Session Timeline">
      {timeline.length === 0 ? (
        <Empty>No events yet.</Empty>
      ) : (
        <ul
          style={{
            listStyle: 'none',
            display: 'flex',
            flexDirection: 'column',
            maxHeight: 220,
            overflowY: 'auto',
            fontSize: 11,
            position: 'relative',
          }}
        >
          {timeline.map((e, i) => (
            <li key={i} style={{ display: 'flex', gap: 10, padding: '3px 0', position: 'relative' }}>
              <span
                style={{
                  color: c.dim,
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                  fontSize: 10,
                  paddingTop: 1,
                  flexShrink: 0,
                }}
              >
                {fmt(e.at)}
              </span>
              <span style={{ position: 'relative', width: 8, display: 'flex', justifyContent: 'center', flexShrink: 0 }}>
                {i < timeline.length - 1 && (
                  <span
                    style={{
                      position: 'absolute',
                      top: 10,
                      bottom: -3,
                      width: 1,
                      background: c.borderSoft,
                    }}
                  />
                )}
                <span
                  style={{
                    width: 7,
                    height: 7,
                    borderRadius: '50%',
                    background: KIND_COLOR[e.kind] ?? c.dim,
                    marginTop: 3,
                    flexShrink: 0,
                  }}
                />
              </span>
              <span>{e.label}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
