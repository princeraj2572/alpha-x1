import { UiFinding } from '../state/types';
import { c } from './primitives';

/**
 * Draws the ACTUAL detected regions over a rendered screenshot. Coordinates
 * come straight from the findings (screenshot pixel space) and are scaled to
 * the rendered `<img>` size — none are invented.
 */
export function DetectionOverlay({
  findings,
  naturalWidth,
  naturalHeight,
  renderedWidth,
  renderedHeight,
  selectedKey,
}: {
  findings: UiFinding[];
  naturalWidth: number;
  naturalHeight: number;
  renderedWidth: number;
  renderedHeight: number;
  selectedKey: string | null;
}) {
  if (!naturalWidth || !naturalHeight) {
    return null;
  }
  const sx = renderedWidth / naturalWidth;
  const sy = renderedHeight / naturalHeight;

  return (
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
      {findings
        .filter((f) => f.bbox)
        .map((f) => {
          const b = f.bbox!;
          const selected = f.key === selectedKey;
          return (
            <div
              key={f.key}
              style={{
                position: 'absolute',
                left: b.x * sx,
                top: b.y * sy,
                width: Math.max(6, b.width * sx),
                height: Math.max(6, b.height * sy),
                border: `2px solid ${selected ? c.accent : c.warn}`,
                background: selected ? 'rgba(99,102,241,0.15)' : 'rgba(245,158,11,0.10)',
                borderRadius: 3,
              }}
            >
              <span
                style={{
                  position: 'absolute',
                  top: -0,
                  left: 0,
                  transform: 'translateY(-100%)',
                  background: selected ? c.accent : c.warn,
                  color: '#0b1220',
                  fontSize: 9,
                  fontWeight: 700,
                  padding: '1px 4px',
                  borderRadius: 3,
                  whiteSpace: 'nowrap',
                  lineHeight: 1.3,
                }}
              >
                {f.type} · {f.source} · {(f.confidence * 100).toFixed(0)}%
              </span>
            </div>
          );
        })}
    </div>
  );
}
