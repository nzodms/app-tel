'use client';

import { useSyncExternalStore } from 'react';
import type { StoreApi } from 'zustand';
import { isPreviewMessage } from '@/lib/preview/protocol';
import type { ActivityKind, ClaudeActivity } from '@/server/mcp/activity';
import {
  EMPTY_SESSION,
  applyActivity,
  applyBuild,
  applyPreviewMounted,
  currentLabel,
  settleSession,
  type ClaudeSession,
  type SessionStep,
} from './claude-session';
import { useStudioApi } from './context';
import { previewRegistry } from './preview-registry';
import type { StudioStore } from './store';

/**
 * Feeds `claude-session.ts` from the three signals the studio already receives,
 * and hands the result to React.
 *
 * The reducer is pure and tested; this file is only wiring. It adds no step the
 * reducer cannot produce and no claim the reducer does not make — everything it
 * decides on its own (below) is about *whether* to show a sequence, never about
 * what the sequence says.
 *
 * ## Where the three inputs come from, and why
 *
 * 1. `claude.activity` — the leading edge of every MCP tool call. It arrives at
 *    `store.applyRealtime(event, payload)`, whose switch has no case for it: the
 *    event reaches the client and the store drops it on the floor. Nothing in the
 *    store changes, so `store.subscribe()` cannot see it — there is no state
 *    transition to observe. The two ways to get at it from outside store.ts are a
 *    second `EventSource` or a tap on the dispatcher, and the second connection
 *    is the worse one: it doubles the SSE streams per tab against a browser limit
 *    of six per host on HTTP/1.1 (which is what `next dev` speaks), for a stream
 *    the tab is already receiving. So this installs a tap: `applyRealtime` is
 *    replaced by a wrapper that calls the original first and then hands the same
 *    (event, payload) to the watcher. The store's behaviour is unchanged, the
 *    wrapper is installed once per store, listener failures are caught so a bug
 *    here can never break realtime reconciliation, and the original is restored
 *    when the last watcher goes away.
 *
 * 2. `build.started` / `build.finished` — same stream, same tap. Taken from the
 *    bus rather than from `remoteBuild` because the store deliberately ignores
 *    builds this tab triggered, and a compile is a compile whoever asked for it
 *    (`claude-session.ts` says so explicitly).
 *
 * 3. A frame reporting `preview:mounted` — a `window` message from the iframe.
 *    The store records it as `chrome[deviceId].mounted`, but that flag is already
 *    `true` after the first mount and never goes back, so the *re*-mount that
 *    follows a rebuild — the one that actually means "the phone is showing the
 *    new code" — is invisible from the store. The message itself is not, so this
 *    listens for it directly, with the same provenance check the studio's own
 *    listener makes (`previewRegistry.resolve` proves the message came from a
 *    registered frame's window, so nothing else on the page can forge a mount).
 *    The message also carries the hash of the bundle the frame is running, and
 *    `build.finished` carries the hash the build produced — the same value from
 *    the two ends of one handoff — so "Preview updated" is checked against the
 *    code actually on the phone rather than inferred from timing.
 *
 * ## One watcher per store, not one per component
 *
 * The strip and the Claude panel must show the same sequence, and a panel opened
 * mid-session must not show a shorter one than the strip. So the fold lives in a
 * single watcher per studio store, shared through `useSyncExternalStore`, with
 * one interval for the whole studio — not one per step, and not one per mounted
 * component. It is attached when the first component subscribes and released
 * when the last unsubscribes; a sequence that had already come to rest survives
 * that, so switching a tab away and back still shows the last one. A sequence
 * with work still in flight does not: the events that would have closed it go
 * past while nothing is listening, and continuing it would mean reporting a
 * stall about builds that reported perfectly (see `release`).
 *
 * NOTE for whoever wires the strip in: the session is only recorded while
 * something is subscribed. Mount the strip at the studio root, unconditionally,
 * or a panel opened halfway through will genuinely have missed the beginning —
 * and it will show what it saw, not a reconstruction.
 *
 * ## The three judgements this file makes, and why each is honest
 *
 * - **A settled session is over.** `settleSession` clears `active`, but nothing
 *   clears `startedAt` or `steps`, so folding tomorrow's events onto today's
 *   session would report an elapsed time of several hours. The next event after
 *   a session goes quiet therefore starts a new one.
 * - **A running step with no signal at all is not a running step.** The reducer
 *   keeps a session live for as long as anything is `running`, which is right —
 *   a build can legitimately take minutes — but a tool call whose `finished`
 *   never arrives (a dropped stream, a server that died mid-call) would pin the
 *   strip open forever, still claiming work is in progress. After `STALL_MS`
 *   with nothing heard, `live` goes false. The step is *not* rewritten as failed:
 *   we do not know that it failed, only that we stopped hearing about it, and
 *   `stalled` says exactly that.
 * - **A sequence with no Claude in it settles faster.** `SESSION_IDLE_MS` is 45s
 *   because Claude pauses between tool calls and the strip must not flicker in
 *   and out mid-task. Your own save has no such pause: when the compile is done
 *   and the preview has updated, nothing is happening, and a strip that lingered
 *   for another forty seconds would be claiming otherwise.
 */

