import type { ReactNode, CSSProperties } from 'react';
import { StageStatus } from '../state/types';

export const c = {
  panel: 'var(--panel)',
  panel2: 'var(--panel-2)',
  border: 'var(--border)',
  text: 'var(--text)',
  dim: 'var(--text-dim)',
  ok: 'var(--ok)',
  warn: 'var(--warn)',
  bad: 'var(--bad)',
  accent: 'var(--accent)',
};

export function Card({ title, right, children }: { title?: string; right?: ReactNode; children: ReactNode }) {
  return (
    <section
      style={{
        background: c.panel,
        border: `1px solid ${c.border}`,
        borderRadius: 10,
        margin: '8px',
        padding: '10px 12px',
      }}
    >
      {title && (
        <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <h2 style={{ fontSize: 11, letterSpacing: 0.6, textTransform: 'uppercase', color: c.dim, fontWeight: 700 }}>{title}</h2>
          {right}
        </header>
      )}
      {children}
    </section>
  );
}

export function Row({ label, value, mono }: { label: string; value: ReactNode; mono?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '3px 0', fontSize: 12 }}>
      <span style={{ color: c.dim }}>{label}</span>
      <span style={{ fontFamily: mono ? 'ui-monospace, monospace' : 'inherit', textAlign: 'right', fontWeight: 500 }}>{value}</span>
    </div>
  );
}

const STAGE_COLOR: Record<StageStatus, string> = {
  pending: c.dim,
  running: c.accent,
  success: c.ok,
  warning: c.warn,
  blocked: c.bad,
  error: c.bad,
};

const STAGE_GLYPH: Record<StageStatus, string> = {
  pending: '○',
  running: '◐',
  success: '●',
  warning: '▲',
  blocked: '■',
  error: '✕',
};

export function StatusGlyph({ status }: { status: StageStatus }) {
  return (
    <span
      aria-label={status}
      style={{ color: STAGE_COLOR[status], fontSize: 11, width: 14, display: 'inline-block', textAlign: 'center' }}
    >
      {STAGE_GLYPH[status]}
    </span>
  );
}

export function Pill({ tone, children }: { tone: 'ok' | 'warn' | 'bad' | 'accent' | 'dim'; children: ReactNode }) {
  const bg = { ok: c.ok, warn: c.warn, bad: c.bad, accent: c.accent, dim: c.dim }[tone];
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '2px 8px',
        borderRadius: 999,
        fontSize: 11,
        fontWeight: 700,
        color: '#0b1220',
        background: bg,
      }}
    >
      {children}
    </span>
  );
}

export function Button({
  onClick,
  disabled,
  tone = 'default',
  title,
  children,
}: {
  onClick?: () => void;
  disabled?: boolean;
  tone?: 'default' | 'primary' | 'danger' | 'ghost';
  title?: string;
  children: ReactNode;
}) {
  const styles: Record<string, CSSProperties> = {
    default: { background: c.panel2, color: c.text, border: `1px solid ${c.border}` },
    primary: { background: c.accent, color: '#fff', border: `1px solid ${c.accent}` },
    danger: { background: c.bad, color: '#fff', border: `1px solid ${c.bad}` },
    ghost: { background: 'transparent', color: c.dim, border: `1px solid ${c.border}` },
  };
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={{
        ...styles[tone],
        width: '100%',
        padding: '9px 12px',
        borderRadius: 8,
        fontSize: 12,
        fontWeight: 700,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.45 : 1,
        marginTop: 6,
      }}
    >
      {children}
    </button>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p style={{ color: c.dim, fontSize: 12, fontStyle: 'italic', padding: '6px 0' }}>{children}</p>;
}
