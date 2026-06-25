-- ============================================================================
-- Migration: 0140_support_tickets.sql
-- Wave: Internal feedback / support ticketing (operator beta channel)
-- Phase: Schema, RLS, and audit for the in-app feedback loop.
--   Lets a tenant user file a bug / suggestion / question from inside their
--   login, and lets a platform operator (Kitstak staff) read and work those
--   tickets across every tenant from a gated staff surface.
-- Closes: In-app beta feedback channel (no GitHub issue; founder request 2026-06-24)
-- Date: 2026-06-24
--
-- DOWN MIGRATION (operator-only; forward-only repo, do not auto-apply):
--   drop trigger if exists audit_support_tickets on public.support_tickets;
--   drop function if exists public.trg_audit_support_tickets();
--   drop function if exists public.is_platform_staff(uuid);
--   drop table if exists public.support_ticket_comments;
--   drop table if exists public.support_tickets;
--   drop table if exists public.platform_staff;
--   -- audit_log_entity_type_check is left with 'support_ticket' present; it is a
--   -- superset and harmless. Re-narrowing it is an operator-scripted step.
--
-- Constitutional alignment:
--   Money rules        No monetary columns. No _cents fields, no floats.
--   RLS rules          Pattern A on support_tickets and support_ticket_comments
--                      (org_id = current_org_id()). Tenants SELECT their own org
--                      and INSERT their own rows only. They cannot UPDATE/DELETE
--                      tickets or see is_internal comments. Cross-tenant staff
--                      reads are NOT granted in RLS; they go through a service-role
--                      edge function gated by is_platform_staff(). platform_staff
--                      is RLS-enabled with no authenticated policy (locked table).
--   Audit rules        support_tickets has a state machine, so it carries an
--                      auto-state-transition audit trigger writing through
--                      audit_append_state_change (INSERT/UPDATE/DELETE). The
--                      INSERT branch records creation, so no separate created
--                      trigger is needed. Comments are append-style child rows
--                      with no state machine and are intentionally not audited in
--                      this phase.
--   Migration rules    Forward-only. All DDL idempotent (IF EXISTS / IF NOT
--                      EXISTS, guarded constraint swap, drop-then-create trigger).
--   State machine      support_tickets.status: open -> triaged -> in_progress ->
--                      resolved -> closed, with resolved/closed -> in_progress
--                      reopen. Enforced by CHECK; transitions driven by staff.
--   Grants             is_platform_staff() execute revoked from public, anon;
--                      granted to authenticated, service_role.
--   Constraint         audit_log_entity_type_check extended with 'support_ticket'
--                      as a strict superset of the existing list.
--   Seed               One platform_staff row for the founder operator, resolved
--                      by email so no auth uuid is hardcoded. No-op if absent.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- platform_staff: global allowlist of Kitstak operators (cross-tenant staff).
-- Not org-scoped. Read only through is_platform_staff(); locked under RLS.
-- ---------------------------------------------------------------------------

create table if not exists public.platform_staff (
  user_id uuid primary key references auth.users(id) on delete cascade,
  note text,
  created_at timestamptz not null default now(),
  created_by uuid
);

alter table public.platform_staff enable row level security;
-- No permissive policy for authenticated: authenticated callers see and write
-- nothing. service_role bypasses RLS; is_platform_staff() is security definer.

create or replace function public.is_platform_staff(p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.platform_staff where user_id = p_uid
  );
$$;

revoke execute on function public.is_platform_staff(uuid) from public, anon;
grant execute on function public.is_platform_staff(uuid) to authenticated, service_role;

-- Seed the founder operator by email (no hardcoded auth uuid). No-op if the
-- account is not present on this database.
insert into public.platform_staff (user_id, note)
select id, 'Founder / platform operator (seeded by 0140)'
from auth.users
where email = 'mike@team-01.com'
on conflict (user_id) do nothing;

-- ---------------------------------------------------------------------------
-- support_tickets: org-scoped feedback ticket with a status FSM.
-- ---------------------------------------------------------------------------

create table if not exists public.support_tickets (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  reference text,
  type text not null
    check (type in ('bug', 'suggestion', 'question')),
  title text not null,
  body text not null,
  status text not null default 'open'
    check (status in ('open', 'triaged', 'in_progress', 'resolved', 'closed')),
  priority text
    check (priority is null or priority in ('low', 'normal', 'high', 'urgent')),
  context jsonb not null default '{}'::jsonb,
  resolved_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  deleted_at timestamptz
);

create unique index if not exists support_tickets_org_reference_uniq
  on public.support_tickets(org_id, reference)
  where reference is not null;
create index if not exists support_tickets_org_status_idx
  on public.support_tickets(org_id, status);
create index if not exists support_tickets_org_created_idx
  on public.support_tickets(org_id, created_at desc);

alter table public.support_tickets enable row level security;

-- Any tenant user may read their own org's tickets.
drop policy if exists support_tickets_select on public.support_tickets;
create policy support_tickets_select on public.support_tickets
  for select to authenticated
  using (org_id = public.current_org_id());

-- Any tenant user may file a ticket for their own org as themselves. No role
-- gate: field testers can be any role. Lifecycle (status) is driven by staff
-- through the service role, so no authenticated UPDATE/DELETE policy exists.
drop policy if exists support_tickets_insert on public.support_tickets;
create policy support_tickets_insert on public.support_tickets
  for insert to authenticated
  with check (
    org_id = public.current_org_id()
    and created_by = auth.uid()
  );

