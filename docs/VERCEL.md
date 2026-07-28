# Deploying PhoneLab to Vercel

Written after a production incident: sign-up returned
`"Something went wrong on our side."` on every attempt, and nothing in the
response or the logs mentioned storage. This page is the checklist that would
have prevented it.

---

## What went wrong, so it is not repeated

`getStore()` ended in an unconditional fallback:

```ts
if (supabaseConfigured) { … } else {
  new LocalStore(path.join(process.cwd(), '.phonelab-data'))   // ← the bug
}
```

On Vercel, `process.cwd()` is inside the Lambda bundle, which is **read-only**.
The first write of the first sign-up threw `EROFS`, the route's catch-all turned
it into an anonymous 500, and every write path in the product failed the same
way. A deployment with no `SUPABASE_*` variables looked healthy — it served
pages, it served the sign-up form, and it could not create a single account.

Two things now make that impossible:

1. **No silent fallback.** In production, or anywhere `VERCEL` is set, a missing
   database is a startup error naming the variables, not a fallback. Even
   `PHONELAB_STORE=local` is refused there unless `PHONELAB_ALLOW_LOCAL_STORE=1`
   says the data is genuinely disposable.
2. **`GET /api/health`** answers "can this deployment work?" without reading
   source: the live driver, whether the database answers, whether the migrations
   are current. It never returns a URL or a key.

---

## Required environment variables

Set these in **Settings → Environment Variables → Production** (and Preview, if
previews should work). Adding a variable does **not** change deployments that
already exist — redeploy afterwards.

| Variable | Required | What it is |
| --- | --- | --- |
| `SUPABASE_URL` | **yes** | `https://<project>.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | **yes** | Service-role key. Server-only. Never in a `NEXT_PUBLIC_*` variable. |
| `PHONELAB_BASE_URL` | recommended | The public origin, no trailing slash. Base for the MCP connector URL, the OAuth issuer, and the RFC 8707 resource identifier tokens are bound to. Derived from forwarded headers when unset, which is fine until you add a custom domain. |
| `PHONELAB_STORE` | no | Force a driver. `supabase` or `local`. |
| `PHONELAB_ALLOW_LOCAL_STORE` | no | `1` permits throwaway file storage in production. |

There is deliberately **no** `ANTHROPIC_API_KEY`, and no `AUTH_SECRET` /
`NEXTAUTH_SECRET` / `SESSION_SECRET`: PhoneLab does not call a model API, and its
sessions are opaque random tokens stored as SHA-256 hashes, so there is no
signing key to configure.

Values are trimmed and unquoted before use, and a whitespace-only value counts as
unset — a trailing newline from a dashboard paste fails loudly at boot instead of
quietly later.

---

## Migrations

```bash
psql "$DATABASE_URL" -f supabase/migrations/0001_init.sql
psql "$DATABASE_URL" -f supabase/migrations/0002_onboarding.sql
```

Both are additive and safe to re-run. `0002` adds the onboarding and preference
columns; without it every read of `users` fails and `/api/health` reports
`migrationsCurrent: false` with the file to apply.

---

## Verifying a deployment

```bash
curl -s https://<deployment>/api/health | jq
node scripts/smoke-production.mjs https://<deployment>
```

`/api/health` returns 200 when usable and 503 when not:

```json
{
  "status": "ok",
  "environment": "production",
  "databaseConnected": true,
  "storageDriver": "postgres",
  "migrationsCurrent": true,
  "authConfigured": true
}
```

The smoke test runs the whole journey against the deployed URL — sign up,
session, onboarding, workspace, project, dashboard, sign out, sign back in, data
still present. It **refuses to run against localhost** without `--allow-local`,
because a green localhost run being mistaken for a working deployment is exactly
how the incident above reached a user.

---

## Reading a failure

Every 5xx carries a reference (`PL-XXXXXXXX`) in both the response body and the
matching log line, so a screenshot is enough to find the request in Vercel's
Runtime Logs. Sign-up emits one structured line per step:

```
signup.request_received → signup.validation_passed → signup.storage_resolved
  → signup.auth_user_created → signup.workspace_created
  → signup.profile_created → signup.session_created
```

A failure logs `signup.failed` with `failedAfterStep`, the error type, its code
(`EROFS`, `42P01`, …), the cause chain and the elapsed time. Passwords, tokens,
cookies and keys are redacted by key name before serialisation.

Error codes a client can branch on: `validation_failed`, `conflict`,
`rate_limited`, `storage_unavailable`, `schema_missing`, `configuration_error`,
`internal`. The first three are the caller's to fix; the middle three are the
operator's and return 503 so a probe treats the instance as unhealthy.
