# Deploying PhoneLab

---

## Requirements

- **Node runtime.** Previews are compiled server-side with esbuild, which is a
  native binary. Edge runtimes will not work; `esbuild` is declared in
  `serverExternalPackages` so it stays a real module rather than being bundled.
- **A public origin**, if you want Claude to connect. Claude reaches your MCP
  endpoint over the internet; a laptop behind NAT will not do.

---

## Configuration

Copy `.env.example` to `.env.local` (or set the variables in your platform).

### `PHONELAB_BASE_URL` — set this in production

```
PHONELAB_BASE_URL=https://phonelab.example.com
```

It is the OAuth issuer, the base for the connector URL, and the **resource
identifier that every access token is bound to** (RFC 8707). If it does not match
the origin Claude actually calls, tokens are rejected with
`invalid_token: this token was not issued for this MCP server` — which is the check
doing its job.

No trailing slash. Left unset, PhoneLab derives the origin from the request's
forwarded headers, which is right locally and risky behind an unusual proxy.

### Storage

**Single node** (a container, a VM, one Fly machine): nothing to configure. The
file-backed driver writes to `PHONELAB_DATA_DIR` (default `./.phonelab-data`).
Mount that path on a persistent volume, or the data goes with the container.

**Postgres**, for anything larger:

```
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=...
```

Apply the migration first:

```bash
psql "$DATABASE_URL" -f supabase/migrations/0001_init.sql
# or: supabase db push
```

The service-role key is read by server code only, behind PhoneLab's own
authorisation checks. RLS is enabled and denies by default on every table, so an
accidentally-exposed anon key reads nothing.

The driver is chosen at boot and logged (`[phonelab] storage driver: …`), so it is
never a mystery which one is live. `PHONELAB_STORE=local|supabase` forces it.

---

## Build and run

```bash
npm ci
npm run build     # runs codegen (templates + preview runtime) and copies Monaco
npm start
```

`npm run build` depends on `npm run gen`, which regenerates
`src/generated/templates.ts` and `src/generated/preview-runtime.ts`. Both are
committed, so a CI build without codegen still works — but rerun `npm run gen` after
editing anything under `templates/` or `src/preview/runtime/`.

Monaco is copied from `node_modules` into `public/monaco` at build time (about
24 MB) so the editor loads from your own origin. No CDN, and no CSP allowance for
one.

### Vercel

Works with the Node runtime. Two things to know:

- Every route that touches the store or esbuild already declares
  `runtime = 'nodejs'`.
- The realtime bus, the studio-RPC bridge, the rate limiter and the bundle cache are
  **in-process**. On a platform that runs several instances, an SSE stream may be
  attached to a different instance than the one that published an event, so live
  updates become unreliable and `capture_device` / `run_journey` may not find a
  studio. Until a broker is wired behind those interfaces (see
  [STATUS.md](STATUS.md)), prefer a single long-lived instance: a container, Fly,
  Railway, Render, or a VM.

### Docker

```dockerfile
FROM node:22-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app ./
EXPOSE 3000
VOLUME ["/app/.phonelab-data"]
CMD ["npm", "start"]
```

---

## After deploying

1. Sign up, create the PadelFlow project, confirm the phones render and the booking
   flow crosses between them.
2. Run the end-to-end suite against the deployment:
   ```bash
   node scripts/verify-e2e.mjs https://phonelab.example.com
   ```
   It creates a throwaway account and exercises project creation, the preview
   compile, MCP discovery and authorization, an MCP patch, snapshot/restore, the
   destructive-tool gate and the share/comment flow. 69 checks; non-zero exit on any
   failure.
3. Check the metadata Claude will read:
   ```bash
   curl https://phonelab.example.com/.well-known/oauth-protected-resource
   curl https://phonelab.example.com/.well-known/oauth-authorization-server
   ```
   The `resource` must be exactly `<your-origin>/api/mcp`.
4. Add the connector in Claude and ask it to list your projects.

---

## Operational notes

- **Backups.** Local driver: back up `.phonelab-data/phonelab.json` (writes are
  atomic — temp file + rename — so a copy is never torn). Postgres: whatever your
  provider offers.
- **Growth.** Versions are full snapshots, so storage grows with
  `versions × files × size`. The per-project cap is 200 versions.
- **Session and token lifetimes.** Studio sessions 30 days; OAuth access tokens
  1 hour; refresh tokens 30 days, rotating; personal access tokens 90 days by
  default. Expired rows are dropped lazily on access rather than by a cron.
- **Logs worth watching.** `[phonelab] storage driver: …` at boot, build failures,
  and the `mcp_audit_logs` table for anything a connector did.
