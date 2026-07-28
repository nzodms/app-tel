# The PhoneLab MCP connector

PhoneLab exposes a remote [Model Context Protocol](https://modelcontextprotocol.io)
server so Claude can work on your projects — using **your** Claude subscription.
PhoneLab provides the workshop; Claude decides when to reach for a tool.

The running app serves a live version of this page at `/docs/mcp`, generated from
the server's own tool registry.

---

## Transport

| | |
| --- | --- |
| Endpoint | `<origin>/api/mcp` |
| Transport | Streamable HTTP |
| Protocol revision | `2025-11-25` (also accepts `2025-06-18`, `2025-03-26`) |
| Content type | `application/json` |
| Sessions | None issued — the server is stateless |

Behaviour, and where it comes from in the specification:

- **POST** carries exactly one JSON-RPC 2.0 message. A *request* gets a single JSON
  object back; a *notification* gets `202 Accepted` with no body. Batching was
  removed in this revision and is rejected with a clear error.
- **GET** returns `405 Method Not Allowed`, which the spec defines as "this server
  does not offer an SSE stream at this endpoint". Nothing here needs
  server-initiated messages.
- **DELETE** returns `405`. No session ids are issued, so there is nothing to
  terminate — the spec makes session ids optional.
- The `Origin` header is validated when present and answered with `403` if it is not
  allowed (DNS-rebinding protection).
- `MCP-Protocol-Version` is validated; an unsupported value is `400`.

---

## Authorization

PhoneLab is its own OAuth 2.1 authorization server for this resource.

| Endpoint | Path |
| --- | --- |
| Protected resource metadata (RFC 9728) | `/.well-known/oauth-protected-resource` and `/.well-known/oauth-protected-resource/api/mcp` |
| Authorization server metadata (RFC 8414) | `/.well-known/oauth-authorization-server` |
| Dynamic client registration (RFC 7591) | `/api/oauth/register` |
| Authorization | `/oauth/authorize` |
| Token | `/api/oauth/token` |

What is enforced:

- Authorization code with **mandatory PKCE `S256`**. No implicit grant, no `plain`.
- **Exact** redirect-URI matching. https, loopback http, and custom schemes are
  accepted at registration; anything else is refused, as are fragments.
- An invalid `client_id` or `redirect_uri` is shown to the *user* and never
  redirected, so the authorize endpoint cannot be used as an open redirector.
- Authorization codes are single-use and expire in 60 seconds. A replayed code
  revokes every token that grant produced.
- **RFC 8707 resource indicators.** The `resource` must identify this server, and
  every access token records the audience it was minted for. A token issued for a
  different resource is rejected — this is the confused-deputy mitigation.
- Refresh tokens rotate; presenting a retired one is refused.
- Tokens are opaque and stored only as SHA-256 hashes.
- Revoking a connection in the dashboard invalidates its tokens immediately.

### Adding it to Claude

1. Copy the connector URL from your PhoneLab dashboard.
2. Add it in Claude as a custom connector.
3. Claude registers itself and sends you to PhoneLab's consent screen. Uncheck any
   scope you do not want to grant.
4. Ask Claude to open one of your projects by name.

The server has to be reachable from the public internet. To test locally, mint a
**personal access token** on the dashboard and use it as a bearer token with MCP
Inspector or `curl` — the same validation path, the same scopes, the same audit
trail.

```bash
curl -sS https://your-phonelab/api/mcp \
  -H 'Content-Type: application/json' \
  -H 'MCP-Protocol-Version: 2025-11-25' \
  -H "Authorization: Bearer $PHONELAB_TOKEN" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

---

## Scopes

| Scope | Grants | Capabilities |
| --- | --- | --- |
| `projects.read` | List projects, browse the tree, read files, logs and versions | `read` |
| `projects.write` | Create, patch, rename and delete files; create snapshots | `read`, `write` |
| `preview.run` | Start/restart previews, read build output, drive devices and journeys | `read`, `execute` |
| `share.manage` | Create and revoke share links; act on reviewer comments | `read`, `share` |

A token can never exceed the permissions of the person who authorised it: the
effective capabilities are the **intersection** of the member's workspace role and
the scopes on the token.

---

## Tools

52 tools. Every one validates its arguments against the same Zod schema that
generates the JSON Schema in `tools/list`, so the advertised contract and the
enforced contract cannot drift.

### Projects
`list_projects` · `get_project` · `create_project` · `update_project` ·
`duplicate_project` · `archive_project`¹ · `list_templates`

### Files and code
`list_files` · `read_file` · `read_files` · `search_code` · `apply_patch` ·
`write_file` · `create_file` · `rename_file` · `delete_file`¹

`apply_patch` is the intended way to change code: exact find/replace edits, where
each `find` must match exactly once unless `replaceAll` is set. An ambiguous edit
fails loudly instead of guessing, and there is never a reason to resend a whole file
to change one component.

### Preview and execution
`start_preview` · `stop_preview` · `restart_preview` · `get_preview_status` ·
`get_build_logs` · `get_runtime_errors` · `get_type_errors` · `refresh_devices`

`get_type_errors` reports esbuild diagnostics — syntax and imports — and returns
`typeCheckingPerformed: false`, because esbuild strips types without checking them.
An empty result does not mean the types are correct.

### Devices
`list_devices` · `create_device` · `update_device` · `assign_device_role` ·
`set_device_user` · `set_device_state` · `send_device_event` · `capture_device` ·
`remove_device`¹

`capture_device` returns a structural snapshot — route, visible text, available
actions — read from the live DOM. It is not an image, and it needs an open studio
tab, because that is the only place the phones exist.

### Versions
`create_snapshot` · `list_versions` · `get_version` · `rename_version` ·
`restore_version`¹ · `duplicate_version` · `compare_versions`

### Journeys
`create_journey` · `update_journey` · `list_journeys` · `run_journey` ·
`pause_journey` · `stop_journey` · `get_journey_report` · `compare_journeys`

`run_journey` registers a run and waits for the report. Replay happens in an open
studio tab; if none is open, the tool says so rather than reporting a phantom
success.

### Sharing and feedback
`create_share_link` · `list_share_links` · `revoke_share_link`¹ · `list_comments` ·
`get_comment` · `reply_to_comment` · `resolve_comment` · `create_task_from_comment`

¹ Destructive: refuses to act unless called with `confirm: true`. The first call
explains what would happen.

---

## Limits and safeguards

| Limit | Value |
| --- | --- |
| Tool calls | 120 per connection per minute |
| Single file | 512 kB |
| Project working tree | 8 MB, 400 files |
| Read response | 200 kB (truncated with a marker) |
| Devices per project | 12 |
| Versions per project | 200 |
| Journey steps | 200 |
| Comment body | 4 000 characters |

Beyond the numbers:

- Destructive tools need explicit confirmation.
- File deletes are **soft** — any snapshot restores them.
- Version restore always snapshots the current state first, so it is undoable.
- Every call is written to an audit log with redacted arguments (file bodies are
  elided, anything secret-shaped is `[redacted]`), the outcome and the duration. The
  studio's Claude panel is a live view of it.

---

## A typical session

```
list_projects                       → find the project id
get_project                         → roles, devices, versions, build status
search_code   "Confirm and pay"     → locate the component
read_file     src/player/…/Review.tsx
apply_patch   …                     → one targeted edit, returns a unified diff
start_preview                       → confirm it still compiles
create_snapshot "V3 · shorter checkout"
create_share_link                   → send it to a reviewer
list_comments                       → pick their feedback back up
```

Everything in that sequence appears live in an open studio: the tree, the editor,
the phones, the logs, the timeline and the Claude activity feed.
