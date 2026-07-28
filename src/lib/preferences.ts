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
  canvasGrid: boolean;
  reduceMotion: boolean;
}

export const DEFAULT_PREFERENCES: UserPreferences = {
  theme: 'light',
  leftPaneWidth: 25,
  editorMinimap: false,
  canvasSnap: true,
  canvasGrid: true,
  reduceMotion: false,
};
