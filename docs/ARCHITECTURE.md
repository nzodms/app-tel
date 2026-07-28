# Architecture

How PhoneLab is put together, and why each piece is the way it is.

---

## The shape of it

```
Browser (studio)                          Server (Next.js, Node runtime)
┌──────────────────────────┐              ┌────────────────────────────────┐
│ Left column 25%          │   REST       │ app/api/*        route handlers│
│  Files · Code · Logs     │◄────────────►│ services/*       domain logic  │
│  Versions · Claude       │              │ db/*             storage       │
├──────────────────────────┤   SSE        │ realtime/bus     fan-out       │
│ Canvas 75%               │◄─────────────│                                │
│  ┌────────┐ ┌────────┐   │              │ preview/bundler  esbuild       │
│  │ iframe │ │ iframe │   │              │ mcp/*            tools         │
│  │sandbox │ │sandbox │   │              │ oauth/*          OAuth 2.1 AS  │
│  └────────┘ └────────┘   │              └────────────────────────────────┘
│  postMessage bridge      │                            ▲
└──────────────────────────┘                            │ Streamable HTTP
                                                        │ + Bearer
                                                   Claude (MCP client)
```

One rule holds the whole thing together: **the domain services are the only place
that changes anything.** REST routes and MCP tools are both thin adapters over
`src/server/services/*`. That is why a file edited by Claude and a file edited in
the editor produce identical audit trails, identical realtime events, and identical
limit enforcement — there is no second code path to keep in sync.

---

## Storage

`src/server/db/store.ts` defines a small query contract. Two drivers implement it:

**`LocalStore`** — one JSON document under `.phonelab-data/`. Every operation goes
through a promise queue, so operations are strictly serialised; `transaction()` runs
its callback while holding that queue and flushes once, atomically (temp file +
rename). This is a real driver, not a mock: restart the server and your projects are
still there. It is correct for one process.

**`SupabaseStore`** — Postgres, using the service-role key from server code only.
TypeScript rows are camelCase, columns are snake_case, and the conversion is
algorithmic — adding a field means editing `schema.ts` and the migration, nothing
else. The REST API has no multi-statement transaction, so `transaction()` runs the
callback directly; invariants that must hold regardless are expressed as constraints
in `supabase/migrations/0001_init.sql`.

The driver is resolved once per process and cached on `globalThis` — Next evaluates
server code in several module instances, and a module-level cache would produce
several stores with drifting in-memory state.

---

## The two-layer preview

### Layer A — the runtime shell

Built ahead of time by `scripts/build-preview-runtime.mjs` into
`src/generated/preview-runtime.ts`: React (via `preact/compat`), the
`@phonelab/app` SDK, and the postMessage bridge, in ~39 kB.

It is emitted as a **string**, not a served asset, and inlined into the sandboxed
host document. The preview frame runs with `sandbox="allow-scripts"` and therefore
lives on an opaque origin — it *cannot* fetch a script from PhoneLab's origin, and
it should not be able to. Inlining lets the frame's CSP stay at
`script-src 'unsafe-inline' blob:` with `connect-src 'none'`: the frame needs no
network access at all.

### Layer B — the project bundle

Compiled per request by `src/server/preview/bundler.ts`: esbuild over a virtual
filesystem of the project's rows, with the runtime modules marked external and
resolved at run time through the shell's registry.

The important property: **esbuild parses and transforms, it never executes.** No
user code runs in the PhoneLab process. The output string is handed to the iframe
over postMessage, which evaluates it as a `blob:` script inside its own opaque
origin.

Two details earn their keep:

- `jsxDev: true` makes esbuild emit source locations on every JSX call. A
  `options.vnode` hook in the runtime copies them onto DOM nodes as `data-pl-src`.
  That is the whole implementation of click-in-the-phone → jump-to-code: no
  annotations in the user's components, works on any project.
- Successful builds are cached by a fingerprint of the exact sources, so opening a
  second tab or moving a phone triggers no work.

### Layer 2 — cloud sandbox

`PreviewDriver` in `src/server/services/preview.ts` is the seam a cloud sandbox
would implement (install dependencies, run commands, return a preview URL). Only
the browser driver exists today — see [STATUS.md](STATUS.md).

