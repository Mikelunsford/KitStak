-- ============================================================================
-- Migration: 0098_job_runs.sql
-- Wave: 12
-- Phase: 3PL commercial pivot, Phase A6 (Job Runs and Daily Progress), step 1 of
--   4 (job_runs parent table plus the four FSM transition RPCs).
-- Closes: the floor-execution header from
--   03-workspace/specs/2026-06-04-3pl-commercial-pivot-and-wms-pillar-plan.md
--   (section 6.1 job_runs; section 7 Body A: A6) and the locked decisions in
--   03-workspace/specs/2026-06-13-3pl-a6-job-runs-handoff.md. A job_run is the
--   day-by-day execution of a project on the floor. Daily logs (the
--   stock-affecting layer) and the JR- numbering land in 0099 and 0100; the
--   supply_plans.job_run_id fulfillment link lands in 0101.
-- Date: 2026-06-14
--
-- DOWN MIGRATION (operator-only; not auto-run). Drop in reverse:
--   drop function if exists public.cancel_job_run(uuid, uuid, uuid);
--   drop function if exists public.close_job_run(uuid, uuid, uuid);
--   drop function if exists public.complete_job_run(uuid, uuid, uuid);
--   drop function if exists public.start_job_run(uuid, uuid, uuid);
--   drop trigger if exists audit_job_runs on public.job_runs;
--   drop trigger if exists job_runs_set_updated_at on public.job_runs;
--   drop function if exists public.trg_audit_job_runs();
--   drop function if exists public.trg_job_runs_set_updated_at();
--   drop policy if exists job_runs_write  on public.job_runs;
--   drop policy if exists job_runs_select on public.job_runs;
--   drop table if exists public.job_runs;
--   alter table public.audit_log drop constraint if exists audit_log_entity_type_check;
--   (operator restores the prior 0096 CHECK by hand if needed).
--
-- Constitutional alignment:
--   Money rules        No _cents column on the header. Quantities and costs live
--                      on the daily-log line tables (0099). No monetary math
--                      here.
--   RLS rules          Pattern A on creation. org_id references organizations
--                      ON DELETE CASCADE. Write gated to the 3PL commercial layer
--                      roles ('org_owner','org_admin','ops','sales'), matching
--                      the A5 supply_plans and the accounts / job_template
--                      surfaces. Cross-tenant reads return 200 + []; the RPCs
--                      surface cross-tenant as NOT_FOUND (never 403).
--   Audit rules        job_runs is a rich FSM (planned / in_progress / completed
--                      / closed / cancelled) so its trigger records
--                      from_state -> to_state on every status change plus
--                      created / deleted, via the central audit_append_state_change
--                      helper, mirroring trg_audit_supply_plans (0096). The
--                      audit_log entity_type CHECK is extended via a guarded
--                      drop-then-add that re-adds the full 0096 list plus
--                      job_run. Strict superset. The daily-log entity_types land
--                      with their tables in 0099.
--   Migration rules    Forward-only. All DDL idempotent (IF EXISTS / IF NOT
--                      EXISTS, guarded constraint drop-then-add, CREATE OR
--                      REPLACE). Does not edit 0096.
--   State machine      job_runs.status text + CHECK. planned -> in_progress ->
--                      completed -> closed; planned|in_progress -> cancelled;
--                      closed is terminal. Transitions are driven by the four
--                      SECURITY DEFINER RPCs (start / complete / close / cancel),
--                      each idempotent on its target state. complete / close /
--                      cancel are status-only (no stock effect in A6; cancel does
--                      not auto-reverse posted movements). Paired <state>_at
--                      timestamps.
--   Snapshot           job_template_id (nullable FK ON DELETE SET NULL) plus
--                      job_template_snapshot jsonb reuse the A4
--                      JobTemplateSnapshotSchema shape byte-for-byte (0094). The
--                      handler freezes the snapshot at run creation (copy the
--                      project snapshot, or build it from a live template);
--                      this migration only stores it.
--   Spine references   project_id -> projects (ON DELETE SET NULL); account_id ->
--                      three_pl_accounts (ON DELETE SET NULL); job_template_id ->
--                      job_templates (ON DELETE SET NULL); warehouse_id ->
--                      warehouses. All nullable: a run can be opened before every
--                      link is known.
--   Out of scope       Daily logs, consumed / produced line tables, and the
--                      post_job_run_daily_log emit RPC are 0099. JR- numbering is
--                      0100. The supply_plans.job_run_id link and fulfill RPC are
--                      0101. Caps, three-pl-api routes, byte-mirror types, and
--                      the SPA are the A6 app layer (next slice).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Extend audit_log.entity_type CHECK to include job_run. Guarded drop-then-add.
-- Re-adds every value authoritative as of 0096 plus job_run. Strict superset.
-- The daily-log entity_types (job_run_daily_log and its two line tables) are
-- added with their tables in 0099.
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
    'organization', 'org_membership',
    'customer', 'contact', 'activity', 'lead', 'opportunity',
    'item',
    'quote', 'quote_line_item', 'project', 'project_phase', 'project_line_item',
    'invoice', 'invoice_line_item', 'payment', 'credit_note',
    'journal_entry', 'period_close',
    'vendor', 'purchase_order', 'po_line_item', 'vendor_bill', 'expense',
    'warehouse', 'stock_movement', 'receiving_order', 'production_run', 'shipment',
    'attachment', 'comment', 'notification',
    'manufacturing_run',
    'manufacturing_run_consumed_line_item', 'manufacturing_run_produced_line_item',
    'sales_channel', 'sales_order', 'sales_order_line_item',
    'kitting_job', 'kitting_job_consumed_line_item', 'kitting_job_produced_line_item',
    'fulfillment',
    'workforce_member', 'workforce_team', 'workforce_team_member',
    'shift', 'work_assignment', 'time_entry',
    'three_pl_account', 'account_service_definition',
    'job_template', 'job_template_line',
    'supply_plan', 'supply_plan_line',
    -- 3PL commercial layer Job Run (this migration, 0098)
    'job_run'
  ));

