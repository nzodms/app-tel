import { describe, expect, it } from 'vitest';
import { countDiagnostics, mergeDiagnostics } from '@/components/studio/store';
import type { Diagnostic } from '@/server/db';

/**
 * The build status must never claim fewer errors than there are.
 *
 * The studio showed "0 error(s)" while both phones showed "Build failed". A
 * request that never reached the compiler set `buildStatus: 'error'` and wrote
 * `diagnostics: []`, so the counter — which read only the compile diagnostics —
 * had genuinely nothing to count. A failure with nothing to show is still a
 * failure.
 */

const diagnostic = (
  source: Diagnostic['source'],
  severity: Diagnostic['severity'] = 'error',
  message = 'boom',
): Diagnostic => ({ severity, message, file: null, line: null, column: null, source });

describe('counting diagnostics', () => {
  it('separates build, runtime and request errors', () => {
    const counts = countDiagnostics([
      diagnostic('esbuild'),
      diagnostic('esbuild'),
      diagnostic('runtime'),
      diagnostic('transport'),
      diagnostic('esbuild', 'warning'),
    ]);
    expect(counts).toEqual({ build: 2, runtime: 1, transport: 1, total: 4, warnings: 1 });
  });

  it('counts a failed request as an error', () => {
    // The exact case that produced "0 error(s)".
    const counts = countDiagnostics([
      diagnostic('transport', 'error', 'Could not reach the build service: 404'),
    ]);
    expect(counts.total).toBe(1);
    expect(counts.transport).toBe(1);
    expect(counts.build).toBe(0);
  });

  it('does not count warnings as errors', () => {
    expect(countDiagnostics([diagnostic('esbuild', 'warning')]).total).toBe(0);
  });

  it('is zero only when there is genuinely nothing', () => {
    expect(countDiagnostics([])).toEqual({
      build: 0,
      runtime: 0,
      transport: 0,
      total: 0,
      warnings: 0,
    });
  });
});

describe('merging diagnostics by source', () => {
  it('replaces one source and keeps the others', () => {
    const current = [
      diagnostic('esbuild', 'error', 'old compile error'),
      diagnostic('runtime', 'error', 'a runtime exception the preview reported'),
    ];
    // A successful rebuild clears compile errors but must not erase the runtime
    // exception the preview already reported.
    const merged = mergeDiagnostics(current, [], 'esbuild');
    expect(merged).toHaveLength(1);
    expect(merged[0]?.source).toBe('runtime');
  });

  it('lets a failed request add itself without wiping compile output', () => {
    const current = [diagnostic('esbuild', 'error', 'compile error')];
    const merged = mergeDiagnostics(
      current,
      [diagnostic('transport', 'error', 'Could not reach the build service: 404')],
      'transport',
    );
    expect(countDiagnostics(merged)).toMatchObject({ build: 1, transport: 1, total: 2 });
  });

  it('replaces rather than accumulates on repeated builds', () => {
    let state: Diagnostic[] = [];
    for (let attempt = 0; attempt < 5; attempt += 1) {
      state = mergeDiagnostics(state, [diagnostic('esbuild', 'error', 'same error')], 'esbuild');
    }
    // Five failed builds of the same broken file is one error, not five.
    expect(countDiagnostics(state).build).toBe(1);
  });
});
