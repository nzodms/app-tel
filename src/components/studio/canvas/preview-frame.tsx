'use client';

import { useEffect, useMemo, useRef } from 'react';
import { previewRegistry } from '../preview-registry';

/**
 * One device's preview.
 *
 * The iframe is created once per device and never re-created: new builds arrive
 * over postMessage, and moving the phone only changes an ancestor's transform. That
 * is what keeps the app's state (and scroll position, and form input) alive while
 * you rearrange the canvas.
 *
 * `sandbox="allow-scripts"` without `allow-same-origin` puts the frame on an opaque
 * origin: it cannot read PhoneLab's cookies, storage or DOM, and it cannot make
 * credentialed requests to our API.
 */
export function PreviewFrame({
  deviceId,
  width,
  height,
  title,
}: {
  deviceId: string;
  width: number;
  height: number;
  title: string;
}) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  // Minted before the frame exists so it can travel in the URL.
  const nonce = useMemo(() => crypto.randomUUID().replace(/-/g, ''), []);
  const src = useMemo(() => `/preview/host?n=${nonce}`, [nonce]);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    previewRegistry.register(deviceId, iframe, nonce);
    return () => previewRegistry.unregister(deviceId);
  }, [deviceId, nonce]);

  return (
    <iframe
      ref={iframeRef}
      src={src}
      title={title}
      sandbox="allow-scripts"
      // The frame is the app's viewport: exactly the preset's logical size, so the
      // layout inside is identical to the real device.
      style={{ width, height, border: 0, display: 'block', background: 'transparent' }}
      // Keep the browser from treating this as a navigable document in history.
      referrerPolicy="no-referrer"
      loading="eager"
    />
  );
}