/** How often liveness is re-checked. Nothing here needs sub-second resolution. */
const TICK_MS = 1_000;

/**
 * How long a step may sit `running` with nothing heard before we stop calling the
 * session live. The same order as the store's own `REMOTE_BUILD_TIMEOUT_MS`, and
 * for the same reason: generous enough for a genuinely slow call, finite enough
 * that a dropped stream cannot leave the studio insisting Claude is still working.
 */
const STALL_MS = 120_000;

/** How long a finished sequence that Claude had no part in stays on screen. */
const LOCAL_IDLE_MS = 3_000;

/**
 * How late a mount may be re-applied once the build that caused it is known to
 * have finished.
 *
 * A local rebuild hands the code to the frame only after the build request has
 * resolved — which is after the server published `build.finished`. So a mount
 * that lands while we still believe a build is running mounted the *new* code;
 * the two messages simply crossed. Re-applying it inside this window is therefore
 * a claim about something that did happen — provided the hash it reported is one
 * of the hashes the build produced. Outside the window, with no build in flight,
 * or naming a different bundle, it is dropped.
 */
const MOUNT_REPLAY_MS = 1_500;

/* -------------------------------------------------------------------------- */
/* The view                                                                    */
/* -------------------------------------------------------------------------- */

export interface ClaudeSessionView {
  /** Exactly as the reducer produced it. Never edited here. */
  session: ClaudeSession;
  /** The step in flight, or null between calls. Always the last step, by construction. */
  running: SessionStep | null;
  /**
   * One line for the sequence right now: what is running, or the reducer's word
   * for the gap between two tool calls, or what happened last. Null when there is
   * nothing to say at all.
   */
  label: string | null;
  /**
   * Nothing is running, the session is still open, and Claude is in the loop —
   * `currentLabel` calls this "Waiting for Claude", which is the truth: it is
   * generating and we cannot see it.
   */
  waiting: boolean;
  /** True once an MCP tool call has fed this session, as opposed to builds alone. */
  fromClaude: boolean;
  /** Something is genuinely happening. The strip exists only while this is true. */
  live: boolean;
  /** A step is running but nothing has been heard for `STALL_MS`. */
  stalled: boolean;
}

const IDLE_VIEW: ClaudeSessionView = {
  session: EMPTY_SESSION,
  running: null,
  label: null,
  waiting: false,
  fromClaude: false,
  live: false,
  stalled: false,
};

/* -------------------------------------------------------------------------- */
/* The watcher                                                                 */
/* -------------------------------------------------------------------------- */

type RealtimeDispatch = StudioStore['applyRealtime'];

class SessionWatcher {
  private session: ClaudeSession = EMPTY_SESSION;
  private fromClaude = false;
  private view: ClaudeSessionView = IDLE_VIEW;

  private readonly listeners = new Set<() => void>();
  private detach: (() => void)[] = [];
  private timer: number | null = null;

  /**
   * Builds we have seen start and not yet seen finish.
   *
   * `rebuildAll` compiles every ref on the canvas at once, so one save is several
   * `build.started`/`build.finished` pairs. Without this the first finish would
   * close the compiling step while three builds were still running. It also
   * discards the orphan finish a *cached* build publishes — the preview service
   * announces the outcome without a start, "because nothing started", and closing
   * a step that never opened would activate a session out of nothing.
   */
  private readonly builds = new Set<string>();
  private buildOk = true;
  private buildError: string | null = null;
  /**
   * The bundle hashes the current group of builds actually produced.
   *
   * `build.finished` carries the hash of the code it compiled and
   * `preview:mounted` carries the hash of the code the frame is running — the
   * same value, from the two ends of the same handoff. Holding the built ones
   * here is what lets a mount be checked against them rather than assumed.
   */
  private readonly buildHashes = new Set<string>();
  /** The last mount a frame reported while a build was still in flight. */
  private mountedDuringBuild: { at: number; hash: string } | null = null;

