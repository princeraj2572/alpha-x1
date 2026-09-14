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
    <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
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
              letterSpacing: 0.5,
              borderRadius: 6,
              cursor: disabled ? 'not-allowed' : 'pointer',
              border: `1px solid ${active ? c.accent : c.border}`,
              background: active ? c.accent : 'transparent',
              color: active ? '#fff' : disabled ? c.dim : c.text,
              opacity: disabled ? 0.4 : 1,
            }}
          >
            {v}
          </button>
        );
      })}
    </div>
  );
}