comment on constraint audit_log_entity_type_check on public.audit_log is
  'Enumerates every entity_type allowed in audit_log. Authoritative full list as of 0098, which adds job_run on top of the 0096 list. The job_run_daily_log entity_types are added in 0099. Update via forward migration; never subset.';

-- ---------------------------------------------------------------------------
-- job_runs: floor-execution header. Pattern A. run_number JR- (0100). The
-- day-by-day execution of a project; daily logs (0099) carry the actuals. Rich
-- FSM planned / in_progress / completed / closed / cancelled with paired
-- timestamps. job_template_snapshot freezes the source template at creation
-- (A4 shape, 0094); the handler fills it.
-- ---------------------------------------------------------------------------

create table if not exists public.job_runs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  run_number text,
  project_id uuid references public.projects(id) on delete set null,
  account_id uuid references public.three_pl_accounts(id) on delete set null,
  job_template_id uuid references public.job_templates(id) on delete set null,
  job_template_snapshot jsonb,
  warehouse_id uuid references public.warehouses(id),
  status text not null default 'planned'
    check (status in ('planned', 'in_progress', 'completed', 'closed', 'cancelled')),
  started_at timestamptz,
  completed_at timestamptz,
  closed_at timestamptz,
  cancelled_at timestamptz,
  notes text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  deleted_at timestamptz
);

create unique index if not exists job_runs_org_run_number_uniq
  on public.job_runs (org_id, run_number)
  where run_number is not null;
create index if not exists job_runs_org_idx
  on public.job_runs (org_id) where deleted_at is null;
create index if not exists job_runs_org_status_idx
  on public.job_runs (org_id, status) where deleted_at is null;
create index if not exists job_runs_project_idx
  on public.job_runs (project_id) where project_id is not null;
create index if not exists job_runs_account_idx
  on public.job_runs (account_id) where account_id is not null;
create index if not exists job_runs_job_template_idx
  on public.job_runs (job_template_id) where job_template_id is not null;
create index if not exists job_runs_warehouse_idx
  on public.job_runs (warehouse_id) where warehouse_id is not null;

alter table public.job_runs enable row level security;

