import type { ReactNode } from 'react';
import { useLayoutEffect, useRef, useState } from 'react';
import { ImageOff, Maximize2 } from 'lucide-react';
import { UiFinding } from '../state/types';
import { DetectionOverlay } from './DetectionOverlay';
import { ScreenshotLightbox } from './ScreenshotLightbox';
import { c } from './primitives';

/**
 * Renders one screenshot (raw or sanitized) with an optional detection overlay.
 * A large screenshot scrolls inside its own box — it never blows out the panel.
 * Clicking it opens the same image full-size in a lightbox.
 */
export function ScreenshotPreview({
  dataUrl,
  naturalWidth,
  naturalHeight,
  overlayFindings,
  selectedKey,
  banner,
  label = 'Screenshot',
}: {
  dataUrl: string | null;
  naturalWidth: number;
  naturalHeight: number;
  overlayFindings?: UiFinding[];
  selectedKey?: string | null;
  banner?: ReactNode;
  label?: string;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const [rendered, setRendered] = useState({ w: 0, h: 0 });
  const [expanded, setExpanded] = useState(false);
  const [hover, setHover] = useState(false);

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
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 6,
          border: `1px dashed ${c.border}`,
          borderRadius: c.radius,
          padding: 28,
          textAlign: 'center',
          color: c.dim,
          fontSize: 12,
        }}
      >
        <ImageOff size={20} strokeWidth={1.5} style={{ opacity: 0.6 }} />
        No screenshot yet.
      </div>
    );
  }

  return (
    <div>
      {banner}
      <div
        ref={wrapRef}
        onClick={() => setExpanded(true)}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        role="button"
        tabIndex={0}
        aria-label={`Expand ${label} screenshot`}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setExpanded(true);
          }
        }}
        style={{
          position: 'relative',
          maxHeight: 340,
          overflow: 'auto',
          border: `1px solid ${c.borderSoft}`,
          borderRadius: c.radius,
          boxShadow: c.shadowSm,
          background: '#000',
          cursor: 'zoom-in',
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
          <div
            style={{
              position: 'absolute',
              top: 8,
              right: 8,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 26,
              height: 26,
              borderRadius: 7,
              background: 'rgba(0, 0, 0, 0.6)',
              backdropFilter: 'blur(4px)',
              color: '#fff',
              opacity: hover ? 1 : 0.55,
              transition: 'opacity 120ms ease',
              pointerEvents: 'none',
            }}
          >
            <Maximize2 size={12} strokeWidth={2.25} />
          </div>
        </div>
      </div>

      {expanded && (
        <ScreenshotLightbox
          dataUrl={dataUrl}
          naturalWidth={naturalWidth}
          naturalHeight={naturalHeight}
          overlayFindings={overlayFindings}
          selectedKey={selectedKey}
          label={label}
          onClose={() => setExpanded(false)}
        />
      )}
    </div>
  );
}
