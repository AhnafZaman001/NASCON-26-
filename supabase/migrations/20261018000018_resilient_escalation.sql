-- 0018 Resilient escalation sweep (M4, F3.5 / Q5)
-- Needs: 0003. Before: one lead whose backup/manager setting pointed at a removed member raised an
-- error, and the whole sweep rolled back for every workspace. Now:
--   * a backup/manager that is no longer a member of the workspace falls back to round-robin
--   * each lead escalates in its own subtransaction; a failure is logged and flagged, others continue

create or replace function escalate_expired_leads() returns int
language plpgsql security definer set search_path = public as $$
declare l leads; w workspaces; chain jsonb; step text; tgt uuid; n int := 0;
begin
  for l in
    select * from leads
    where status = 'unacknowledged' and ack_deadline is not null and ack_deadline < now()
    order by ack_deadline
    for update skip locked
  loop
    begin
      select * into w from workspaces where id = l.workspace_id;
      chain := coalesce(w.settings -> 'escalation_chain', '[]'::jsonb);

      if l.escalation_level >= jsonb_array_length(chain) then
        update leads set ack_deadline = null, recovery_flag = 'chain_exhausted', updated_at = now() where id = l.id;
        perform audit(l.workspace_id, 'lead.chain_exhausted', 'lead', l.id::text, null, jsonb_build_object('owner_id', l.owner_id));
        continue;
      end if;

      step := chain -> l.escalation_level ->> 'step';
      tgt := case step
        when 'backup'  then nullif(w.settings ->> 'backup_member_id', '')::uuid
        when 'manager' then nullif(w.settings ->> 'manager_member_id', '')::uuid
        else null end;
      -- stale setting (member removed) -> let assign_lead pick the next eligible person
      if tgt is not null and not exists (select 1 from members where id = tgt and workspace_id = l.workspace_id) then
        tgt := null;
      end if;

      update leads set escalation_level = escalation_level + 1, escalation_count = escalation_count + 1 where id = l.id;
      perform assign_lead(l.id, 'escalation', tgt);
      n := n + 1;
    exception when others then
      -- this lead's changes roll back; mark it for the recovery queue and keep sweeping
      raise warning 'escalation failed for lead %: %', l.id, sqlerrm;
      update leads set recovery_flag = 'escalation_error', ack_deadline = null, updated_at = now() where id = l.id;
    end;
  end loop;
  return n;
end $$;
