-- 0019 Google Calendar (M9 / I3)
-- Needs: 0001-0018. Adds: members.timezone, appointment bookkeeping columns, a DB-level
-- double-booking guard, and api_calendar_set_status() (audited connect / disconnect / needs-reconnect).

create extension if not exists btree_gist with schema extensions;

-- I3.5: the employee's own zone (read from their Google calendar on connect); appointments keep the zone they were booked in.
alter table members add column if not exists timezone text;

alter table appointments add column if not exists created_by     uuid references members(id) on delete set null;
alter table appointments add column if not exists updated_at     timestamptz not null default now();
alter table appointments add column if not exists html_link      text;
-- true when the employee was warned about an overlap and booked anyway ("Book anyway")
alter table appointments add column if not exists allow_overlap  boolean not null default false;

create unique index if not exists appt_google_event_uq
  on appointments (member_id, google_event_id) where google_event_id is not null;

-- I3.4 / Q5: two bookings arriving together can't both take the same slot. Deliberate overrides are exempt.
alter table appointments drop constraint if exists appointments_no_overlap;
alter table appointments add constraint appointments_no_overlap
  exclude using gist (member_id with =, tstzrange(starts_at, ends_at) with &&)
  where (status = 'scheduled' and not allow_overlap);

-- I3.1 / I3.2 / I5.7: connection state changes go through here so the audit log names the actor.
-- p_status: 'connected' | 'needs_reconnect' | 'not_connected'
create or replace function api_calendar_set_status(p_actor uuid, p_ws uuid, p_member uuid, p_status text, p_tz text default null)
returns void language plpgsql security definer set search_path = public as $$
declare before_status text; any_connected boolean; any_broken boolean;
begin
  if p_status not in ('connected', 'needs_reconnect', 'not_connected') then
    raise exception 'Unknown calendar status.' using errcode = 'P0001';
  end if;
  perform api_set_actor(p_actor);

  select calendar_status into before_status from members where id = p_member and workspace_id = p_ws for update;
  if not found then raise exception 'Member not found.' using errcode = 'P0002'; end if;

  update members
     set calendar_status = p_status,
         timezone = case when p_status = 'connected' then coalesce(nullif(p_tz, ''), timezone) else timezone end
   where id = p_member;

  if before_status is distinct from p_status then
    perform audit(p_ws, 'calendar.' || p_status, 'members', p_member::text,
                  jsonb_build_object('calendar_status', before_status), jsonb_build_object('calendar_status', p_status));
  end if;

  -- workspace-level row on the Integrations page (I5.1)
  select bool_or(calendar_status = 'connected'), bool_or(calendar_status = 'needs_reconnect')
    into any_connected, any_broken from members where workspace_id = p_ws;
  insert into integrations (workspace_id, provider, status, last_ok_at, last_error)
  values (p_ws, 'google_calendar',
          case when any_connected then 'connected' when any_broken then 'error' else 'not_connected' end,
          case when p_status = 'connected' then now() end,
          case when p_status = 'needs_reconnect' then 'A Google connection was revoked or expired.' end)
  on conflict (workspace_id, provider) do update
     set status = excluded.status,
         last_ok_at = coalesce(excluded.last_ok_at, integrations.last_ok_at),
         last_error = case when excluded.status = 'connected' then null else coalesce(excluded.last_error, integrations.last_error) end,
         updated_at = now();
end $$;

revoke all on function api_calendar_set_status(uuid, uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function api_calendar_set_status(uuid, uuid, uuid, text, text) to service_role;
