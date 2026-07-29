import type { BundleState } from './types';

/**
 * What a phone can honestly say about its build, and nothing more.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS MODULE IS SO SMALL, AND MUST STAY SO
 * ---------------------------------------------------------------------------
 * A preview build is ONE request. `ensureBundle` posts to
 * `/api/projects/:id/preview/build` and either gets a bundle back or does not.
 * There is no progress stream, no step channel, no server-side percentage —
 * `BuildOutcome` reports `durationMs` only once the whole thing is over.
 *
 * So this module derives a *phase*, never a *progress*. The three things a
 * build overlay is allowed to show are the ones that can actually be observed:
 *
 *   1. the phase below, derived from `BundleState` and the frame's own report;
 *   2. elapsed time, which the client can measure with a clock;
 *   3. facts the server already told us — the entry file it compiled, and how
 *      long the last completed build took.
 *
 * Anything else — a percentage, a "bundling / minifying / linking" sequence, an
 * ETA — would be a drawing of a build rather than a report of one. If a fifth
 * busy stage ever feels necessary here, it is being invented.
 *
 * Pure and React-free on purpose: the phase is a claim about state, and a claim
 * about state should be testable without a DOM.
 */
export type BuildPhase =
  | 'never-built'
  | 'queued'
  | 'compiling'
  | 'loading'
  | 'ready'
  | 'stale'
  | 'failed';

/** Every phase, in the order a first build passes through them. */
export const BUILD_PHASES: readonly BuildPhase[] = [
  'never-built',
  'queued',
  'compiling',
  'loading',
  'ready',
  'stale',
  'failed',
];

/**
 * The one line of text each phase is allowed to put on screen.
 *
 * Deliberately in the register the failure card already uses — "Compiling",
 * "Running the app" — so a phone reads the same whether the build worked or not.
 */
export const BUILD_PHASE_LABELS: Record<BuildPhase, string> = {
  'never-built': 'Not built yet',
  queued: 'Queued',
  compiling: 'Compiling',
  loading: 'Starting the app',
  ready: 'Preview updated',
  stale: 'Older than your sources',
  failed: 'Build failed',
};

export function buildPhaseLabel(phase: BuildPhase): string {
  return BUILD_PHASE_LABELS[phase];
}

/** The phases where something is genuinely in flight and elapsed time is meaningful. */
export function isBuildBusy(phase: BuildPhase): boolean {
  return phase === 'queued' || phase === 'compiling' || phase === 'loading';
}

/**
 * The phase a device should display, from the only two things that are known:
 * the bundle for its ref, and whether its own frame has reported `preview:mounted`.
 *
 * The frame's report is what separates "the bundle compiled" from "the app is on
 * screen". They are not the same event — the code is handed to the iframe over
 * postMessage and the app answers when it has actually mounted — and treating
 * them as one is how a phone ends up claiming to be ready while still blank.
 *
 * Notes on the two phases that look unreachable, because they nearly are:
 *
 * - `queued` is `status: 'idle'` with nothing compiled: a bundle record exists
 *   for the ref and no build is running against it. Today `ensureBundle` goes
 *   straight from nothing to `'building'`, so nothing in the shipped store
 *   produces it — but `'idle'` is a declared member of `BundleState['status']`
 *   and mapping it to "compiling" would be a lie about a build that has not
 *   started. It is mapped honestly and left to whatever produces it.
 *
 * - `stale` requires `stale: true` on a bundle that is *not* failing. The store
 *   currently only raises `stale` alongside `status: 'error'` (a failed build
 *   keeping the last good code, or `recoverLastWorking` putting a snapshot back
 *   on screen), and a failure belongs to the error card — so `failed` wins. The
 *   flag is read generically here, exactly as the toolbar reads it, rather than
 *   special-cased to the paths that happen to set it today.
 */
export function deriveBuildPhase(
  bundle: BundleState | undefined,
  frameMounted: boolean,
): BuildPhase {
  // No bundle record at all: nothing has ever been asked of this ref. Not an
  // error, not a wait — a phone that has not been built yet.
  if (!bundle) return 'never-built';

  switch (bundle.status) {
    // The error card owns this case end to end; the overlay renders nothing.
    case 'error':
      return 'failed';

    // The single request is in flight. Whether the compiler has picked it up is
    // not observable from here, so this stays one phase.
    case 'building':
      return 'compiling';

    case 'idle':
      return bundle.code ? settled(bundle, frameMounted) : 'queued';

    case 'ready':
      return settled(bundle, frameMounted);
  }
}

/**
 * A build that is over. What is on screen decides the rest: no code, or a frame
 * that has not mounted, means the app is still on its way — never "ready".
 */
function settled(bundle: BundleState, frameMounted: boolean): BuildPhase {
  if (!bundle.code || !frameMounted) return 'loading';
  return bundle.stale ? 'stale' : 'ready';
}

/** What the phone has on screen, underneath whatever the overlay draws. */
export type PreviewPresence =
  /** Nothing: no bundle, or a bundle the frame has not mounted. */
  | 'none'
  /** An app built from the sources as far as anything here knows. */
  | 'live'
  /** An app that is knowingly behind the sources — kept there through a failure. */
  | 'last-good';

/**
 * Whether there is an app under the overlay, and whether it is current.
 *
 * The phase alone cannot answer this, and two phases need the answer: a build in
 * flight dims a real preview but must draw a placeholder over an empty screen,
 * and a failure with `lastGoodCode` behind it is a different picture from a
 * failure with nothing behind it — the error card already says so in words
 * ("Still running the last version that compiled" against "Nothing is running
 * yet"), and it makes the same test to decide, `mounted && bundle.code`.
 *
 * Note this reads `bundle.code`, not `lastGoodCode`: on a failure the store has
 * already put the last good bundle into `code`, and `code` is the only field the
 * frame is ever handed. `lastGoodCode` is the store's memory, not the screen.
 */
export function derivePreviewPresence(
  bundle: BundleState | undefined,
  frameMounted: boolean,
): PreviewPresence {
  if (!bundle || !bundle.code || !frameMounted) return 'none';
  if (bundle.status === 'error' || bundle.stale) return 'last-good';
  return 'live';
}

/**
 * Elapsed time since a build started, for a clock that ticks while it runs.
 *
 * Resolution drops as the number grows: tenths while a build is still plausibly
 * about to land, whole seconds once it is not, so the digits stop flickering on
 * a build that is taking a while.
 */
export function formatElapsed(ms: number): string {
  const value = Number.isFinite(ms) && ms > 0 ? ms : 0;
  if (value < 10_000) return `${(value / 1000).toFixed(1)}s`;
  if (value < 60_000) return `${Math.floor(value / 1000)}s`;
  const minutes = Math.floor(value / 60_000);
  const seconds = Math.floor((value % 60_000) / 1000);
  return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
}

/**
 * How long a build that has already finished took. Null in, null out — there is
 * no such thing as a default duration, and "0ms" would be a claim.
 */
export function formatBuildDuration(ms: number | null | undefined): string | null {
  if (ms === null || ms === undefined) return null;
  if (!Number.isFinite(ms) || ms < 0) return null;
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.floor((ms % 60_000) / 1000);
  return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
}
