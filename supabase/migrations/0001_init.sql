-- PhoneLab schema.
--
-- Mirrors src/server/db/schema.ts one-for-one. TypeScript rows are camelCase and
-- Postgres columns are snake_case; the Supabase driver converts algorithmically, so
-- adding a field means editing the TypeScript type and this file — nothing else.
--
-- Access model: the application talks to Postgres with the service-role key and
-- enforces authorisation in src/server/services/access.ts, which is the single gate
-- for both the REST API and the MCP tools. RLS is still enabled on every table and
-- denies by default, so the anon/authenticated keys cannot read across tenants even
-- if one is ever exposed to a browser.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------- identity ----

create table if not exists users (
  id text primary key,
  email text not null unique,
  name text not null,
  password_hash text not null,
  password_salt text not null,
  avatar_hue integer not null default 210,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists sessions (
  id text primary key,
  token_hash text not null unique,
  user_id text not null references users (id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  user_agent text
);
create index if not exists sessions_user_idx on sessions (user_id);
create index if not exists sessions_expiry_idx on sessions (expires_at);

create table if not exists workspaces (
  id text primary key,
  name text not null,
  slug text not null,
  owner_id text not null references users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists workspace_members (
  id text primary key,
  workspace_id text not null references workspaces (id) on delete cascade,
  user_id text not null references users (id) on delete cascade,
  role text not null check (role in ('owner', 'admin', 'editor', 'viewer')),
  created_at timestamptz not null default now(),
  unique (workspace_id, user_id)
);
create index if not exists workspace_members_user_idx on workspace_members (user_id);

-- ------------------------------------------------------- projects and files ---

create table if not exists projects (
  id text primary key,
  workspace_id text not null references workspaces (id) on delete cascade,
  name text not null,
  slug text not null,
  description text not null default '',
  template_id text not null,
  platform text not null default 'web-react' check (platform in ('web-react', 'expo-rnw')),
  status text not null default 'active' check (status in ('active', 'archived')),
  active_version_id text,
  entry_file text not null,
  created_by text not null references users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, slug)
);
create index if not exists projects_workspace_idx on projects (workspace_id);

create table if not exists project_files (
  id text primary key,
  project_id text not null references projects (id) on delete cascade,
  path text not null,
  content text not null default '',
  size integer not null default 0,
  language text not null default 'plaintext',
  last_edited_by text not null default 'user' check (last_edited_by in ('user', 'claude', 'system')),
  last_edited_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Soft delete: what makes `delete_file` recoverable and version restore exact.
  deleted_at timestamptz,
  unique (project_id, path)
);
create index if not exists project_files_project_idx on project_files (project_id) where deleted_at is null;

-- ------------------------------------------------------------------ versions --

create table if not exists project_versions (
  id text primary key,
  project_id text not null references projects (id) on delete cascade,
  label text not null,
  description text not null default '',
  sequence integer not null,
  created_by text references users (id) on delete set null,
  author_kind text not null default 'user' check (author_kind in ('user', 'claude', 'system')),
  prompt_ref text,
  file_count integer not null default 0,
  parent_version_id text references project_versions (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (project_id, sequence)
);
create index if not exists project_versions_project_idx on project_versions (project_id);

create table if not exists version_files (
  id text primary key,
  version_id text not null references project_versions (id) on delete cascade,
  project_id text not null references projects (id) on delete cascade,
  path text not null,
  content text not null default '',
  language text not null default 'plaintext',
  unique (version_id, path)
);
create index if not exists version_files_version_idx on version_files (version_id);

-- ------------------------------------------------------------------- devices --

create table if not exists devices (
  id text primary key,
  project_id text not null references projects (id) on delete cascade,
  name text not null,
  preset_id text not null,
  orientation text not null default 'portrait' check (orientation in ('portrait', 'landscape')),
  role text not null,
  user_label text,
  version_id text references project_versions (id) on delete set null,
  x double precision not null default 0,
  y double precision not null default 0,
  z_index integer not null default 1,
  theme text not null default 'light' check (theme in ('light', 'dark')),
  locale text not null default 'en',
  network text not null default 'fast' check (network in ('fast', 'slow', 'offline')),
  state_flags text[] not null default '{}',
  scenario text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists devices_project_idx on devices (project_id);

-- ------------------------------------------------------------------ timeline --

create table if not exists device_events (
  id text primary key,
  project_id text not null references projects (id) on delete cascade,
  sequence integer not null,
  device_id text references devices (id) on delete set null,
  target_device_id text references devices (id) on delete set null,
  kind text not null,
  level text not null default 'info' check (level in ('debug', 'info', 'warn', 'error')),
  name text not null,
  payload jsonb not null default '{}'::jsonb,
  screen text,
  created_at timestamptz not null default now(),
  unique (project_id, sequence)
);
create index if not exists device_events_project_seq_idx on device_events (project_id, sequence desc);

-- ------------------------------------------------------- preview and builds ---

create table if not exists preview_sessions (
  id text primary key,
  project_id text not null references projects (id) on delete cascade,
  version_id text references project_versions (id) on delete cascade,
  status text not null check (status in ('starting', 'running', 'stopped', 'error')),
  bundle_hash text,
  started_at timestamptz not null default now(),
  stopped_at timestamptz,
  error text
);
create index if not exists preview_sessions_project_idx on preview_sessions (project_id);

create table if not exists build_runs (
  id text primary key,
  project_id text not null references projects (id) on delete cascade,
  preview_session_id text references preview_sessions (id) on delete set null,
  version_id text references project_versions (id) on delete set null,
  status text not null check (status in ('running', 'success', 'error')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  duration_ms integer,
  diagnostics jsonb not null default '[]'::jsonb,
  bundle_bytes integer,
  triggered_by text not null default 'user' check (triggered_by in ('user', 'claude', 'system'))
);
create index if not exists build_runs_project_idx on build_runs (project_id, started_at desc);

-- ----------------------------------------------------------------- journeys ---

create table if not exists journeys (
  id text primary key,
  project_id text not null references projects (id) on delete cascade,
  name text not null,
  description text not null default '',
  created_by text references users (id) on delete set null,
  author_kind text not null default 'user' check (author_kind in ('user', 'claude', 'system')),
  step_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists journeys_project_idx on journeys (project_id);

create table if not exists journey_steps (
  id text primary key,
  journey_id text not null references journeys (id) on delete cascade,
  project_id text not null references projects (id) on delete cascade,
  index integer not null,
  kind text not null,
  device_id text references devices (id) on delete set null,
  device_role text,
  label text not null default '',
  payload jsonb not null default '{}'::jsonb,
  wait_ms integer not null default 0,
  created_at timestamptz not null default now(),
  unique (journey_id, index)
);

create table if not exists journey_runs (
  id text primary key,
  journey_id text not null references journeys (id) on delete cascade,
  project_id text not null references projects (id) on delete cascade,
  status text not null check (status in ('running', 'paused', 'completed', 'failed', 'stopped')),
  current_step integer not null default -1,
  speed double precision not null default 1,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  report jsonb not null default '[]'::jsonb,
  error text
);
create index if not exists journey_runs_project_idx on journey_runs (project_id, started_at desc);

-- --------------------------------------------------------- sharing and notes --

create table if not exists share_links (
  id text primary key,
  project_id text not null references projects (id) on delete cascade,
  token text not null unique,
  version_id text references project_versions (id) on delete set null,
  access text not null default 'comment' check (access in ('read', 'comment')),
  visibility text not null default 'public' check (visibility in ('public', 'password', 'email')),
  password_hash text,
  password_salt text,
  allowed_emails text[] not null default '{}',
  allowed_roles text[] not null default '{}',
  allow_version_compare boolean not null default false,
  allow_journeys boolean not null default true,
  label text not null default '',
  expires_at timestamptz,
  revoked_at timestamptz,
  created_by text not null references users (id),
  created_at timestamptz not null default now(),
  view_count integer not null default 0,
  last_viewed_at timestamptz
);
create index if not exists share_links_project_idx on share_links (project_id);

create table if not exists comment_threads (
  id text primary key,
  project_id text not null references projects (id) on delete cascade,
  share_link_id text references share_links (id) on delete set null,
  version_id text references project_versions (id) on delete set null,
  device_id text references devices (id) on delete set null,
  preset_id text,
  role text,
  screen text,
  anchor_x double precision not null default 0.5,
  anchor_y double precision not null default 0.5,
  source_ref text,
  element_label text,
  preceding_action text,
  status text not null default 'open' check (status in ('open', 'resolved')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by text references users (id) on delete set null,
  task_title text
);
create index if not exists comment_threads_project_idx on comment_threads (project_id, status);

create table if not exists comments (
  id text primary key,
  thread_id text not null references comment_threads (id) on delete cascade,
  project_id text not null references projects (id) on delete cascade,
  author_kind text not null check (author_kind in ('owner', 'guest', 'claude')),
  author_name text not null,
  author_email text,
  body text not null,
  created_at timestamptz not null default now()
);
create index if not exists comments_thread_idx on comments (thread_id, created_at);

-- ------------------------------------------------------------ MCP and OAuth ---

create table if not exists mcp_connections (
  id text primary key,
  user_id text not null references users (id) on delete cascade,
  client_id text not null,
  name text not null,
  scopes text[] not null default '{}',
  last_used_at timestamptz,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  protocol_version text,
  tool_call_count integer not null default 0,
  unique (user_id, client_id)
);

create table if not exists mcp_audit_logs (
  id text primary key,
  user_id text references users (id) on delete cascade,
  project_id text references projects (id) on delete cascade,
  connection_id text references mcp_connections (id) on delete set null,
  tool text not null,
  args jsonb not null default '{}'::jsonb,
  result text not null check (result in ('ok', 'error', 'denied')),
  error_message text,
  duration_ms integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists mcp_audit_user_idx on mcp_audit_logs (user_id, created_at desc);
create index if not exists mcp_audit_project_idx on mcp_audit_logs (project_id, created_at desc);

create table if not exists oauth_clients (
  id text primary key,
  client_id text not null unique,
  client_name text not null,
  redirect_uris text[] not null,
  client_secret_hash text,
  client_secret_salt text,
  token_endpoint_auth_method text not null default 'none',
  grant_types text[] not null default '{authorization_code,refresh_token}',
  response_types text[] not null default '{code}',
  scope text not null default '',
  software_id text,
  created_at timestamptz not null default now()
);

create table if not exists oauth_codes (
  id text primary key,
  code_hash text not null unique,
  client_id text not null,
  user_id text not null references users (id) on delete cascade,
  redirect_uri text not null,
  code_challenge text not null,
  code_challenge_method text not null default 'S256' check (code_challenge_method = 'S256'),
  scope text not null default '',
  resource text not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists oauth_codes_expiry_idx on oauth_codes (expires_at);

create table if not exists oauth_tokens (
  id text primary key,
  token_hash text not null unique,
  kind text not null check (kind in ('access', 'refresh')),
  client_id text not null,
  user_id text not null references users (id) on delete cascade,
  connection_id text references mcp_connections (id) on delete cascade,
  scope text not null default '',
  -- RFC 8707 audience. Validated on every MCP request.
  resource text not null,
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  display_hint text
);
create index if not exists oauth_tokens_user_idx on oauth_tokens (user_id);
create index if not exists oauth_tokens_connection_idx on oauth_tokens (connection_id);

-- ---------------------------------------------------------------------- RLS ---
-- Deny by default on every table. The application uses the service-role key, which
-- bypasses RLS; these policies exist so that an accidentally-exposed anon key reads
-- nothing at all.

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'users', 'sessions', 'workspaces', 'workspace_members', 'projects', 'project_files',
    'project_versions', 'version_files', 'devices', 'device_events', 'preview_sessions',
    'build_runs', 'journeys', 'journey_steps', 'journey_runs', 'share_links',
    'comment_threads', 'comments', 'mcp_connections', 'mcp_audit_logs', 'oauth_clients',
    'oauth_codes', 'oauth_tokens'
  ]
  loop
    execute format('alter table %I enable row level security', table_name);
    execute format('alter table %I force row level security', table_name);
  end loop;
end
$$;
