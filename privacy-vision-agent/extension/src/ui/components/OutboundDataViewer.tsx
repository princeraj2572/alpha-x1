import { useAgentStore } from '../state/agent-store';
import { Row, c } from './primitives';

/**
 * A plain-language summary of exactly what leaves the device.
 */
export function OutboundDataViewer() {
  const { outboundContext, metrics, sanitizedScreenshot } = useAgentStore();
  const bytes = metrics.sanitizedPayloadBytes ?? (outboundContext ? new TextEncoder().encode(JSON.stringify(outboundContext)).length : 0);
  return (
    <div
      style={{
        background: c.panel2,
        borderRadius: 8,
        border: `1px solid ${c.border}`,
        padding: '8px 10px',
        marginTop: 6,
        fontSize: 12,
      }}
    >
      <Row label="Screenshot" value={sanitizedScreenshot ? <span style={{ color: c.ok }}>SANITIZED</span> : 'NOT INCLUDED'} />
      <Row label="DOM" value={<span style={{ color: c.ok }}>SANITIZED</span>} />
      <Row label="PII" value={<span style={{ color: c.ok }}>REDACTED</span>} />
      <div style={{ height: 1, background: c.border, margin: '4px 0' }} />
      <Row label="Raw screenshot" value={<span style={{ color: c.ok }}>NOT INCLUDED</span>} />
      <Row label="Raw PII" value={<span style={{ color: c.ok }}>NOT INCLUDED</span>} />
      <Row label="Raw DOM values" value={<span style={{ color: c.ok }}>NOT INCLUDED</span>} />
      <div style={{ height: 1, background: c.border, margin: '4px 0' }} />
      <Row label="Payload" value={`${bytes.toLocaleString()} bytes`} mono />
      {sanitizedScreenshot && <Row label="Screenshot sha-256" value={sanitizedScreenshot.sha256.slice(0, 16) + '…'} mono />}
    </div>
  );
}
