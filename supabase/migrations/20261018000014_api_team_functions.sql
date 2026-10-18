-- 0014 API write functions for workspace, members and roles (M1)
-- Needs: 0001-0010. Each function sets app.actor first, so audit rows written by the triggers
-- in 0006 name the member who made the change. Called only by apps/api (service role) AFTER it
-- has checked the caller's workspace and permission. Business rules that must hold even if the
-- API has a bug are enforced here too (owner cannot be changed, cross-workspace ids rejected).

create function api_set_actor(p_actor uuid) returns void language sql as $$
  select set_config('app.actor', coalesce(p_actor::text, ''), true)
$$;

-- Workspace name / settings (settings are merged, not replaced)
create function api_update_workspace(p_actor uuid, p_ws uuid, p_name text, p_settings jsonb)
returns workspaces language plpgsql security definer set search_path = public as $$
declare w workspaces;
begin
  perform api_set_actor(p_actor);
  update workspaces
     set name     = coalesce(nullif(trim(p_name), ''), name),
         settings = settings || coalesce(p_settings, '{}'::jsonb)
   where id = p_ws
  returning * into w;
  if not found then raise exception 'Workspace not found.' using errcode = 'P0002'; end if;
  return w;
end $$;

-- Create (p_role null) or update a role
create function api_save_role(p_actor uuid, p_ws uuid, p_role uuid, p_name text, p_perms text[])
returns roles language plpgsql security definer set search_path = public as $$
declare r roles;
begin
  perform api_set_actor(p_actor);
  if p_role is null then
    insert into roles (workspace_id, name, permissions) values (p_ws, trim(p_name), coalesce(p_perms, '{}'))
    returning * into r;
  else
    update roles set name = coalesce(nullif(trim(p_name), ''), name), permissions = coalesce(p_perms, permissions)
     where id = p_role and workspace_id = p_ws
    returning * into r;
    if not found then raise exception 'Role not found.' using errcode = 'P0002'; end if;
  end if;
  return r;
end $$;

-- Members on the role keep their level but lose the role's permissions (role_id -> null).
create function api_delete_role(p_actor uuid, p_ws uuid, p_role uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform api_set_actor(p_actor);
  delete from roles where id = p_role and workspace_id = p_ws;
  if not found then raise exception 'Role not found.' using errcode = 'P0002'; end if;
end $$;

-- Add an existing auth user to the workspace
create function api_add_member(p_actor uuid, p_ws uuid, p_user uuid, p_email text, p_name text,
                               p_level base_level, p_role uuid)
returns members language plpgsql security definer set search_path = public as $$
declare m members;
begin
  perform api_set_actor(p_actor);
  if p_level = 'owner' then raise exception 'A workspace has exactly one Owner.' using errcode = 'P0001'; end if;
  if p_role is not null and not exists (select 1 from roles where id = p_role and workspace_id = p_ws) then
    raise exception 'Role not found.' using errcode = 'P0002';
  end if;
  insert into members (workspace_id, user_id, email, full_name, level, role_id, notify_channel, notify_destination)
  values (p_ws, p_user, lower(trim(p_email)), trim(p_name), p_level, p_role, 'email', lower(trim(p_email)))
  returning * into m;
  return m;
end $$;

-- Patch a member. Allowed keys: level, role_id, full_name, notify_channel, notify_destination, dashboard_prefs
create function api_update_member(p_actor uuid, p_ws uuid, p_member uuid, p_patch jsonb)
returns members language plpgsql security definer set search_path = public as $$
declare m members;
begin
  perform api_set_actor(p_actor);
  select * into m from members where id = p_member and workspace_id = p_ws for update;
  if not found then raise exception 'Member not found.' using errcode = 'P0002'; end if;
  if p_patch ? 'level' then
    if m.level = 'owner' then raise exception 'The Owner''s level cannot be changed.' using errcode = 'P0001'; end if;
    if p_patch->>'level' = 'owner' then raise exception 'A workspace has exactly one Owner.' using errcode = 'P0001'; end if;
  end if;
  if p_patch ? 'role_id' and p_patch->>'role_id' is not null
     and not exists (select 1 from roles where id = (p_patch->>'role_id')::uuid and workspace_id = p_ws) then
    raise exception 'Role not found.' using errcode = 'P0002';
  end if;
  update members set
    level              = case when p_patch ? 'level' then (p_patch->>'level')::base_level else level end,
    role_id            = case when p_patch ? 'role_id' then (p_patch->>'role_id')::uuid else role_id end,
    full_name          = case when p_patch ? 'full_name' then trim(p_patch->>'full_name') else full_name end,
    notify_channel     = case when p_patch ? 'notify_channel' then p_patch->>'notify_channel' else notify_channel end,
    notify_destination = case when p_patch ? 'notify_destination' then p_patch->>'notify_destination' else notify_destination end,
    dashboard_prefs    = case when p_patch ? 'dashboard_prefs' then p_patch->'dashboard_prefs' else dashboard_prefs end
  where id = p_member
  returning * into m;
  return m;
end $$;

-- Remove a member: their unacknowledged leads are reassigned first; returns the auth user id
-- so the API can also delete the login.
create function api_remove_member(p_actor uuid, p_ws uuid, p_member uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare m members; l record;
begin
  perform api_set_actor(p_actor);
  select * into m from members where id = p_member and workspace_id = p_ws for update;
  if not found then raise exception 'Member not found.' using errcode = 'P0002'; end if;
  if m.level = 'owner' then raise exception 'The Owner cannot be removed.' using errcode = 'P0001'; end if;
  update members set status = 'offline' where id = p_member;
  for l in select id from leads where owner_id = p_member and status = 'unacknowledged' for update skip locked loop
    perform assign_lead(l.id, 'absence');
  end loop;
  delete from members where id = p_member;
  return m.user_id;
end $$;

-- Availability change with actor (reassignment logic lives in set_member_status, 0003)
create function api_set_member_status(p_actor uuid, p_ws uuid, p_member uuid, p_status availability) returns int
language plpgsql security definer set search_path = public as $$
begin
  perform api_set_actor(p_actor);
  if not exists (select 1 from members where id = p_member and workspace_id = p_ws) then
    raise exception 'Member not found.' using errcode = 'P0002';
  end if;
  return set_member_status(p_member, p_status);
end $$;

-- ─────────────────────────── privileges ──────────────────────────
revoke all on function
  api_set_actor(uuid),
  api_update_workspace(uuid, uuid, text, jsonb),
  api_save_role(uuid, uuid, uuid, text, text[]),
  api_delete_role(uuid, uuid, uuid),
  api_add_member(uuid, uuid, uuid, text, text, base_level, uuid),
  api_update_member(uuid, uuid, uuid, jsonb),
  api_remove_member(uuid, uuid, uuid),
  api_set_member_status(uuid, uuid, uuid, availability)
from public, anon, authenticated;

grant execute on function
  api_set_actor(uuid),
  api_update_workspace(uuid, uuid, text, jsonb),
  api_save_role(uuid, uuid, uuid, text, text[]),
  api_delete_role(uuid, uuid, uuid),
  api_add_member(uuid, uuid, uuid, text, text, base_level, uuid),
  api_update_member(uuid, uuid, uuid, jsonb),
  api_remove_member(uuid, uuid, uuid),
  api_set_member_status(uuid, uuid, uuid, availability)
to service_role;