---

## The bridge

`src/lib/preview/protocol.ts` is the contract between the studio and the frames.

Because the frame is sandboxed without `allow-same-origin`, `event.origin` is the
string `"null"` and cannot authenticate anything. Instead:

- the studio mints a random nonce per device, before the iframe exists, and passes
  it in the frame URL;
- every message in both directions carries it;
- the studio also checks `event.source === iframe.contentWindow`.

Both halves must agree, so one frame cannot impersonate another, and nothing else
on the page can forge or read the channel.

The SDK a project imports (`@phonelab/app`) is a thin, honest wrapper over this:
`useDevice`, `useFlag`, `useRouter`, `useAppEvent` / `sendEvent`, `useSharedState`,
`notify`, `useNetwork().request`, `logEvent`.

---

## The canvas

Two rules, both about not re-rendering:

1. **Pan and zoom** write `transform` on a single wrapper element. Every phone moves
   together in one composited layer, with no React render. The zoom readout in the
   toolbar subscribes to an imperative handle rather than state.
2. **Dragging** writes `transform` on the dragged nodes only, straight to the DOM,
   coalesced into a `requestAnimationFrame`. React state and the server hear about
   it once, on pointer-up, as a single bulk position commit.

The iframes are never touched by either, which is why a preview keeps its state —
and never reloads — while you rearrange the canvas.

Snapping (`canvas/geometry.ts`, unit-tested) aligns left/centre/right and
top/middle/bottom edges, plus even spacing against an existing gap. The threshold is
in *screen* pixels divided by the zoom, so it never fights the pointer when zoomed
in, and alt disables it entirely.

Gestures follow existing conventions: two-finger scroll pans, ⌘/ctrl-scroll and
pinch zoom about the cursor, space or middle-drag pans from anywhere. Dragging the
chassis or the label above a phone moves it; the screen belongs to the app, because
pointer events there go to the iframe and never reach the canvas.

---

## Devices, roles and cross-device events

A device row is *configuration*: preset, orientation, role, simulated user, pinned
version, theme, locale, edge-case flags, position. The running preview is transient
and lives in the browser. That separation is what makes a phone draggable without
its preview reloading, and what lets two phones run two different versions.

An event emitted by one phone travels: preview → studio → matching target devices
(by role, device id, or all) → and, in parallel, to the server, which assigns a
monotonic sequence number and broadcasts it. Ordering is server-assigned, which is
what makes journey replay deterministic instead of dependent on which tab was
fastest.

Shared state (`useSharedState`) is the simulated common backend: writes apply
locally, then broadcast to the other phones.

---

## Realtime

`src/server/realtime/bus.ts` is an in-process publish/subscribe with a small ring
buffer, fed to browsers over Server-Sent Events at `/api/realtime`. `Last-Event-ID`
replay means a dropped connection catches up rather than silently missing events.
No polling anywhere.

`src/server/realtime/rpc.ts` inverts it: some MCP tools need something only a
browser can do (read what a phone is showing, reload the frames). The server
publishes a request, an open studio answers it over REST, and the pending tool call
resolves. If no studio is open, the tool says so plainly rather than inventing a
result.

---

## MCP

- **Transport** — Streamable HTTP at `/api/mcp`, spec revision 2025-11-25. POST
  accepts one JSON-RPC message and answers with `application/json`; notifications
  get 202; GET returns 405 (no server-initiated stream); no session id is issued, so
  the endpoint is stateless and every request stands alone. `Origin` is validated
  when present; `MCP-Protocol-Version` is validated.
- **Authorization** — PhoneLab is its own OAuth 2.1 authorization server: RFC 9728
  protected-resource metadata (both well-known forms), RFC 8414 AS metadata, RFC
  7591 dynamic client registration, authorization code with mandatory PKCE `S256`,
  exact redirect-URI matching, refresh-token rotation, and RFC 8707 resource
  indicators validated as the token audience on every request. Tokens are opaque and
  stored only as SHA-256 hashes.
