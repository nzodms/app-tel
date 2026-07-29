import { describe, expect, it } from 'vitest';
import {
  BUILD_PHASES,
  BUILD_PHASE_LABELS,
  buildPhaseLabel,
  deriveBuildPhase,
  derivePreviewPresence,
  formatBuildDuration,
  formatElapsed,
  isBuildBusy,
  type BuildPhase,
} from '@/components/studio/build-phase';
import type { BundleState } from '@/components/studio/types';

/** A bundle in whatever shape the test needs, with the store's own defaults. */
function bundle(patch: Partial<BundleState> = {}): BundleState {
  return {
    ref: 'working',
    status: 'ready',
    code: 'export default () => null;',
    hash: 'h1',
    lastGoodCode: 'export default () => null;',
    lastGoodHash: 'h1',
    diagnostics: [],
    durationMs: 320,
    lastCompletedMs: 320,
    entry: 'src/App.tsx',
    bytes: 1024,
    error: null,
    stale: false,
    ...patch,
  };
}

describe('deriveBuildPhase', () => {
  it('reports never-built when no bundle exists for the ref', () => {
    expect(deriveBuildPhase(undefined, false)).toBe('never-built');
    // Even a frame that has mounted has nothing to show without a bundle.
    expect(deriveBuildPhase(undefined, true)).toBe('never-built');
  });

  it('reports queued for a registered bundle with nothing compiled and nothing running', () => {
    expect(
      deriveBuildPhase(
        bundle({ status: 'idle', code: null, lastGoodCode: null, hash: null, lastGoodHash: null }),
        false,
      ),
    ).toBe('queued');
  });

  it('reports compiling while a build is in flight, first build or rebuild', () => {
    const first = bundle({
      status: 'building',
      code: null,
      lastGoodCode: null,
      durationMs: null,
      bytes: null,
    });
    expect(deriveBuildPhase(first, false)).toBe('compiling');

    // A rebuild keeps the previous app on screen; it is still just compiling.
    const rebuild = bundle({ status: 'building', durationMs: null, bytes: null });
    expect(deriveBuildPhase(rebuild, true)).toBe('compiling');
  });

  it('reports loading once the bundle is ready but the frame has not mounted it', () => {
    expect(deriveBuildPhase(bundle({ status: 'ready' }), false)).toBe('loading');
  });

  it('never reports ready before the frame has mounted', () => {
    // The whole point of the second argument: compiled is not on screen. The
    // bundle here is as healthy as a bundle gets and it still is not ready.
    for (const frameMounted of [false, true]) {
      const phase = deriveBuildPhase(bundle({ status: 'ready' }), frameMounted);
      expect(phase).toBe(frameMounted ? 'ready' : 'loading');
    }

    // Nor when the code itself is missing, whatever the frame claims.
    expect(deriveBuildPhase(bundle({ status: 'ready', code: null }), true)).toBe('loading');
  });

  it('reports ready only for a mounted, current bundle', () => {
    expect(deriveBuildPhase(bundle(), true)).toBe('ready');
  });

  it('reports stale when what is mounted is knowingly behind the sources', () => {
    expect(deriveBuildPhase(bundle({ stale: true }), true)).toBe('stale');
    // Not yet on screen: still on its way, not yet "old".
    expect(deriveBuildPhase(bundle({ stale: true }), false)).toBe('loading');
  });

  it('reports failed for any errored bundle, so the error card owns the screen alone', () => {
    const withFallback = bundle({
      status: 'error',
      error: 'Unexpected token',
      stale: true,
      diagnostics: [
        {
          severity: 'error',
          message: 'Unexpected token',
          file: 'src/App.tsx',
          line: 12,
          column: 3,
          source: 'esbuild',
        },
      ],
    });
    const withoutFallback = bundle({
      status: 'error',
      code: null,
      hash: null,
      lastGoodCode: null,
      lastGoodHash: null,
      error: 'Unexpected token',
      stale: false,
    });

    // Failure beats staleness: two components describing one failure would only
    // ever disagree, so the phase never splits the error card's case in two.
    expect(deriveBuildPhase(withFallback, true)).toBe('failed');
    expect(deriveBuildPhase(withoutFallback, true)).toBe('failed');
    expect(deriveBuildPhase(withoutFallback, false)).toBe('failed');
  });

  it('handles an idle bundle that already has code like any other settled bundle', () => {
    expect(deriveBuildPhase(bundle({ status: 'idle' }), true)).toBe('ready');
    expect(deriveBuildPhase(bundle({ status: 'idle' }), false)).toBe('loading');
    expect(deriveBuildPhase(bundle({ status: 'idle', stale: true }), true)).toBe('stale');
  });

  it('can produce every declared phase', () => {
    const produced = new Set<BuildPhase>([
      deriveBuildPhase(undefined, false),
      deriveBuildPhase(bundle({ status: 'idle', code: null }), false),
      deriveBuildPhase(bundle({ status: 'building' }), false),
      deriveBuildPhase(bundle({ status: 'ready' }), false),
      deriveBuildPhase(bundle({ status: 'ready' }), true),
      deriveBuildPhase(bundle({ status: 'ready', stale: true }), true),
      deriveBuildPhase(bundle({ status: 'error' }), true),
    ]);
    expect([...produced].sort()).toEqual([...BUILD_PHASES].sort());
  });
});

