-- 0008 Privileges, RLS, column masking
-- Needs: 0001-0007.

-- ─────────────────────── privileges & RLS ────────────────────────
revoke all on all tables in schema public from anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;
alter default privileges in schema public revoke all on tables    from anon, authenticated;
alter default privileges in schema public revoke all on functions from public, anon, authenticated;

grant usage on schema public to anon, authenticated;
grant execute on function current_member_id(), current_workspace_id(), has_perm(text), dashboard_metrics()
  to authenticated;

do $$
declare t text;
begin
  -- read-only access for signed-in users, gated by RLS
  foreach t in array array['workspaces','roles','members','companies','contacts','pipelines','stages',
    'field_definitions','opportunities','saved_lists','leads','lead_assignments','activities',
    'messages','payments','appointments','integrations','integration_events','notification_outbox',
    'audit_log','integration_secrets']
  loop
    execute format('alter table %I enable row level security', t);
  end loop;

  foreach t in array array['workspaces','roles','members','companies','contacts','pipelines','stages',
    'field_definitions','saved_lists','leads','lead_assignments','activities','messages','payments',
    'appointments','integrations','integration_events','notification_outbox','audit_log']
  loop
    execute format('grant select on %I to authenticated', t);
  end loop;

  alter table opportunities enable row level security;
end $$;

-- opportunity.value is never selectable directly; clients read opportunities_v instead
grant select (id, workspace_id, contact_id, pipeline_id, stage_id, title, currency, owner_id, custom,
              payment_status, version, created_at, updated_at) on opportunities to authenticated;
grant select on opportunities_v, recovery_queue_v, leads_v to authenticated;

create policy ws_read on workspaces for select to authenticated using (id = current_workspace_id());
create policy members_read on members for select to authenticated using (workspace_id = current_workspace_id());
create policy roles_read   on roles   for select to authenticated using (workspace_id = current_workspace_id());

do $$
declare t text;
begin
  foreach t in array array['companies','contacts','pipelines','stages','field_definitions','opportunities',
    'saved_lists','leads','lead_assignments','activities','payments','appointments']
  loop
    execute format($f$create policy %I on %I for select to authenticated
      using (workspace_id = current_workspace_id() and has_perm('crm.view'))$f$, t || '_read', t);
  end loop;
end $$;

create policy messages_read on messages for select to authenticated using (
  workspace_id = current_workspace_id() and has_perm('crm.view')
  and (has_perm('conversations.view_all')
       or exists (select 1 from contacts c where c.id = messages.contact_id and c.owner_id = current_member_id())));

create policy integrations_read on integrations for select to authenticated
  using (workspace_id = current_workspace_id() and has_perm('integrations.manage'));
create policy integration_events_read on integration_events for select to authenticated
  using (workspace_id = current_workspace_id() and has_perm('integrations.manage'));
create policy outbox_read on notification_outbox for select to authenticated
  using (workspace_id = current_workspace_id() and has_perm('integrations.manage'));
create policy audit_read on audit_log for select to authenticated
  using (workspace_id = current_workspace_id() and has_perm('audit.view'));

-- service role keeps full access (server code); make that explicit for functions
grant execute on all functions in schema public to service_role;
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;

