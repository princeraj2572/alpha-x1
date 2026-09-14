import { useAgentStore } from '../state/agent-store';
import { Card, Empty, c } from './primitives';

const KIND_COLOR: Record<string, string> = {
  capture: c.accent,
  detect: c.accent,
  redact: c.accent,
  verify: c.ok,
  user: c.warn,
  network: c.accent,
  cloud: c.accent,
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
        <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 2, maxHeight: 200, overflowY: 'auto', fontSize: 11 }}>
          {timeline.map((e, i) => (
            <li key={i} style={{ display: 'flex', gap: 8 }}>
              <span style={{ color: c.dim, fontFamily: 'ui-monospace, monospace' }}>{fmt(e.at)}</span>
              <span style={{ color: KIND_COLOR[e.kind] ?? c.text }}>●</span>
              <span>{e.label}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
