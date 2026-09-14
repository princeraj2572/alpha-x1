import { useAgentStore } from '../state/agent-store';
import { Empty, c } from './primitives';

/**
 * Shows the EXACT structured object that will be transmitted. This is the same
 * `outboundContext` object handed to the messaging layer — there is no
 * separate UI-only copy.
 */
export function SanitizedContextViewer() {
  const { outboundContext } = useAgentStore();
  if (!outboundContext) {
    return <Empty>No sanitized context built yet.</Empty>;
  }
  // Show it without the (large) screenshot data URL — replace with a marker.
  const display = {
    ...outboundContext,
    sanitizedScreenshot: outboundContext.sanitizedScreenshot
      ? {
          width: outboundContext.sanitizedScreenshot.width,
          height: outboundContext.sanitizedScreenshot.height,
          sha256: outboundContext.sanitizedScreenshot.sha256,
          dataUrl: '<sanitized PNG, ' + outboundContext.sanitizedScreenshot.dataUrl.length + ' chars>',
        }
      : null,
  };
  return (
    <pre
      style={{
        background: '#0b1220',
        color: '#c7d2fe',
        fontSize: 10.5,
        fontFamily: 'ui-monospace, monospace',
        padding: 10,
        borderRadius: 8,
        border: `1px solid ${c.border}`,
        maxHeight: 260,
        overflow: 'auto',
        marginTop: 6,
      }}
    >
      {JSON.stringify(display, null, 2)}
    </pre>
  );
}
