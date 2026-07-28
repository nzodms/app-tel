# What is real, what is simulated, what is not built

The honest inventory. Written so that nothing in PhoneLab has to be taken on trust.

Verification: `npm run verify` (lint + typecheck + 98 unit tests) and
`node scripts/verify-e2e.mjs <url>` (69 end-to-end checks against a running server)
both pass. A browser pass with Playwright additionally confirms the studio renders,
the previews run, and the cross-device flow works.

---

## Real — implemented and verified

### Accounts and projects
- Email + password accounts. scrypt hashing, signed HTTP-only session cookies.
- A personal workspace on signup; workspace roles (`owner`/`admin`/`editor`/`viewer`)
  mapped to capabilities.
- Projects created from templates, with files, canvas devices, an initial snapshot
  and (for PadelFlow) a second version and a recorded journey.
- Cross-tenant access returns 404, not 403.

### Files and code
- Full working tree with soft deletes. Create, read, write, rename, delete, search
  (substring or regex, with line and column).
- Optimistic concurrency: saving a file Claude changed underneath you is rejected
  with an actionable message rather than silently clobbering.
- Monaco editor served from our own origin (no CDN), with tabs, dirty tracking,
  ⌘S, optional minimap, diagnostics inline, and a diff view for comparisons.
- Limits enforced in the service layer, so REST and MCP cannot diverge.

### Preview
- Real compilation with esbuild over a virtual filesystem; real execution in a
  sandboxed iframe. Navigation, forms, session state, per-role rendering all work.
- Build failures surface as diagnostics with file, line and column — in the studio,
  inside the phone, and through MCP.
- Runtime exceptions inside a preview are captured and logged with the device and
  screen they happened on.
- Successful builds are content-hashed and cached.

### Canvas and phones
- Pan, zoom (buttons, ⌘-scroll, pinch, keyboard), drag, multi-select drag, snap with
  alignment guides, even-spacing snap, align, distribute, tidy, fit-all, focus.
- Dragging a phone does not reload its preview — verified in a browser test that
  asserts app state survives the drag.
- Six presets drawn from geometry with CSS and SVG. iPhone 17 Pro is the reference:
  402×874 pt, 62 pt display radius, 4.5 pt bezel, Dynamic Island 125×36.5 pt at 11 pt,
  59/34 pt safe areas, five side buttons at measured offsets.
- Status bar with a live clock and controllable signal/wifi/battery; Dynamic Island
  with compact, notification, activity, timer, call, payment and delivery states;
  notification banners; system permission sheets; a simulated keyboard that also
  reserves layout space inside the app.

### Multi-device
- Per-device role, simulated user, pinned version, theme, locale, network condition
  and edge-case flags.
- Cross-device events with server-assigned ordering, routed by role, device id, or
  broadcast.
- Shared state across phones (the simulated common backend).
- Badges and notifications raised by the app on the correct device.

### Versions
- Snapshots are full copies, so restore is exact.
- Restore rewrites the working tree, brings back deleted files, removes files added
  since — and always takes a safety snapshot first, so it is itself undoable.
- Comparison of any two versions (or a version against the working tree): changed
  files with line counts, and a full line diff per file.
- Two phones can run two different versions side by side, with optional mirrored
  navigation.

### Journeys
- Recording captures taps, text entry, navigation and cross-device events with real
  inter-step timings.
- Replay drives the actual phones, step by step, at 0.25×–4×, and writes a per-step
  report the studio and MCP can both read.

### Edge Case Studio
- 14 switches across connection, failures, data, permissions, presentation and
  account state. Each is labelled with the layer that produces it: `network`
  (simulated connection), `chrome` (drawn by PhoneLab), `app` (read by the project
  through `useFlag()`), `device` (configuration).
- Applied per phone or to all of them, so several states can be compared at once.

### Sharing and comments
- Links pinned to a version, with read or comment access, and public, password or
  email-restricted visibility. Revocation and expiry are immediate.
- The reviewer surface serves the compiled bundle and nothing else: no file tree, no
  file contents, no project API.
- Comments are anchored to version + role + screen + normalised coordinates + the
  element's source location, and the owner can reply, resolve, convert to a task, or
  copy a ready-made prompt.

### MCP
- Streamable HTTP at `/api/mcp`, spec revision 2025-11-25 (2025-06-18 and 2025-03-26
  also accepted).
