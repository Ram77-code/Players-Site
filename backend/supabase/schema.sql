create extension if not exists pgcrypto;

create table if not exists public.enquiries (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null,
  name text not null check (char_length(name) between 2 and 100),
  email text not null check (char_length(email) <= 254),
  service text not null check (service in (
    'Full-Stack Web Development',
    'Custom Software Development',
    'AI-Powered Applications',
    'Intelligent AI Agents',
    'Business Process Automation',
    'Digital Product Engineering',
    'Something else'
  )),
  message text not null check (char_length(message) between 20 and 5000),
  notification_status text not null default 'pending'
    check (notification_status in ('pending', 'processing', 'sent', 'failed', 'disabled')),
  notification_attempts smallint not null default 0 check (notification_attempts between 0 and 5),
  notification_attempted_at timestamptz,
  notification_sent_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.enquiries add column if not exists submission_id uuid;
update public.enquiries set submission_id = gen_random_uuid() where submission_id is null;
alter table public.enquiries alter column submission_id set not null;
create unique index if not exists enquiries_submission_id_idx on public.enquiries (submission_id);

alter table public.enquiries
  add column if not exists notification_attempts smallint not null default 0
    check (notification_attempts between 0 and 5);
alter table public.enquiries
  add column if not exists notification_attempted_at timestamptz;

alter table public.enquiries drop constraint if exists enquiries_notification_status_check;
alter table public.enquiries add constraint enquiries_notification_status_check
  check (notification_status in ('pending', 'processing', 'sent', 'failed', 'disabled'));

alter table public.enquiries enable row level security;
revoke all on table public.enquiries from anon, authenticated;
grant all on table public.enquiries to service_role;

create index if not exists enquiries_created_at_idx on public.enquiries (created_at desc);
create index if not exists enquiries_notification_status_idx on public.enquiries (notification_status)
  where notification_status <> 'sent';

create or replace function public.claim_enquiry_notifications(batch_size integer default 25)
returns setof public.enquiries
language sql
security definer
set search_path = public, pg_temp
as $$
  with eligible as (
    select id
    from public.enquiries
    where notification_attempts < 5
      and (
        notification_status in ('pending', 'failed')
        or (notification_status = 'processing' and notification_attempted_at < now() - interval '15 minutes')
      )
    order by created_at asc
    for update skip locked
    limit least(greatest(batch_size, 1), 50)
  )
  update public.enquiries as enquiry
  set notification_status = 'processing',
      notification_attempts = enquiry.notification_attempts + 1,
      notification_attempted_at = now()
  from eligible
  where enquiry.id = eligible.id
  returning enquiry.*;
$$;

revoke all on function public.claim_enquiry_notifications(integer) from public, anon, authenticated;
grant execute on function public.claim_enquiry_notifications(integer) to service_role;