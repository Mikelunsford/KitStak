-- ============================================================================
-- Migration: 0035_collab_notifications.sql
-- Wave: 2
-- Phase: Cross-cutting collaboration
-- Closes: R-W2-COLLAB-03
-- Date: 2026-05-18
-- DOWN MIGRATION: operator-only. Drop notifications table. Not auto-run.
--
-- Constitutional alignment:
--   RLS rules        Pattern A. Tenant scope by org_id; recipient-self read.
--   Money rules      Untouched.
--   Audit rules      notifications row appears in 0036 entity_type CHECK.
--   Migration rules  Forward-only. All DDL idempotent.
-- ============================================================================

create table if not exists public.notifications (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  recipient_user_id uuid not null,
  entity_type text,
  entity_id uuid,
  channel text not null default 'inapp'
    check (channel in ('inapp', 'email', 'webhook')),
  subject text not null,
  body text,
  payload jsonb not null default '{}'::jsonb,
  queued_at timestamptz not null default now(),
  delivered_at timestamptz,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid
);

create index if not exists notifications_recipient_idx
  on public.notifications (org_id, recipient_user_id, queued_at desc);

create index if not exists notifications_pending_idx
  on public.notifications (channel, queued_at)
  where delivered_at is null;

alter table public.notifications enable row level security;

drop policy if exists notifications_self_select on public.notifications;
create policy notifications_self_select on public.notifications
  for select to authenticated
  using (
    org_id = public.current_org_id()
    and recipient_user_id = auth.uid()
  );

drop policy if exists notifications_self_update on public.notifications;
create policy notifications_self_update on public.notifications
  for update to authenticated
  using (
    org_id = public.current_org_id()
    and recipient_user_id = auth.uid()
  )
  with check (
    org_id = public.current_org_id()
    and recipient_user_id = auth.uid()
  );

-- Inserts are service-role only (workers + triggers create notifications).
-- No INSERT policy for authenticated.
