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
  // Per *device*, not per component instance: a remount must not change it, or
  // the registry and the live frame stop agreeing on who is who. See
  // `PreviewRegistry.nonceForDevice`.
  const nonce = useMemo(() => previewRegistry.nonceForDevice(deviceId), [deviceId]);
  const src = useMemo(() => `/preview/host?n=${nonce}`, [nonce]);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    previewRegistry.register(deviceId, iframe, nonce);
    // Scoped to this exact frame: a StrictMode cleanup must not delete an entry
    // that a second mount has already replaced.
    return () => previewRegistry.unregister(deviceId, iframe);
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