drop policy if exists job_runs_select on public.job_runs;
create policy job_runs_select on public.job_runs
  for select to authenticated
  using (org_id = public.current_org_id());

drop policy if exists job_runs_write on public.job_runs;
create policy job_runs_write on public.job_runs
  for all to authenticated
  using (
    org_id = public.current_org_id()
    and public.current_user_role() in ('org_owner', 'org_admin', 'ops', 'sales')
  )
  with check (
    org_id = public.current_org_id()
    and public.current_user_role() in ('org_owner', 'org_admin', 'ops', 'sales')
  );

-- ---------------------------------------------------------------------------
-- updated_at stamping trigger. Plain BEFORE UPDATE; no audit side effect.
-- ---------------------------------------------------------------------------

create or replace function public.trg_job_runs_set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end; $$;

drop trigger if exists job_runs_set_updated_at on public.job_runs;
create trigger job_runs_set_updated_at
  before update on public.job_runs
  for each row execute function public.trg_job_runs_set_updated_at();

-- ---------------------------------------------------------------------------
-- Audit trigger: job_runs. Rich FSM, so to_state carries the status and
-- from_state carries the prior status on transitions. INSERT records created;
-- DELETE records deleted. Mirrors trg_audit_supply_plans (0096).
-- ---------------------------------------------------------------------------

create or replace function public.trg_audit_job_runs()
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
      'status', new.status, 'project_id', new.project_id, 'account_id', new.account_id);
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
    v_org_id, 'job_run', v_entity_id, v_from, v_to, v_action, v_actor, v_diff);

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

revoke execute on function public.trg_audit_job_runs() from public, anon;

drop trigger if exists audit_job_runs on public.job_runs;
create trigger audit_job_runs
  after insert or update or delete on public.job_runs
  for each row execute function public.trg_audit_job_runs();

-- ---------------------------------------------------------------------------
-- FSM transition RPCs. Each is the 3-arg cross-tenant pattern: reads the run's
-- org from the row, NOT_FOUND on a cross-tenant or missing run (never 403),
-- idempotent on its target state, STATE_CONFLICT on an out-of-order transition.
-- Pure status flips with the paired <state>_at stamp; the audit trigger fires
-- automatically off the UPDATE. No stock effect (daily-log posting in 0099 is
-- the stock-affecting action). Mirrors cancel_supply_plan (0096).
-- ---------------------------------------------------------------------------

