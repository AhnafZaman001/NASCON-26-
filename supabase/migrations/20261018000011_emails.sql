-- NASCON '26 : outbound email queue
-- Rows are written by the Next.js server (service role). The BullMQ worker (apps/worker)
-- receives a user_id, claims that user's pending rows with claim_user_emails(), sends them
-- through nodemailer and writes the result back.

create type email_status as enum ('pending', 'sending', 'sent', 'failed');

create table emails (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  from_email   text,                                   -- null = worker's SMTP_FROM
  to_email     text not null check (position('@' in to_email) > 1),
  cc           text[] not null default '{}',
  bcc          text[] not null default '{}',
  subject      text not null default '',
  body_text    text,
  body_html    text,
  status       email_status not null default 'pending',
  attempts     int not null default 0,
  max_attempts int not null default 3,
  last_error   text,
  message_id   text,                                   -- SMTP Message-ID once sent
  scheduled_at timestamptz not null default now(),
  sent_at      timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  check (body_text is not null or body_html is not null)
);
create index emails_ws_idx      on emails (workspace_id, created_at desc);
create index emails_pending_idx on emails (user_id, scheduled_at) where status = 'pending';

create function emails_touch() returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;
create trigger emails_touch before update on emails for each row execute function emails_touch();

-- Atomically move a user's due emails from pending -> sending and return them.
-- SKIP LOCKED lets several workers run without sending the same row twice.
create function claim_user_emails(p_user_id uuid, p_limit int default 50)
returns setof emails
language sql security definer set search_path = public as $$
  update emails e
     set status = 'sending', attempts = e.attempts + 1
   where e.id in (
     select id from emails
      where user_id = p_user_id and status = 'pending' and scheduled_at <= now()
      order by scheduled_at
      limit p_limit
      for update skip locked)
  returning e.*
$$;

-- Rows stuck in 'sending' (worker crashed mid-send) go back to pending after 10 minutes.
create function release_stale_emails() returns int
language sql security definer set search_path = public as $$
  with r as (
    update emails set status = 'pending'
     where status = 'sending' and updated_at < now() - interval '10 minutes'
    returning 1)
  select count(*)::int from r
$$;

-- ─────────────────────────── privileges ──────────────────────────
alter table emails enable row level security;
grant select on emails to authenticated;
create policy emails_read on emails for select to authenticated using (
  workspace_id = current_workspace_id()
  and (user_id = auth.uid() or has_perm('integrations.manage')));

revoke all on function claim_user_emails(uuid, int), release_stale_emails() from public, anon, authenticated;
grant all on emails to service_role;
grant execute on function claim_user_emails(uuid, int), release_stale_emails() to service_role;
