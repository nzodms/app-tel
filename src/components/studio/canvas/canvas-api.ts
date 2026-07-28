'use client';

/**
 * Imperative handle on the canvas viewport.
 *
 * The toolbar needs to zoom and recentre, and it needs to display the current zoom
 * — but pan and zoom must never go through React state, or every pointer move
 * would re-render the phones. So the canvas publishes this handle and pushes zoom
 * updates to subscribers directly.
 */

export interface CanvasApi {
  zoomBy(factor: number): void;
  zoomTo(scale: number): void;
  fit(): void;
  center(): void;
  focusDevice(deviceId: string): void;
  getZoom(): number;
  /**
   * Glides devices to new positions instead of teleporting them.
   *
   * Only ever used for a deliberate re-layout ("Auto arrange", a preset): a drag
   * must stay instant, and a transition there would make the phone lag the
   * pointer. The transition is applied to the node's `transform` and removed
   * once it finishes, so dragging afterwards is immediate again.
   *
   * This moves an ancestor of the iframe, never the iframe itself — the preview
   * keeps running, keeps its route and keeps its state throughout.
   */
  animateTo(positions: readonly { id: string; x: number; y: number }[], durationMs?: number): void;
  /** width ÷ height of the canvas viewport, so a layout can suit its shape. */
  viewportAspect(): number | null;
}

type ZoomListener = (zoom: number) => void;

const listeners = new Set<ZoomListener>();
let api: CanvasApi | null = null;
let zoom = 1;

export const canvasApi = {
  set(next: CanvasApi | null): void {
    api = next;
  },
  get(): CanvasApi | null {
    return api;
  },
  publishZoom(next: number): void {
    zoom = next;
    for (const listener of listeners) listener(next);
  },
  currentZoom(): number {
    return zoom;
  },
  /** Null before the canvas mounts; callers fall back to their own default. */
  viewportAspect(): number | null {
    return api?.viewportAspect() ?? null;
  },
  subscribe(listener: ZoomListener): () => void {
    listeners.add(listener);
    listener(zoom);
    return () => listeners.delete(listener);
  },
};