-- ---------------------------------------------------------------------------
-- support_ticket_comments: the two-way thread. org_id denormalized for RLS.
-- ---------------------------------------------------------------------------

create table if not exists public.support_ticket_comments (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.support_tickets(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  author_id uuid,
  author_kind text not null
    check (author_kind in ('tenant_user', 'platform_staff')),
  body text not null,
  is_internal boolean not null default false,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists support_ticket_comments_ticket_idx
  on public.support_ticket_comments(ticket_id, created_at);
create index if not exists support_ticket_comments_org_idx
  on public.support_ticket_comments(org_id);

alter table public.support_ticket_comments enable row level security;

-- Tenant users see public (non-internal) comments on their own org's tickets.
-- Internal staff notes never leave the staff surface.
drop policy if exists support_ticket_comments_select on public.support_ticket_comments;
create policy support_ticket_comments_select on public.support_ticket_comments
  for select to authenticated
  using (
    org_id = public.current_org_id()
    and is_internal = false
  );

-- Tenant users may post their own public comments. Staff replies and internal
-- notes are written through the service role (which bypasses RLS).
drop policy if exists support_ticket_comments_insert on public.support_ticket_comments;
create policy support_ticket_comments_insert on public.support_ticket_comments
  for insert to authenticated
  with check (
    org_id = public.current_org_id()
    and author_id = auth.uid()
    and author_kind = 'tenant_user'
    and is_internal = false
  );

-- ---------------------------------------------------------------------------
-- Audit: register 'support_ticket' as an auditable entity, then attach the
-- state-transition trigger. Strict superset of the current entity_type CHECK.
-- ---------------------------------------------------------------------------

do $$
begin
  if exists (
    select 1 from pg_constraint
     where conrelid = 'public.audit_log'::regclass
       and conname  = 'audit_log_entity_type_check'
  ) then
    alter table public.audit_log
      drop constraint audit_log_entity_type_check;
  end if;
end$$;

alter table public.audit_log
  add constraint audit_log_entity_type_check
  check (entity_type in (
    'organization', 'org_membership', 'customer', 'contact', 'activity',
    'lead', 'opportunity', 'item', 'quote', 'quote_line_item', 'project',
    'project_phase', 'project_line_item', 'invoice', 'invoice_line_item',
    'payment', 'credit_note', 'journal_entry', 'period_close', 'vendor',
    'purchase_order', 'po_line_item', 'vendor_bill', 'expense', 'warehouse',
    'stock_movement', 'receiving_order', 'production_run', 'shipment',
    'attachment', 'comment', 'notification', 'manufacturing_run',
    'manufacturing_run_consumed_line_item', 'manufacturing_run_produced_line_item',
    'sales_channel', 'sales_order', 'sales_order_line_item', 'kitting_job',
    'kitting_job_consumed_line_item', 'kitting_job_produced_line_item',
    'fulfillment', 'workforce_member', 'workforce_team', 'workforce_team_member',
    'shift', 'work_assignment', 'time_entry', 'three_pl_account',
    'account_service_definition', 'job_template', 'job_template_line',
    'supply_plan', 'supply_plan_line', 'job_run', 'job_run_daily_log',
    'job_run_daily_log_consumed_line_item', 'job_run_daily_log_produced_line_item',
    'billing_review', 'warehouse_location', 'putaway_task', 'lot',
    'recurring_schedule', 'quote_tier', 'support_ticket'
  ));

create or replace function public.trg_audit_support_tickets()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid;
  v_org_id uuid;
  v_entity_id uuid;
  v_from text;
  v_to text;
  v_action text;
  v_diff jsonb;
begin
  if tg_op = 'INSERT' then
    v_org_id := new.org_id; v_entity_id := new.id;
    v_from := null; v_to := new.status; v_action := 'insert';
    begin v_actor := coalesce(auth.uid(), new.created_by);
    exception when others then v_actor := new.created_by; end;
    v_diff := jsonb_build_object(
      'status', new.status, 'type', new.type);
  elsif tg_op = 'UPDATE' then
    v_org_id := new.org_id; v_entity_id := new.id;
    v_from := old.status; v_to := new.status; v_action := 'update';
    begin v_actor := coalesce(auth.uid(), new.updated_by);
    exception when others then v_actor := new.updated_by; end;
    v_diff := jsonb_build_object(
      'status', jsonb_build_object('from', old.status, 'to', new.status));
  else
    v_org_id := old.org_id; v_entity_id := old.id;
    v_from := old.status; v_to := 'deleted'; v_action := 'delete';
    begin v_actor := coalesce(auth.uid(), old.updated_by);
    exception when others then v_actor := old.updated_by; end;
    v_diff := jsonb_build_object('status', old.status);
  end if;

  perform public.audit_append_state_change(
    v_org_id, 'support_ticket', v_entity_id, v_from, v_to, v_action, v_actor, v_diff);

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

revoke execute on function public.trg_audit_support_tickets() from public, anon;

drop trigger if exists audit_support_tickets on public.support_tickets;
create trigger audit_support_tickets
  after insert or update or delete on public.support_tickets
  for each row execute function public.trg_audit_support_tickets();
