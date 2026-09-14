import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { UiFinding } from '../state/types';
import { DetectionOverlay } from './DetectionOverlay';
import { c } from './primitives';

/**
 * Full-panel lightbox for inspecting a screenshot at the largest size the
 * Side Panel's own viewport allows — clicking RAW/SANITIZED/SPLIT thumbnails
 * opens this instead of squinting at the small scrollable preview box.
 */
export function ScreenshotLightbox({
  dataUrl,
  naturalWidth,
  naturalHeight,
  overlayFindings,
  selectedKey,
  label,
  onClose,
}: {
  dataUrl: string;
  naturalWidth: number;
  naturalHeight: number;
  overlayFindings?: UiFinding[];
  selectedKey?: string | null;
  label: string;
  onClose: () => void;
}) {
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

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${label} screenshot, enlarged`}
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 100,
        background: 'rgba(0, 0, 0, 0.86)',
        backdropFilter: 'blur(6px)',
        WebkitBackdropFilter: 'blur(6px)',
        display: 'flex',
        flexDirection: 'column',
        animation: 'fadeIn 0.15s ease-out',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '10px 12px',
          flexShrink: 0,
        }}
      >
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.4, color: c.dim, textTransform: 'uppercase' }}>
          {label}
        </span>
        <button
          onClick={onClose}
          aria-label="Close"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 28,
            height: 28,
            borderRadius: 8,
            border: `1px solid ${c.border}`,
            background: c.panel2,
            color: c.text,
            cursor: 'pointer',
          }}
        >
          <X size={14} strokeWidth={2.5} />
        </button>
      </div>

      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          flex: 1,
          minHeight: 0,
          overflow: 'auto',
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'center',
          padding: '0 12px 12px',
          cursor: 'default',
        }}
      >
        <div style={{ position: 'relative', maxWidth: '100%' }}>
          <img
            ref={imgRef}
            src={dataUrl}
            alt={`${label} screenshot, enlarged`}
            style={{ display: 'block', maxWidth: '100%', height: 'auto', borderRadius: c.radiusSm }}
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