describe('derivePreviewPresence', () => {
  it('separates a failure that kept the last good bundle from one that did not', () => {
    // The store puts `lastGoodCode` into `code` on failure, which is what the
    // frame is actually holding — so this is the difference between "your app is
    // still there, dimmed, behind the error" and a genuinely blank phone.
    const kept = bundle({ status: 'error', error: 'boom', stale: true });
    const blank = bundle({
      status: 'error',
      code: null,
      hash: null,
      lastGoodCode: null,
      lastGoodHash: null,
      error: 'boom',
    });

    expect(derivePreviewPresence(kept, true)).toBe('last-good');
    expect(derivePreviewPresence(blank, true)).toBe('none');
    expect(derivePreviewPresence(kept, true)).not.toBe(derivePreviewPresence(blank, true));
  });

  it('reports nothing on screen until the frame has mounted', () => {
    expect(derivePreviewPresence(bundle(), false)).toBe('none');
    expect(derivePreviewPresence(undefined, true)).toBe('none');
  });

  it('reports a live preview for a healthy mounted bundle, including during a rebuild', () => {
    expect(derivePreviewPresence(bundle(), true)).toBe('live');
    expect(derivePreviewPresence(bundle({ status: 'building', durationMs: null }), true)).toBe(
      'live',
    );
  });

  it('reports last-good for anything flagged stale', () => {
    expect(derivePreviewPresence(bundle({ stale: true }), true)).toBe('last-good');
  });
});

describe('phase labels', () => {
  it('gives every phase exactly one non-empty label', () => {
    for (const phase of BUILD_PHASES) {
      expect(buildPhaseLabel(phase)).toBe(BUILD_PHASE_LABELS[phase]);
      expect(buildPhaseLabel(phase).length).toBeGreaterThan(0);
    }
    expect(Object.keys(BUILD_PHASE_LABELS).sort()).toEqual([...BUILD_PHASES].sort());
  });

  it('marks exactly the in-flight phases as busy', () => {
    expect(BUILD_PHASES.filter(isBuildBusy)).toEqual(['queued', 'compiling', 'loading']);
  });
});

describe('formatElapsed', () => {
  it('shows tenths while a build could still land', () => {
    expect(formatElapsed(0)).toBe('0.0s');
    expect(formatElapsed(340)).toBe('0.3s');
    expect(formatElapsed(9_940)).toBe('9.9s');
  });

  it('drops to whole seconds once tenths are just noise', () => {
    expect(formatElapsed(10_000)).toBe('10s');
    expect(formatElapsed(42_700)).toBe('42s');
  });

  it('reads as minutes past a minute', () => {
    expect(formatElapsed(60_000)).toBe('1m 00s');
    expect(formatElapsed(125_000)).toBe('2m 05s');
  });

  it('never renders a negative or non-finite clock', () => {
    expect(formatElapsed(-500)).toBe('0.0s');
    expect(formatElapsed(Number.NaN)).toBe('0.0s');
    expect(formatElapsed(Number.POSITIVE_INFINITY)).toBe('0.0s');
  });
});

describe('formatBuildDuration', () => {
  it('returns null when there is no duration to report', () => {
    // Nothing has finished yet: the caller must show no line at all rather than
    // an invented "0ms".
    expect(formatBuildDuration(null)).toBeNull();
    expect(formatBuildDuration(undefined)).toBeNull();
    expect(formatBuildDuration(-1)).toBeNull();
    expect(formatBuildDuration(Number.NaN)).toBeNull();
  });

  it('reports sub-second builds in milliseconds', () => {
    expect(formatBuildDuration(0)).toBe('0ms');
    expect(formatBuildDuration(318.6)).toBe('319ms');
  });

  it('reports longer builds in seconds and minutes', () => {
    expect(formatBuildDuration(1_400)).toBe('1.4s');
    expect(formatBuildDuration(12_800)).toBe('12.8s');
    expect(formatBuildDuration(61_000)).toBe('1m 01s');
  });
});
