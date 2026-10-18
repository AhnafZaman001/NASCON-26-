-- 0015 API write helpers for CRM records (M2)
-- Needs: 0002, 0006, 0014. Deletes of contacts, companies and opportunities are audited by the
-- triggers in 0006; going through this function sets app.actor so the audit row names the member.
-- Called only by apps/api (service role) after its permission check.

create function api_delete_crm(p_actor uuid, p_ws uuid, p_kind text, p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform api_set_actor(p_actor);
  if p_kind = 'contact' then
    delete from contacts where id = p_id and workspace_id = p_ws;
  elsif p_kind = 'company' then
    delete from companies where id = p_id and workspace_id = p_ws;     -- contacts keep existing, company_id -> null
  elsif p_kind = 'opportunity' then
    delete from opportunities where id = p_id and workspace_id = p_ws;
  else
    raise exception 'Unknown record type.' using errcode = 'P0001';
  end if;
  if not found then raise exception 'Record not found.' using errcode = 'P0002'; end if;
end $$;

revoke all on function api_delete_crm(uuid, uuid, text, uuid) from public, anon, authenticated;
grant execute on function api_delete_crm(uuid, uuid, text, uuid) to service_role;
