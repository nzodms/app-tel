/**
 * UI preferences that belong to the person rather than the browser.
 *
 * Deliberately in `src/lib` and not in `src/server/db`: the studio store reads the
 * defaults on the client, and importing them from the database barrel would drag
 * `node:fs` into the browser bundle. `src/server/db/schema.ts` re-exports these so
 * the row type stays the single source of truth for storage.
 */
export interface UserPreferences {
  theme: 'light' | 'dark' | 'system';
  /** Left column width in the studio, as a percentage of the window. */
  leftPaneWidth: number;
  editorMinimap: boolean;
  canvasSnap: boolean;
  /**
   * Off by default. The canvas reads as a lit surface — a wide falloff and a
   * faint grain — and a ruled grid over it made it read as graph paper instead
   * of as a bench. It stays available for people who want to align by eye, and
   * when it is on it is a quiet dot lattice rather than the old ruling.
   */
  canvasGrid: boolean;
  reduceMotion: boolean;
}

export const DEFAULT_PREFERENCES: UserPreferences = {
  theme: 'light',
  leftPaneWidth: 25,
  editorMinimap: false,
  canvasSnap: true,
  canvasGrid: false,
  reduceMotion: false,
};
