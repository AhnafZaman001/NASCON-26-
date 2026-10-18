-- 0001 Tenancy & access
-- Needs: nothing. Creates: workspaces, roles, members, current_member_id(), current_workspace_id(), has_perm().

create extension if not exists pgcrypto;

-- ───────────────────────────── enums ─────────────────────────────
create type base_level   as enum ('owner', 'admin', 'user');
create type availability as enum ('available', 'busy', 'on_leave', 'offline');

-- ───────────────────────── tenancy & access ──────────────────────
create table workspaces (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  settings   jsonb not null default '{
    "ack_window_seconds": 300,
    "max_open_leads": 10,
    "idle_seconds": 86400,
    "escalation_chain": [
      {"step": "next",    "window_seconds": 300},
      {"step": "backup",  "window_seconds": 300},
      {"step": "manager", "window_seconds": 300}
    ],
    "backup_member_id": null,
    "manager_member_id": null
  }'::jsonb,
  created_at timestamptz not null default now()
);

create table roles (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  name         text not null,
  permissions  text[] not null default '{}',
  created_at   timestamptz not null default now(),
  unique (workspace_id, name)
);

create table members (
  id                 uuid primary key default gen_random_uuid(),
  workspace_id       uuid not null references workspaces(id) on delete cascade,
  user_id            uuid not null unique references auth.users(id) on delete cascade,
  email              text not null,
  full_name          text not null default '',
  level              base_level not null default 'user',
  role_id            uuid references roles(id) on delete set null,
  status             availability not null default 'available',
  last_assigned_at   timestamptz,
  notify_channel     text check (notify_channel in ('telegram', 'slack', 'email')),
  notify_destination text,
  calendar_status    text not null default 'not_connected'
                     check (calendar_status in ('not_connected', 'connected', 'needs_reconnect')),
  dashboard_prefs    jsonb not null default '{}'::jsonb,
  created_at         timestamptz not null default now()
);
create index members_ws_idx on members (workspace_id);

-- helpers used by RLS and server functions
create function current_member_id() returns uuid
language sql stable security definer set search_path = public as $$
  select id from members where user_id = auth.uid() limit 1
$$;

create function current_workspace_id() returns uuid
language sql stable security definer set search_path = public as $$
  select workspace_id from members where user_id = auth.uid() limit 1
$$;

-- Owner holds every permission; everyone else gets exactly what their role grants.
create function has_perm(p text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((
    select m.level = 'owner' or p = any (coalesce(r.permissions, '{}'))
    from members m left join roles r on r.id = m.role_id
    where m.user_id = auth.uid()
  ), false)
$$;

