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
            fontSize: 10,
            padding: '3px 8px',
            borderRadius: 6,
            border: `1px solid ${c.border}`,
            background: showDetectionRegions ? c.accent : 'transparent',
            color: showDetectionRegions ? '#fff' : c.dim,
            cursor: 'pointer',
          }}
        >
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
                background: 'rgba(239,68,68,0.12)',
                border: `1px solid ${c.bad}`,
                borderRadius: 8,
                padding: '6px 8px',
                marginBottom: 6,
                fontSize: 11,
              }}
            >
              <strong style={{ color: c.bad }}>RAW SCREENSHOT — LOCAL ONLY</strong>
              <div style={{ color: c.dim, marginTop: 2 }}>
                🔒 This screenshot exists only on this device. It is NOT eligible for cloud transmission.
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
                background: 'rgba(34,197,94,0.10)',
                border: `1px solid ${c.ok}`,
                borderRadius: 8,
                padding: '6px 8px',
                marginBottom: 6,
                fontSize: 11,
              }}
            >
              <strong style={{ color: c.ok }}>SANITIZED SCREENSHOT — CLOUD ELIGIBLE</strong>
              <div style={{ color: c.dim, marginTop: 2 }}>
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
