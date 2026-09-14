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

export function AgentStatus() {
  const { status, privacyMode, backendConnected, error } = useAgentStore();
  return (
    <Card title="Agent Status">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'space-between' }}>
        <Pill tone={TONE[status] ?? 'dim'}>{LABEL[status] ?? status}</Pill>
        <span style={{ fontSize: 11, color: c.dim }}>
          mode: <strong style={{ color: c.text }}>{privacyMode}</strong>
        </span>
        <span style={{ fontSize: 11, color: backendConnected ? c.ok : c.dim }}>
          {backendConnected ? '● backend' : '○ backend offline'}
        </span>
      </div>
      {error && <p style={{ color: c.bad, fontSize: 11, marginTop: 6 }}>{error}</p>}
    </Card>
  );
}
