import { Lock, ShieldCheck, Scan } from 'lucide-react';
import { useAgentStore, agentStore } from '../state/agent-store';
import { Card, c } from './primitives';
import { ScreenshotTabs } from './ScreenshotTabs';
import { ScreenshotPreview } from './ScreenshotPreview';
import { SplitScreenshotView } from './SplitScreenshotView';

export function ScreenshotInspector() {
  const {
    screenshotView,
    rawCapture,
    sanitizedScreenshot,
    findings,
    showDetectionRegions,
    selectedFindingKey,
    screenshotPhase,
  } = useAgentStore();

  const rawUrl = rawCapture?.dataUrl ?? null;
  const sanUrl = sanitizedScreenshot?.dataUrl ?? null;

  return (
    <Card
      title="Screen Inspection"
      right={
        <button
          onClick={() => agentStore.toggleDetectionRegions()}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 5,
            fontSize: 10,
            fontWeight: 600,
            padding: '4px 9px',
            borderRadius: 999,
            border: `1px solid ${showDetectionRegions ? c.accent : c.border}`,
            background: showDetectionRegions ? c.accentSoft : 'transparent',
            color: showDetectionRegions ? c.accent2 : c.dim,
            cursor: 'pointer',
            transition: 'all 120ms ease',
          }}
        >
          <Scan size={11} strokeWidth={2.25} />
          {showDetectionRegions ? 'Hide' : 'Show'} Detection Regions
        </button>
      }
    >
      <ScreenshotTabs
        view={screenshotView}
        onChange={(v) => agentStore.setScreenshotView(v)}
        disabledRaw={!rawUrl}
      />

      {screenshotView === 'RAW' && (
        <ScreenshotPreview
          dataUrl={rawUrl}
          naturalWidth={rawCapture?.width ?? 0}
          naturalHeight={rawCapture?.height ?? 0}
          overlayFindings={showDetectionRegions ? findings : undefined}
          selectedKey={selectedFindingKey}
          banner={
            <div
              style={{
                background: c.badSoft,
                border: `1px solid ${c.bad}`,
                borderRadius: c.radiusSm,
                padding: '8px 10px',
                marginBottom: 8,
                fontSize: 11,
              }}
            >
              <strong style={{ color: c.bad, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <Lock size={12} strokeWidth={2.5} /> RAW SCREENSHOT — LOCAL ONLY
              </strong>
              <div style={{ color: c.dim, marginTop: 3 }}>
                This screenshot exists only on this device. It is NOT eligible for cloud transmission.
              </div>
            </div>
          }
        />
      )}

      {screenshotView === 'SANITIZED' && (
        <ScreenshotPreview
          dataUrl={sanUrl}
          naturalWidth={sanitizedScreenshot?.width ?? 0}
          naturalHeight={sanitizedScreenshot?.height ?? 0}
          overlayFindings={showDetectionRegions ? findings : undefined}
          selectedKey={selectedFindingKey}
          banner={
            <div
              style={{
                background: c.okSoft,
                border: `1px solid ${c.ok}`,
                borderRadius: c.radiusSm,
                padding: '8px 10px',
                marginBottom: 8,
                fontSize: 11,
              }}
            >
              <strong style={{ color: c.ok, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <ShieldCheck size={12} strokeWidth={2.5} /> SANITIZED SCREENSHOT — CLOUD ELIGIBLE
              </strong>
              <div style={{ color: c.dim, marginTop: 3 }}>
                This is the exact image that will be transmitted. {screenshotPhase === 'sanitizing' && '(processing…)'}
              </div>
            </div>
          }
        />
      )}

      {screenshotView === 'SPLIT' && (
        <SplitScreenshotView
          rawUrl={rawUrl}
          rawW={rawCapture?.width ?? 0}
          rawH={rawCapture?.height ?? 0}
          sanitizedUrl={sanUrl}
          sanW={sanitizedScreenshot?.width ?? 0}
          sanH={sanitizedScreenshot?.height ?? 0}
          overlayFindings={findings}
          selectedKey={selectedFindingKey}
          showRegions={showDetectionRegions}
        />
      )}
    </Card>
  );
}