create or replace function public.start_job_run(
  p_run_id uuid,
  p_actor uuid,
  p_caller_org_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
  v_status text;
begin
  select org_id, status into v_org_id, v_status
    from public.job_runs where id = p_run_id;

  if v_org_id is null or v_org_id <> p_caller_org_id then
    raise exception 'NOT_FOUND: job run not found' using errcode = 'P0001';
  end if;

  if v_status = 'in_progress' then
    return p_run_id; -- idempotent
  end if;
  if v_status <> 'planned' then
    raise exception 'STATE_CONFLICT: job run not in planned state (was %)', v_status
      using errcode = 'P0001';
  end if;

  update public.job_runs
     set status = 'in_progress', started_at = now(), updated_by = p_actor
   where id = p_run_id;

  return p_run_id;
end;
$$;

revoke execute on function public.start_job_run(uuid, uuid, uuid) from public, anon;
grant execute on function public.start_job_run(uuid, uuid, uuid) to authenticated, service_role;

comment on function public.start_job_run(uuid, uuid, uuid) is
  'Starts a planned Job Run (Wave 12 / A6): planned -> in_progress, stamps started_at. 3-arg cross-tenant guard (NOT_FOUND). Idempotent on an already-started run. Status-only; no stock effect.';

create or replace function public.complete_job_run(
  p_run_id uuid,
  p_actor uuid,
  p_caller_org_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
  v_status text;
begin
  select org_id, status into v_org_id, v_status
    from public.job_runs where id = p_run_id;

  if v_org_id is null or v_org_id <> p_caller_org_id then
    raise exception 'NOT_FOUND: job run not found' using errcode = 'P0001';
  end if;

  if v_status = 'completed' then
    return p_run_id; -- idempotent
  end if;
  if v_status <> 'in_progress' then
    raise exception 'STATE_CONFLICT: job run not in in_progress state (was %)', v_status
      using errcode = 'P0001';
  end if;

  update public.job_runs
     set status = 'completed', completed_at = now(), updated_by = p_actor
   where id = p_run_id;

  return p_run_id;
end;
$$;

revoke execute on function public.complete_job_run(uuid, uuid, uuid) from public, anon;
grant execute on function public.complete_job_run(uuid, uuid, uuid) to authenticated, service_role;

comment on function public.complete_job_run(uuid, uuid, uuid) is
  'Completes a Job Run (Wave 12 / A6): in_progress -> completed, stamps completed_at. 3-arg cross-tenant guard (NOT_FOUND). Idempotent on an already-completed run. Status-only; no stock effect (daily-log posting moves stock).';

create or replace function public.close_job_run(
  p_run_id uuid,
  p_actor uuid,
  p_caller_org_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
  v_status text;
begin
  select org_id, status into v_org_id, v_status
    from public.job_runs where id = p_run_id;

  if v_org_id is null or v_org_id <> p_caller_org_id then
    raise exception 'NOT_FOUND: job run not found' using errcode = 'P0001';
  end if;

  if v_status = 'closed' then
    return p_run_id; -- idempotent
  end if;
  if v_status <> 'completed' then
    raise exception 'STATE_CONFLICT: job run not in completed state (was %)', v_status
      using errcode = 'P0001';
  end if;

  update public.job_runs
     set status = 'closed', closed_at = now(), updated_by = p_actor
   where id = p_run_id;

  return p_run_id;
end;
$$;

revoke execute on function public.close_job_run(uuid, uuid, uuid) from public, anon;
grant execute on function public.close_job_run(uuid, uuid, uuid) to authenticated, service_role;

comment on function public.close_job_run(uuid, uuid, uuid) is
  'Closes a completed Job Run (Wave 12 / A6): completed -> closed (terminal), stamps closed_at. 3-arg cross-tenant guard (NOT_FOUND). Idempotent on an already-closed run. Status-only; no stock effect.';

create or replace function public.cancel_job_run(
  p_run_id uuid,
  p_actor uuid,
  p_caller_org_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
  v_status text;
begin
  select org_id, status into v_org_id, v_status
    from public.job_runs where id = p_run_id;

  if v_org_id is null or v_org_id <> p_caller_org_id then
    raise exception 'NOT_FOUND: job run not found' using errcode = 'P0001';
  end if;

  if v_status = 'cancelled' then
    return p_run_id; -- idempotent
  end if;
  if v_status not in ('planned', 'in_progress') then
    raise exception 'STATE_CONFLICT: job run cannot be cancelled (was %)', v_status
      using errcode = 'P0001';
  end if;

  update public.job_runs
     set status = 'cancelled', cancelled_at = now(), updated_by = p_actor
   where id = p_run_id;

  return p_run_id;
end;
$$;

revoke execute on function public.cancel_job_run(uuid, uuid, uuid) from public, anon;
grant execute on function public.cancel_job_run(uuid, uuid, uuid) to authenticated, service_role;

comment on function public.cancel_job_run(uuid, uuid, uuid) is
  'Cancels a Job Run (Wave 12 / A6): planned|in_progress -> cancelled, stamps cancelled_at. 3-arg cross-tenant guard (NOT_FOUND). Idempotent on an already-cancelled run. Status-only; does NOT auto-reverse posted daily-log movements (reversal is an explicit adjustment, out of A6 scope).';

-- ---------------------------------------------------------------------------
-- Table comment.
-- ---------------------------------------------------------------------------

comment on table public.job_runs is
  '3PL Job Run header (Wave 12 / A6): the day-by-day floor execution of a project. FSM planned / in_progress / completed / closed; planned|in_progress -> cancelled; closed terminal. Daily logs (0099) carry the consumed / produced actuals and are the stock-affecting layer. job_template_snapshot freezes the source template at creation (A4 shape). run_number JR- (0100). Pattern A RLS.';
