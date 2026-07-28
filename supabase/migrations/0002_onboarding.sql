-- PhoneLab 0002 — onboarding, preferences and demo projects.
--
-- Additive only: every column has a default or is nullable, so an existing
-- deployment keeps working while the new code rolls out.
--
-- Existing accounts get `onboarding_completed_at = null`, which means the router
-- shows them onboarding once. That is deliberate — they have never seen it.

alter table users
  add column if not exists onboarding_completed_at timestamptz,
  add column if not exists onboarding_step integer not null default 0,
  add column if not exists onboarding_draft jsonb not null default '{}'::jsonb,
  add column if not exists active_workspace_id text references workspaces (id) on delete set null,
  add column if not exists active_project_id text,
  add column if not exists preferences jsonb not null default '{
    "theme": "light",
    "leftPaneWidth": 25,
    "editorMinimap": false,
    "canvasSnap": true,
    "canvasGrid": true,
    "reduceMotion": false
  }'::jsonb;

alter table projects
  add column if not exists is_demo boolean not null default false,
  add column if not exists brief jsonb;

-- Backfill: point existing accounts at the workspace they own, so onboarding and
-- the dashboard have somewhere to put a project without creating a second one.
update users
set active_workspace_id = workspaces.id
from workspaces
where users.active_workspace_id is null
  and workspaces.owner_id = users.id;

-- Projects created from the PadelFlow template before this migration are demos.
update projects set is_demo = true where template_id = 'padelflow' and is_demo = false;

create index if not exists projects_is_demo_idx on projects (workspace_id, is_demo);