  constructor(private readonly store: StoreApi<StudioStore>) {}

  /* ------------------------------------------------------------ React glue */

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    if (this.listeners.size === 1) this.attach();
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0) this.release();
    };
  };

  readonly getView = (): ClaudeSessionView => this.view;

  /* --------------------------------------------------------------- wiring */

  private attach(): void {
    const original = this.store.getState().applyRealtime;
    const tapped: RealtimeDispatch = (event, payload) => {
      original(event, payload);
      try {
        this.onRealtime(event, payload);
      } catch (error) {
        // The realtime pipeline is not ours to break: whatever went wrong in
        // here, the store has already reconciled and the next event must still
        // get through.
        console.error('[phonelab] claude session watcher failed', error);
      }
    };
    this.store.setState({ applyRealtime: tapped });

    const onMessage = (event: MessageEvent<unknown>) => {
      const data = event.data;
      if (!isPreviewMessage(data) || data.type !== 'preview:mounted') return;
      // Same proof the studio's own listener requires: the message has to come
      // from a frame we registered. `event.source` is the unforgeable half.
      if (!previewRegistry.resolve(event.source, data.nonce)) return;
      // Typed as a string, but this is a postMessage payload: check it before
      // deciding anything on it.
      this.onMount(typeof data.hash === 'string' ? data.hash : '', Date.now());
    };
    window.addEventListener('message', onMessage);

    this.detach = [
      () => {
        // Only restore what we installed. If something else has replaced the
        // dispatcher since, it owns it now.
        if (this.store.getState().applyRealtime === tapped) {
          this.store.setState({ applyRealtime: original });
        }
      },
      () => window.removeEventListener('message', onMessage),
    ];

    // Time passed while nothing was watching: settle before anyone reads it, and
    // pick the clock back up if a session is still open.
    this.tick();
    this.startTimer();
  }

  private release(): void {
    for (const off of this.detach) off();
    this.detach = [];
    this.stopTimer();

    /*
     * Everything below the session is bookkeeping about events still in flight,
     * and from here we stop hearing them.
     *
     * Leaving it in place is not neutral: a build whose `finished` arrives while
     * nothing is subscribed keeps its id in `builds` forever, and the *next*
     * compile then finishes into "other refs are still compiling" and never
     * closes its step — so two minutes later the panel says nothing has been
     * reported, about builds that reported perfectly. Same for a step left
     * `running`: the event that would have closed it has already gone past.
     *
     * A sequence that had come to rest is still true and is kept, so switching
     * tabs and coming back still shows the last sequence. One with work in
     * flight cannot be continued honestly, so it is dropped and the next event
     * starts a new one.
     */
    this.builds.clear();
    this.buildHashes.clear();
    this.buildOk = true;
    this.buildError = null;
    this.mountedDuringBuild = null;
    if (this.session.steps.some((step) => step.status === 'running')) {
      this.session = EMPTY_SESSION;
      this.fromClaude = false;
      this.view = IDLE_VIEW;
    }
  }

  /* ---------------------------------------------------------------- input */

  private onRealtime(event: string, payload: unknown): void {
    const now = Date.now();
    switch (event) {
      case 'claude.activity': {
        const activity = asActivity(payload);
        if (activity) this.onActivity(activity, now);
        break;
      }
      case 'build.started': {
        const body = asRecord(payload);
        if (typeof body.buildId === 'string') this.onBuildStarted(body.buildId, now);
        break;
      }
      case 'build.finished': {
        const body = asRecord(payload);
        if (typeof body.buildId === 'string') {
          this.onBuildFinished(
            body.buildId,
            body.ok !== false,
            typeof body.diagnosticCount === 'number' ? body.diagnosticCount : 0,
            typeof body.hash === 'string' ? body.hash : '',
            now,
          );
        }
        break;
      }
      default:
        // Every other realtime event belongs to the store alone.
        break;
    }
  }

  private onActivity(activity: ClaudeActivity, now: number): void {
    const restart = !this.snapshot(now).live;
    const base = restart ? EMPTY_SESSION : this.session;

    // A `finished` that closes nothing is a late echo — of a call whose session
    // has already ended, or of one this tab never saw start. Folding it in would
    // reactivate the session with no step to show for it.
    if (
      activity.phase === 'finished' &&
      !base.steps.some((step) => step.id === activity.callId && step.status === 'running')
    ) {
      return;
    }

    if (restart) this.reset();
    this.fromClaude = true;
    this.commit(applyActivity(base, activity, now), now);
  }

  private onBuildStarted(buildId: string, now: number): void {
    if (this.builds.has(buildId)) return;
    const restart = !this.snapshot(now).live;
    const base = restart ? EMPTY_SESSION : this.session;
    if (restart) this.reset();
    // A new group of builds: whatever the previous one produced is no longer
    // what a mount would be reporting.
    if (this.builds.size === 0) this.buildHashes.clear();
    this.builds.add(buildId);
    this.commit(applyBuild(base, { phase: 'started' }, now), now);
  }

  private onBuildFinished(
    buildId: string,
    ok: boolean,
    diagnosticCount: number,
    hash: string,
    now: number,
  ): void {
    // Not a build we watched start: a cache hit, or one from before this session.
    if (!this.builds.delete(buildId)) return;
    if (ok && hash !== '') this.buildHashes.add(hash);
    if (!ok) {
      this.buildOk = false;
      // The bus carries the count, not the messages; the Logs panel has those.
      // Saying how many there are is a fact, and it is all we have here.
      this.buildError =
        diagnosticCount > 0
          ? `The build failed with ${diagnosticCount} diagnostic(s).`
          : 'The build failed.';
    }
    // Other refs are still compiling. One save can be several builds.
    if (this.builds.size > 0) return;

    const outcome = { ok: this.buildOk, error: this.buildError };
    this.buildOk = true;
    this.buildError = null;

    // The session may have restarted under us (a stall) — there is then no
    // compiling step to close, and opening one now would be inventing a build.
    const compiling = this.session.steps.some(
      (step) => step.kind === 'compiling' && step.status === 'running',
    );
    if (!compiling) {
      this.mountedDuringBuild = null;
      return;
    }

    this.commit(applyBuild(this.session, { phase: 'finished', ...outcome }, now), now);

    const pending = this.mountedDuringBuild;
    this.mountedDuringBuild = null;
    if (
      outcome.ok &&
      pending !== null &&
      now - pending.at <= MOUNT_REPLAY_MS &&
      this.mountedOurBuild(pending.hash)
    ) {
      this.commit(applyPreviewMounted(this.session, now), now);
    }
  }

  private onMount(hash: string, now: number): void {
    // A mount outside a session is a device being added or reloaded; it is not
    // this sequence's doing, and the reducer would reject it anyway.
    if (!this.snapshot(now).live) return;
    if (this.builds.size > 0) {
      // Still compiling: the hash cannot be checked yet, so keep it and decide
      // when the build says what it produced.
      this.mountedDuringBuild = { at: now, hash };
    }
    if (!this.mountedOurBuild(hash)) return;
    this.commit(applyPreviewMounted(this.session, now), now);
  }

  /**
   * Whether a frame reporting this bundle hash is reporting *our* build.
   *
   * "Preview updated" is the one claim in the sequence about the phone rather
   * than about the server, and the frame hands us the hash of the code it is
   * actually running. A mount naming a different bundle is a real mount — a
   * device being added, a frame reloading the previous bundle mid-build — but it
   * is not this compile arriving on the phone, and saying so would be a claim
   * about code that is not on screen.
   *
   * Only ever refused on a positive contradiction: a frame that has not been
   * handed a bundle yet reports an empty hash, and a build that published none
   * leaves nothing to compare against. Neither is evidence of a mismatch, so
   * neither is treated as one.
   */
  private mountedOurBuild(hash: string): boolean {
    if (hash === '' || this.buildHashes.size === 0) return true;
    return this.buildHashes.has(hash);
  }

  /* ----------------------------------------------------------------- fold */

  private reset(): void {
    this.session = EMPTY_SESSION;
    this.fromClaude = false;
    this.builds.clear();
    this.buildHashes.clear();
    this.buildOk = true;
    this.buildError = null;
    this.mountedDuringBuild = null;
  }

  private commit(session: ClaudeSession, now: number): void {
    if (session === this.session) return;
    this.session = session;
    this.publish(now);
    this.startTimer();
  }

  /** One interval for the whole studio: a session goes quiet by nothing happening. */
  private startTimer(): void {
    if (this.timer !== null || !this.session.active) return;
    this.timer = window.setInterval(this.tick, TICK_MS);
  }

  private stopTimer(): void {
    if (this.timer === null) return;
    window.clearInterval(this.timer);
    this.timer = null;
  }

  private readonly tick = (): void => {
    const now = Date.now();
    const settled = settleSession(this.session, now);
    if (settled !== this.session) this.session = settled;
    this.publish(now);
    // Nothing left to re-check: a settled session is done, and a stalled one
    // cannot settle at all (the reducer keeps a running step alive by design), so
    // there is no reason to keep a timer alive for it either. The next event
    // starts the clock again.
    if (!this.session.active || this.view.stalled) this.stopTimer();
  };

  /**
   * Recomputes the view and notifies only if it actually changed.
   *
   * The tick runs every second for as long as a session is open; without this
   * comparison every studio with a build running would re-render once a second
   * for a value that did not move.
   */
  private publish(now: number): void {
    const next = this.snapshot(now);
    if (same(next, this.view)) return;
    this.view = next;
    for (const listener of this.listeners) listener();
  }

  private snapshot(now: number): ClaudeSessionView {
    const session = this.session;
    const steps = session.steps;
    const last = steps[steps.length - 1] ?? null;

    // Any running step is the last one: opening a step closes every other, in
    // all three reducers. Reading it off the end is a lookup, not a second
    // implementation of the rule.
    const running = last !== null && last.status === 'running' ? last : null;
    const quietMs = session.lastEventAt === null ? 0 : Math.max(0, now - session.lastEventAt);

    const stalled = running !== null && quietMs > STALL_MS;
    const waiting =
      this.fromClaude && session.active && running === null && last !== null && last.status !== 'failed';
    const settledLocally = !this.fromClaude && running === null && quietMs >= LOCAL_IDLE_MS;

    return {
      session,
      running,
      // `running.label` and `currentLabel` agree while something is running; the
      // call is kept for the case only it can answer — the honest word for the
      // gap between two tool calls. Once the session has settled, `currentLabel`
      // returns null and the last step's own label is what is still true, which
      // is also what the strip fades out on.
      label: running ? running.label : waiting ? currentLabel(session) : (last?.label ?? null),
      waiting,
      fromClaude: this.fromClaude,
      live: session.active && last !== null && !stalled && !settledLocally,
      stalled,
    };
  }
}

