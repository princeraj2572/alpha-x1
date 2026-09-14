import { ScreenshotView } from '../state/types';
import { c } from './primitives';

const VIEWS: ScreenshotView[] = ['RAW', 'SANITIZED', 'SPLIT'];

export function ScreenshotTabs({
  view,
  onChange,
  disabledRaw,
}: {
  view: ScreenshotView;
  onChange: (v: ScreenshotView) => void;
  disabledRaw?: boolean;
}) {
  return (
    <div
      style={{
        display: 'flex',
        gap: 3,
        marginBottom: 10,
        background: c.panel2,
        border: `1px solid ${c.borderSoft}`,
        borderRadius: c.radiusSm,
        padding: 3,
      }}
    >
      {VIEWS.map((v) => {
        const active = v === view;
        const disabled = v === 'RAW' && disabledRaw;
        return (
          <button
            key={v}
            onClick={() => !disabled && onChange(v)}
            disabled={disabled}
            style={{
              flex: 1,
              padding: '6px 4px',
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: 0.4,
              borderRadius: 6,
              cursor: disabled ? 'not-allowed' : 'pointer',
              border: 'none',
              background: active ? c.panel : 'transparent',
              boxShadow: active ? c.shadowSm : 'none',
              color: active ? c.text : disabled ? c.dim : c.text,
              opacity: disabled ? 0.4 : active ? 1 : 0.72,
              transition: 'all 140ms ease',
            }}
          >
            {v}
          </button>
        );
      })}
    </div>
  );
}
