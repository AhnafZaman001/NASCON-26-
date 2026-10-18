-- 0017 Lead engine API helpers (M4)
-- Needs: 0003, 0006, 0014. Wrappers set app.actor so audit rows name the member; the engine itself
-- (assign_lead, escalate_expired_leads, row locks) is unchanged.

-- F3.6: absence reassigns unacknowledged leads always; acknowledged leads too when the workspace
-- setting acked_on_absence = 'reassign' (default 'keep': they stay and show as "owner away").
create or replace function set_member_status(p_member uuid, p_status availability) returns int
language plpgsql security definer set search_path = public as $$
declare m members; l record; n int := 0; also_acked boolean;
begin
  select * into m from members where id = p_member for update;
  if not found then raise exception 'Member not found.'; end if;
  update members set status = p_status where id = p_member;
  perform audit(m.workspace_id, 'member.status_changed', 'members', p_member::text,
                jsonb_build_object('status', m.status), jsonb_build_object('status', p_status));
  if p_status in ('on_leave', 'offline') then
    select coalesce(settings ->> 'acked_on_absence', 'keep') = 'reassign' into also_acked from workspaces where id = m.workspace_id;
    for l in select id from leads
             where owner_id = p_member and (status = 'unacknowledged' or (also_acked and status = 'acknowledged'))
             for update skip locked loop
      perform assign_lead(l.id, 'absence');
      n := n + 1;
    end loop;
  end if;
  return n;
end $$;

create function api_ack_lead(p_actor uuid, p_ws uuid, p_lead uuid) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  perform api_set_actor(p_actor);
  if not exists (select 1 from leads where id = p_lead and workspace_id = p_ws) then
    raise exception 'Lead not found.' using errcode = 'P0002';
  end if;
  if not acknowledge_lead(p_lead, p_actor) then
    raise exception 'Only the lead''s current owner can acknowledge it.' using errcode = 'P0001';
  end if;
  return true;
end $$;

create function api_reassign_lead(p_actor uuid, p_ws uuid, p_lead uuid, p_to uuid) returns uuid
language plpgsql security definer set search_path = public as $$
begin
  perform api_set_actor(p_actor);
  if not exists (select 1 from leads where id = p_lead and workspace_id = p_ws) then
    raise exception 'Lead not found.' using errcode = 'P0002';
  end if;
  if not exists (select 1 from members where id = p_to and workspace_id = p_ws) then
    raise exception 'Member not found.' using errcode = 'P0002';
  end if;
  return reassign_lead(p_lead, p_to);
end $$;

-- Glossary: any recorded action (note, stage change, message, appointment) by the owner acknowledges
-- their open leads on that contact and resets the idle clock. Returns how many leads it touched.
create function api_touch_contact_leads(p_actor uuid, p_ws uuid, p_contact uuid) returns int
language plpgsql security definer set search_path = public as $$
declare l record; n int := 0;
begin
  perform api_set_actor(p_actor);
  for l in select id from leads where workspace_id = p_ws and contact_id = p_contact and owner_id = p_actor and status <> 'closed' loop
    perform acknowledge_lead(l.id, p_actor);
    n := n + 1;
  end loop;
  return n;
end $$;

revoke all on function api_ack_lead(uuid, uuid, uuid), api_reassign_lead(uuid, uuid, uuid, uuid),
  api_touch_contact_leads(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function api_ack_lead(uuid, uuid, uuid), api_reassign_lead(uuid, uuid, uuid, uuid),
  api_touch_contact_leads(uuid, uuid, uuid) to service_role;


