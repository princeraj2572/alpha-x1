import { useState, type ReactNode, type CSSProperties } from 'react';
import { Circle, CheckCircle2, AlertTriangle, XCircle, Ban, Loader2, Inbox } from 'lucide-react';
import { StageStatus } from '../state/types';

export const c = {
  panel: 'var(--panel)',
  panel2: 'var(--panel-2)',
  panelHover: 'var(--panel-hover)',
  border: 'var(--border)',
  borderSoft: 'var(--border-soft)',
  text: 'var(--text)',
  dim: 'var(--text-dim)',
  ok: 'var(--ok)',
  okSoft: 'var(--ok-soft)',
  warn: 'var(--warn)',
  warnSoft: 'var(--warn-soft)',
  bad: 'var(--bad)',
  badSoft: 'var(--bad-soft)',
  accent: 'var(--accent)',
  accent2: 'var(--accent-2)',
  accentSoft: 'var(--accent-soft)',
  shadowSm: 'var(--shadow-sm)',
  shadowMd: 'var(--shadow-md)',
  radius: 'var(--radius)',
  radiusSm: 'var(--radius-sm)',
  blur: 'var(--blur)',
};

const glassStyle: CSSProperties = {
  backdropFilter: `blur(${c.blur})`,
  WebkitBackdropFilter: `blur(${c.blur})`,
};

export function Card({ title, right, children }: { title?: string; right?: ReactNode; children: ReactNode }) {
  return (
    <section
      style={{
        ...glassStyle,
        background: c.panel,
        border: `1px solid ${c.border}`,
        borderRadius: c.radius,
        boxShadow: c.shadowSm,
        margin: '10px',
        padding: '12px 14px',
        animation: 'fadeIn 0.25s ease-out',
      }}
    >
      {title && (
        <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <h2
            style={{
              fontSize: 11,
              letterSpacing: 0.7,
              textTransform: 'uppercase',
              color: c.dim,
              fontWeight: 700,
            }}
          >
            {title}
          </h2>
          {right}
        </header>
      )}
      {children}
    </section>
  );
}

export function Row({ label, value, mono }: { label: ReactNode; value: ReactNode; mono?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '4px 0', fontSize: 12 }}>
      <span style={{ color: c.dim }}>{label}</span>
      <span
        style={{
          fontFamily: mono ? 'ui-monospace, SFMono-Regular, Menlo, monospace' : 'inherit',
          textAlign: 'right',
          fontWeight: 500,
        }}
      >
        {value}
      </span>
    </div>
  );
}

const STAGE_COLOR: Record<StageStatus, string> = {
  pending: c.dim,
  running: c.accent2,
  success: c.ok,
  warning: c.warn,
  blocked: c.bad,
  error: c.bad,
};

const STAGE_ICON: Record<StageStatus, typeof Circle> = {
  pending: Circle,
  running: Loader2,
  success: CheckCircle2,
  warning: AlertTriangle,
  blocked: Ban,
  error: XCircle,
};

export function StatusGlyph({ status }: { status: StageStatus }) {
  const Icon = STAGE_ICON[status];
  return (
    <span
      aria-label={status}
      style={{
        color: STAGE_COLOR[status],
        width: 15,
        height: 15,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
      }}
    >
      <Icon
        size={status === 'pending' ? 9 : 14}
        strokeWidth={status === 'pending' ? 0 : 2.25}
        fill={status === 'pending' ? STAGE_COLOR[status] : 'none'}
        style={status === 'running' ? { animation: 'spin 0.9s linear infinite' } : undefined}
      />
    </span>
  );
}

export function Pill({
  tone,
  children,
  icon,
}: {
  tone: 'ok' | 'warn' | 'bad' | 'accent' | 'dim';
  children: ReactNode;
  icon?: ReactNode;
}) {
  const palette: Record<string, { bg: string; fg: string }> = {
    ok: { bg: c.okSoft, fg: c.ok },
    warn: { bg: c.warnSoft, fg: c.warn },
    bad: { bg: c.badSoft, fg: c.bad },
    accent: { bg: c.accentSoft, fg: c.accent2 },
    dim: { bg: c.panel2, fg: c.dim },
  };
  const { bg, fg } = palette[tone];
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '4px 11px',
        borderRadius: 999,
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: 0.2,
        color: fg,
        background: bg,
      }}
    >
      {icon}
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
  icon,
}: {
  onClick?: () => void;
  disabled?: boolean;
  tone?: 'default' | 'primary' | 'danger' | 'ghost';
  title?: string;
  children: ReactNode;
  icon?: ReactNode;
}) {
  const [hover, setHover] = useState(false);
  const [active, setActive] = useState(false);

  const base: Record<string, CSSProperties> = {
    default: { background: hover ? c.panelHover : c.panel2, color: c.text, border: `1px solid ${c.border}` },
    primary: {
      background: hover ? c.accent2 : c.accent,
      color: '#fff',
      border: `1px solid ${hover ? c.accent2 : c.accent}`,
      boxShadow: disabled ? 'none' : '0 2px 10px -2px rgba(99, 102, 241, 0.55)',
    },
    danger: {
      background: hover ? '#fb7185' : c.bad,
      color: '#fff',
      border: `1px solid ${hover ? '#fb7185' : c.bad}`,
    },
    ghost: { background: hover ? c.panel2 : 'transparent', color: c.dim, border: `1px solid ${c.border}` },
  };

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => {
        setHover(false);
        setActive(false);
      }}
      onMouseDown={() => setActive(true)}
      onMouseUp={() => setActive(false)}
      style={{
        ...base[tone],
        width: '100%',
        padding: '9px 12px',
        borderRadius: c.radiusSm,
        fontSize: 12,
        fontWeight: 700,
        letterSpacing: 0.15,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.45 : 1,
        marginTop: 6,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 7,
        transition: 'background-color 120ms ease, box-shadow 120ms ease, transform 80ms ease, border-color 120ms ease',
        transform: active && !disabled ? 'scale(0.985)' : 'scale(1)',
      }}
    >
      {icon}
      {children}
    </button>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 6,
        color: c.dim,
        fontSize: 12,
        padding: '14px 0',
      }}
    >
      <Inbox size={18} strokeWidth={1.5} style={{ opacity: 0.6 }} />
      <span>{children}</span>
    </div>
  );
}
