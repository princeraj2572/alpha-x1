import { useAgentStore } from '../state/agent-store';
import { Card, Pill, c } from './primitives';

const TONE: Record<string, 'ok' | 'warn' | 'bad' | 'accent' | 'dim'> = {
  ready: 'ok',
  processing: 'accent',
  waiting: 'warn',
  running: 'accent',
  stopped: 'bad',
  error: 'bad',
};

const LABEL: Record<string, string> = {
  ready: 'Ready',
  processing: 'Processing',
  waiting: 'Waiting for review',
  running: 'Running',
  stopped: 'Stopped',
  error: 'Error',
};

function ConnectionDot({ connected }: { connected: boolean }) {
  return (
    <span
      style={{
        width: 7,
        height: 7,
        borderRadius: '50%',
        background: connected ? c.ok : c.dim,
        boxShadow: connected ? `0 0 0 3px ${c.okSoft}` : 'none',
        animation: connected ? 'pulseSoft 2s ease-in-out infinite' : undefined,
        display: 'inline-block',
      }}
    />
  );
}

export function AgentStatus() {
  const { status, privacyMode, backendConnected, error } = useAgentStore();
  return (
    <Card title="Agent Status">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <Pill tone={TONE[status] ?? 'dim'}>{LABEL[status] ?? status}</Pill>
        <span style={{ fontSize: 11, color: c.dim }}>
          mode: <strong style={{ color: c.text }}>{privacyMode}</strong>
        </span>
        <span style={{ fontSize: 11, color: backendConnected ? c.ok : c.dim, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <ConnectionDot connected={backendConnected} />
          {backendConnected ? 'backend' : 'backend offline'}
        </span>
      </div>
      {error && <p style={{ color: c.bad, fontSize: 11, marginTop: 8 }}>{error}</p>}
    </Card>
  );
}
