import { UiFinding } from '../state/types';
import { ScreenshotPreview } from './ScreenshotPreview';
import { c } from './primitives';

/**
 * RAW (local only) beside SANITIZED (cloud eligible). Stacks vertically on a
 * narrow panel.
 */
export function SplitScreenshotView({
  rawUrl,
  rawW,
  rawH,
  sanitizedUrl,
  sanW,
  sanH,
  overlayFindings,
  selectedKey,
  showRegions,
}: {
  rawUrl: string | null;
  rawW: number;
  rawH: number;
  sanitizedUrl: string | null;
  sanW: number;
  sanH: number;
  overlayFindings: UiFinding[];
  selectedKey: string | null;
  showRegions: boolean;
}) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
        gap: 8,
      }}
    >
      <div>
        <SideLabel tone="bad" title="RAW" subtitle="LOCAL ONLY" />
        <ScreenshotPreview dataUrl={rawUrl} naturalWidth={rawW} naturalHeight={rawH} label="Raw" />
      </div>
      <div>
        <SideLabel tone="ok" title="SANITIZED" subtitle="CLOUD ELIGIBLE" />
        <ScreenshotPreview
          dataUrl={sanitizedUrl}
          naturalWidth={sanW}
          naturalHeight={sanH}
          overlayFindings={showRegions ? overlayFindings : undefined}
          selectedKey={selectedKey}
          label="Sanitized"
        />
      </div>
    </div>
  );
}

function SideLabel({ tone, title, subtitle }: { tone: 'ok' | 'bad'; title: string; subtitle: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 4 }}>
      <strong style={{ fontSize: 11, color: tone === 'ok' ? c.ok : c.bad }}>{title}</strong>
      <span style={{ fontSize: 9, color: c.dim, letterSpacing: 0.5 }}>{subtitle}</span>
    </div>
  );
}
