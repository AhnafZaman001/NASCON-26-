-- 0020 Email alerts for lead assignment / escalation (I4, F3.9)
-- Needs: 0003 (assign_lead writes notification_outbox), 0011 (emails). No Redis: the API sends the mail.
--   1. every notification_outbox row becomes a row in `emails` (lead, source, reason, link, deadline)
--   2. claim_due_emails() lets the API claim due rows safely (SKIP LOCKED, stale rows released)
--   3. kick_email_sender() + pg_cron call the API every 10 s when mail is waiting (needs pg_net, see below)
-- An alert problem never blocks lead assignment: the trigger swallows its own errors.

create function outbox_to_email() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  m members; l leads; cname text; dest text; subj text; why text; lvl int; due text;
begin
  select * into m from members where id = new.member_id;
  if not found then return new; end if;
  select * into l from leads where id = new.lead_id;
  select full_name into cname from contacts where id = l.contact_id;

  -- per-employee destination (I4.3): an address typed in "My alert destination", else the account email
  dest := case when m.notify_destination like '%@%' then trim(m.notify_destination) else m.email end;
  if dest is null or position('@' in dest) < 2 then return new; end if;

  lvl := coalesce((new.payload ->> 'escalation_level')::int, 0);
  why := case new.reason
    when 'escalation' then 'The previous owner did not acknowledge this lead in time, so it was escalated to you (level ' || (lvl + 1) || ').'
    when 'absence'    then 'The previous owner became unavailable, so this lead was reassigned to you.'
    when 'manual'     then 'A manager assigned this lead to you.'
    else 'A new lead was assigned to you.' end;
  subj := case new.reason when 'escalation' then '[Escalated] ' when 'initial' then '[New lead] ' else '[Lead reassigned] ' end
          || coalesce(cname, 'Unknown contact');
  due := case when l.ack_deadline is not null
         then E'Acknowledge before: ' || to_char(l.ack_deadline at time zone 'UTC', 'YYYY-MM-DD HH24:MI:SS') || E' UTC\n' else '' end;

  insert into emails (workspace_id, user_id, to_email, subject, body_text)
  values (new.workspace_id, m.user_id, dest, subj,
    'Hi ' || coalesce(nullif(m.full_name, ''), 'there') || E',\n\n' || why || E'\n\n'
    || E'Lead: ' || coalesce(cname, 'Unknown contact') || E'\n'
    || E'Source: ' || coalesce(l.source, new.payload ->> 'source', 'unknown') || E'\n'
    || due
    || E'Open the lead: {{WEB_URL}}/leads?lead=' || new.lead_id || E'\n\n'
    || E'Acknowledge it in the app to stop the escalation timer.\n');
  return new;
exception when others then
  raise warning 'email alert not queued for outbox %: %', new.id, sqlerrm;
  return new;
end $$;

create trigger notification_outbox_email after insert on notification_outbox
  for each row execute function outbox_to_email();

-- The API claims due mail (all users at once). Rows stuck in 'sending' for 5 minutes go back to pending.
create function claim_due_emails(p_limit int default 20) returns setof emails
language plpgsql security definer set search_path = public as $$
begin
  update emails set status = 'pending' where status = 'sending' and updated_at < now() - interval '5 minutes';
  return query
    update emails e set status = 'sending', attempts = e.attempts + 1
     where e.id in (
       select id from emails
        where status = 'pending' and scheduled_at <= now()
        order by scheduled_at limit p_limit
        for update skip locked)
    returning e.*;
end $$;

-- Server-only settings (no grants, no policies): where the scheduler should call, and the shared secret.
create table private_config (key text primary key, value text not null);
alter table private_config enable row level security;
grant all on private_config to service_role;

-- Pokes the API only when mail is actually waiting. Needs the pg_net extension (Dashboard > Database > Extensions).
create function kick_email_sender() returns void
language plpgsql security definer set search_path = public as $$
declare u text; s text;
begin
  if not exists (select 1 from emails where status = 'pending' and scheduled_at <= now()) then return; end if;
  select value into u from private_config where key = 'email_job_url';
  select value into s from private_config where key = 'cron_secret';
  if u is null or s is null then return; end if;
  perform net.http_post(url := u,
    headers := jsonb_build_object('Authorization', 'Bearer ' || s, 'Content-Type', 'application/json'),
    body := '{}'::jsonb, timeout_milliseconds := 5000);
exception when others then
  raise warning 'kick_email_sender: %', sqlerrm;
end $$;

revoke all on function outbox_to_email(), claim_due_emails(int), kick_email_sender() from public, anon, authenticated;
grant execute on function claim_due_emails(int), kick_email_sender() to service_role;

do $$
begin
  create extension if not exists pg_net;
exception when others then
  raise notice 'pg_net not enabled - enable it in Dashboard > Database > Extensions, then re-run: select cron.schedule(''nascon-send-emails'',''10 seconds'',''select public.kick_email_sender()'')';
end $$;

do $$
begin
  perform cron.schedule('nascon-send-emails', '10 seconds', 'select public.kick_email_sender()');
exception when others then
  raise notice 'pg_cron not enabled - enable it, then run: select cron.schedule(''nascon-send-emails'',''10 seconds'',''select public.kick_email_sender()'') (%)', sqlerrm;
end $$;

-- After deploying, tell the scheduler where the API lives (run once, with your real values):
--   insert into private_config (key, value) values
--     ('email_job_url', 'https://YOUR-DOMAIN/api/jobs/send-emails'),
--     ('cron_secret',   '<same value as the CRON_SECRET env var>')
--   on conflict (key) do update set value = excluded.value;