- **Tools** — declared with Zod; the JSON Schema in `tools/list` is generated from
  the same schema that validates the arguments, so the advertised contract and the
  enforced one cannot drift.
- **The runner** (`mcp/runner.ts`) is the single path every call takes: validate →
  rate limit → destructive-confirmation gate → handler → audit. One place to read
  rather than 52.

---

## Authorization

`src/server/services/access.ts` defines one vocabulary — `read`, `write`,
`execute`, `share`, `admin` — used by the UI and by MCP.

For an MCP actor the effective capabilities are the **intersection** of the member's
workspace role and the scopes on the token. A connector can never do something the
person who authorised it could not do themselves. Cross-tenant reads return 404
rather than 403, so project existence is not leaked.

---

## Security posture

| Concern | Measure |
| --- | --- |
| User code execution | Only inside `sandbox="allow-scripts"` (opaque origin). esbuild parses but never executes. |
| Preview isolation | Strict CSP: no network, no same-origin, no external scripts. Runtime inlined. |
| Frame spoofing | Per-device nonce + `event.source` check, both required. |
| Reviewer surface | Serves the compiled bundle only — no tree, no file contents, no project API. |
| Secrets | Passwords and share passwords: scrypt. Session, OAuth and share tokens: SHA-256 hashes only. |
| Token misuse | Audience-bound (RFC 8707), revocable per connection, scope-limited, short-lived access tokens with rotating refresh. |
| Destructive actions | `confirm: true` required; deletes are soft; restores snapshot first. |
| Abuse | Size limits on files, projects, comments and responses; sliding-window rate limits on tool calls and reviewer comments. |
| Audit | Every MCP call recorded with redacted arguments, outcome and duration. |

Known limits are in [STATUS.md](STATUS.md) — including which of these are
single-node only.

---

## Templates

Templates live under `templates/` as real, readable `.tsx` files rather than escaped
string literals, and are compiled into `src/generated/templates.ts` by
`npm run gen`. PadelFlow additionally ships a `padelflow-v2` overlay, applied on top
of V1 at creation time so that version comparison has a genuine diff on day one, and
a recorded journey so replay works immediately.

A third template, `blueprint`, is the base the project generator builds on. It is a
complete four-role app that reads every name, event and demo record from
`src/lib/config.ts` — a file it deliberately does *not* ship. The template is marked
`hidden` (kept out of the picker) and `requiresGeneratedFiles`, so `createProject`
refuses it rather than laying down a project that cannot compile.

---

## Onboarding and project generation

Two facts drive the routing:

- `users.onboardingCompletedAt` is the *only* signal that someone has been shown
  around. It is never inferred from owning a project — a project can exist because
  the demo was created, because a workspace was shared, or because Claude made one
  over MCP. Treating "has a project" as "is onboarded" is exactly the bug that made
  onboarding unreachable in the first place.
- `landingPathFor(user)` in `src/server/services/onboarding.ts` is the single
  function `/`, `/app` and the auth pages call. Three separate redirect rules would
  eventually disagree and bounce someone between them.

Progress is written to `onboardingStep` and `onboardingDraft` on every step, merged
rather than replaced, so a step only has to send its own fields and a reload resumes
where the person was. A malformed draft parses back to an empty one — a draft is a
convenience, never a gate.

The last step calls `createGeneratedProject`, which is also what `/projects/new`
calls. It resolves the brief's category to a `CategoryVocabulary` entry, generates
`src/lib/config.ts` and `app.json`, lays them over the blueprint template, and hands
the result to the ordinary `createProject` path — so a generated project gets the
same files, devices, snapshot and journey treatment as any other, and the two entry
points cannot produce different results for the same answers.

The category → vocabulary mapping is a lookup table, not a language model: PhoneLab
does not call an API to scaffold a project, and the generated file's header says as
much. The claim being made is "here is a coherent starting point in your vocabulary",
not "here is your app".

`UserPreferences` lives in `src/lib/preferences.ts` rather than in the database
schema, and `src/server/db/schema.ts` re-exports it. That looks like an odd place for
it until you try the other way round: the studio store reads the defaults on the
client, and importing a value out of `@/server/db` drags the local-store driver — and
`node:fs` — into the browser bundle.
