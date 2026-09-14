import type { ReactNode } from 'react';
import { useLayoutEffect, useRef, useState } from 'react';
import { UiFinding } from '../state/types';
import { DetectionOverlay } from './DetectionOverlay';
import { c } from './primitives';

/**
 * Renders one screenshot (raw or sanitized) with an optional detection overlay.
 * A large screenshot scrolls inside its own box — it never blows out the panel.
 */
export function ScreenshotPreview({
  dataUrl,
  naturalWidth,
  naturalHeight,
  overlayFindings,
  selectedKey,
  banner,
}: {
  dataUrl: string | null;
  naturalWidth: number;
  naturalHeight: number;
  overlayFindings?: UiFinding[];
  selectedKey?: string | null;
  banner?: ReactNode;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const [rendered, setRendered] = useState({ w: 0, h: 0 });

  useLayoutEffect(() => {
    const measure = () => {
      if (imgRef.current) {
        setRendered({ w: imgRef.current.clientWidth, h: imgRef.current.clientHeight });
      }
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (imgRef.current) {
      ro.observe(imgRef.current);
    }
    return () => ro.disconnect();
  }, [dataUrl]);

  if (!dataUrl) {
    return (
      <div
        style={{
          border: `1px dashed ${c.border}`,
          borderRadius: 8,
          padding: 24,
          textAlign: 'center',
          color: c.dim,
          fontSize: 12,
        }}
      >
        No screenshot yet.
      </div>
    );
  }

  return (
    <div>
      {banner}
      <div
        ref={wrapRef}
        style={{
          position: 'relative',
          maxHeight: 340,
          overflow: 'auto',
          border: `1px solid ${c.border}`,
          borderRadius: 8,
          background: '#000',
        }}
      >
        <div style={{ position: 'relative', width: '100%' }}>
          <img
            ref={imgRef}
            src={dataUrl}
            alt="screenshot"
            style={{ display: 'block', width: '100%', height: 'auto' }}
          />
          {overlayFindings && (
            <DetectionOverlay
              findings={overlayFindings}
              naturalWidth={naturalWidth}
              naturalHeight={naturalHeight}
              renderedWidth={rendered.w}
              renderedHeight={rendered.h}
              selectedKey={selectedKey ?? null}
            />
          )}
        </div>
      </div>
    </div>
  );
}
