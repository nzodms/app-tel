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
  subscribe(listener: ZoomListener): () => void {
    listeners.add(listener);
    listener(zoom);
    return () => listeners.delete(listener);
  },
};