function same(a: ClaudeSessionView, b: ClaudeSessionView): boolean {
  return (
    a.session === b.session &&
    a.running === b.running &&
    a.label === b.label &&
    a.waiting === b.waiting &&
    a.fromClaude === b.fromClaude &&
    a.live === b.live &&
    a.stalled === b.stalled
  );
}

/* -------------------------------------------------------------------------- */
/* Payload guards                                                              */
/* -------------------------------------------------------------------------- */

const ACTIVITY_KINDS: ReadonlySet<string> = new Set<ActivityKind>([
  'reading',
  'editing',
  'building',
  'snapshotting',
  'arranging',
  'sharing',
  'other',
]);

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

/**
 * Parses a `claude.activity` payload, or refuses it.
 *
 * This is JSON off a wire, and the reducer trusts `kind` enough to look a label
 * up by it — an unrecognised kind would produce a step whose label is
 * `undefined`, which is a lie rendered as a blank. Anything that does not match
 * the published shape is dropped rather than guessed at.
 */
function asActivity(payload: unknown): ClaudeActivity | null {
  const body = asRecord(payload);
  const { callId, phase, kind } = body;
  if (typeof callId !== 'string' || callId === '') return null;
  if (phase !== 'started' && phase !== 'finished') return null;
  if (typeof kind !== 'string' || !ACTIVITY_KINDS.has(kind)) return null;

  const target = typeof body.target === 'string' && body.target.trim() !== '' ? body.target : null;
  return {
    callId,
    phase,
    kind: kind as ActivityKind,
    tool: typeof body.tool === 'string' ? body.tool : '',
    title: typeof body.title === 'string' ? body.title : '',
    target,
    at: typeof body.at === 'string' ? body.at : '',
    ...(typeof body.ok === 'boolean' ? { ok: body.ok } : {}),
    ...(typeof body.error === 'string' ? { error: body.error } : {}),
  };
}

/* -------------------------------------------------------------------------- */
/* The hook                                                                    */
/* -------------------------------------------------------------------------- */

const watchers = new WeakMap<StoreApi<StudioStore>, SessionWatcher>();

function watcherFor(store: StoreApi<StudioStore>): SessionWatcher {
  const existing = watchers.get(store);
  if (existing) return existing;
  // Inert until something subscribes: constructing it installs nothing.
  const created = new SessionWatcher(store);
  watchers.set(store, created);
  return created;
}

const getServerView = (): ClaudeSessionView => IDLE_VIEW;

/**
 * The current Claude sequence. Safe to call from any number of components: they
 * all read the same watcher, and the same session.
 */
export function useClaudeSession(): ClaudeSessionView {
  const watcher = watcherFor(useStudioApi());
  return useSyncExternalStore(watcher.subscribe, watcher.getView, getServerView);
}