- Full OAuth 2.1: RFC 9728 protected-resource metadata (both well-known forms), RFC
  8414 AS metadata, RFC 7591 dynamic client registration, authorization code with
  mandatory PKCE `S256`, exact redirect-URI matching, refresh rotation, RFC 8707
  audience binding validated on every request.
- 52 tools covering projects, files, preview, devices, versions, journeys and
  sharing. Destructive tools require `confirm: true`.
- Every call rate-limited and written to an audit log the studio shows live.
- Verified end to end: an MCP `apply_patch` lands in the working tree, is attributed
  to Claude, triggers a rebuild, and appears in the studio without a refresh.

### Realtime
- Server-Sent Events per project with `Last-Event-ID` replay. No polling.

---

## Simulated — deliberately, and labelled as such in the UI

These behave consistently and are useful, but they are models, not the real thing.

| Thing | What is actually happening |
| --- | --- |
| **Network conditions** | `useNetwork().request()` adds latency or rejects with an offline error. No traffic shaping, no real request interception. |
| **Shared state between phones** | An in-memory map in the studio tab, broadcast to the frames. It is a stand-in for a backend, not a database; it resets on reload and is per-tab. |
| **Notifications and Dynamic Island** | Drawn by PhoneLab in response to SDK calls. No OS notification system is involved. |
| **Status bar** | Clock is real; signal, wifi and battery are controllable values. |
| **Permission sheets** | PhoneLab's own dialogs. Allowing one clears the corresponding edge-case flag, so the app genuinely takes the other branch — but no browser permission is requested. |
| **`capture_device`** | Returns a *structural* snapshot (route, visible text, available actions) read from live DOM. It is not an image. |
| **Demo data** | PadelFlow's courts and slots are fixed, not random, so journeys replay identically. |

---

## Not built — and what it would take

| Missing | Notes |
| --- | --- |
| **Cloud sandbox (preview level 2)** | The `PreviewDriver` seam exists; no implementation. Today a project may import `react`, `react-dom` and `@phonelab/app` only — there is no `npm install`, and an unknown import fails with an explicit message rather than silently. |
| **React Native / Expo Router** | The runtime is React-DOM-shaped (preact/compat). `expo-rnw` exists in the schema as a platform value but is not selectable. Supporting it means adding React Native Web to the runtime shell and a matching template. |
| **TypeScript type checking** | esbuild strips types without checking them. `get_type_errors` says so explicitly and returns `typeCheckingPerformed: false`. Real checking needs `tsc` in a worker. |
| **Multi-instance deployment** | The realtime bus, the studio-RPC bridge, the rate limiter and the bundle cache are all in-process. Correct on one node; a second node needs a broker (Supabase Realtime or Redis) behind the same interfaces. |
| **Supabase Auth / Storage / Realtime** | Supabase is used as Postgres only. Auth is first-party (needed anyway, since PhoneLab is its own OAuth authorization server for MCP). |
| **Screenshots and video** | No rasterisation anywhere. Comments carry coordinates and source refs, not images. |
| **MCP App (interactive UI inside Claude)** | Not attempted. The tool layer is separated from the transport, so it is a surface to add rather than a rewrite. |
| **Git import / sync** | No GitHub import, branches or merges. Versions are snapshots, deliberately. |
| **Autonomous AI testers** | Journeys are deterministic and explicit. `run_journey` is the hook an agent would drive; nothing controls a mouse heuristically. |
| **Native builds, Expo Go, TestFlight, App Store** | Out of scope for V1. |
| **Billing, credits, template marketplace** | Not present. There is no `ANTHROPIC_API_KEY` — users bring their own Claude subscription. |
| **Real-time multiplayer editing** | Two people in one project will each see the other's committed changes through the realtime stream, but there is no presence, no cursors and no operational transform. |

---

## Known rough edges

- **`run_journey` over MCP needs an open studio tab.** The phones only exist in a
  browser. The tool registers the run, waits, and reports plainly if nothing picked
  it up. Same for `capture_device` and `refresh_devices`.
- **The local storage driver is single-process.** Correct and durable there;
  wrong for horizontal scaling. The driver is chosen at boot and logged.
- **Version storage is not deduplicated.** Every snapshot is a full copy of every
  file. Fine at this scale, wasteful at a much larger one.
- **Rename does not rewrite imports.** The tool says so; use `search_code` and patch.
- **The studio is desktop-only.** No responsive layout below ~1100px, by design.
- **Landscape is supported but less polished than portrait**, particularly cutout
  placement on Android presets.
