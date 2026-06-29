-- ============================================================================
-- Migration: 0145_job_build_artifacts.sql
-- Wave: Estimate Engine + Job Builder (ADR 0006), Phase 2a (Job Builder schema)
-- Phase: Run-scoped build artifacts for the Job Builder. An approved quote
--   becomes a buildable job (convert_quote_to_project -> supply_plan -> job_run
--   -> receiving_order, all reused from the 3PL chain). The four artifacts the
--   design adds that have no column today are hung off the job_run, because they
--   describe a specific buildable job, not a reusable job_template:
--     - job_run_labels      labels with their printed data per label kind
--     - job_run_sow_steps   structured scope-of-work steps
--     - job_run_timeline    one build/ship timeline per run (planned + actuals)
--     - job_run_jacket      the approval jacket (a state machine)
--   This phase lands schema + RLS only; the edge handlers (build-from-quote,
--   artifact CRUD, jacket transitions) and the JobBuilder surface build on top.
-- Closes: ADR 0006 P2 schema. Plan
--   03-workspace/specs/2026-06-29-estimate-engine-and-job-builder-plan.md.
-- Date: 2026-06-29
--
-- DOWN MIGRATION (operator-only; forward-only repo, do not auto-apply):
--   drop trigger if exists audit_job_run_jacket on public.job_run_jacket;
--   drop function if exists public.trg_audit_job_run_jacket();
--   drop table if exists public.job_run_jacket;
--   drop table if exists public.job_run_timeline;
--   drop table if exists public.job_run_sow_steps;
--   drop table if exists public.job_run_labels;
--   -- audit_log_entity_type_check keeps 'job_run_jacket' (a harmless superset).
--
-- Constitutional alignment:
--   RLS rules          Pattern A on all four tables (org_id = current_org_id()).
--                      org_id is denormalized onto each artifact (NOT NULL,
--                      FK organizations) so the single-table org gate applies
--                      without a parent join; the job_run_id FK additionally
--                      scopes the artifact to its run (ON DELETE CASCADE). The
--                      edge handlers run service-role and add the explicit
--                      .eq('org_id', caller.orgId) filter plus requireCap.
--   Money rules        No money columns on these artifacts. The receiving order
--                      the build flow creates is a normal receiving_orders row
--                      (BIGINT cents on its lines), untouched here.
--   Audit rules        job_run_jacket has a state machine (draft -> approved /
--                      rejected), so it carries an auto-state-transition audit
--                      trigger writing through audit_append_state_change; the
--                      INSERT branch records creation. job_run_labels /
--                      job_run_sow_steps / job_run_timeline are run-scoped
--                      reference/build data with no lifecycle and are not
--                      audited, consistent with rate_card_lines / units.
--   Migration rules    Forward-only. All DDL idempotent (IF NOT EXISTS, guarded
--                      constraint swap, drop-then-create trigger).
--   State machine      job_run_jacket.status: draft -> approved, draft ->
--                      rejected, and re-open approved/rejected -> draft.
--                      Enforced by CHECK on the column; legal transitions are
--                      enforced by the edge handler (jacket approve / reject /
--                      reopen), mirroring the quote-approval pattern. The jacket
--                      is advisory by default: gating job_run start on an
--                      approved jacket is an edge decision (P2b open decision),
--                      not enforced at the schema.
--   Constraint         audit_log_entity_type_check extended with 'job_run_jacket'
--                      as a strict superset of the existing list (0144).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- job_run_labels: labels for a run, each carrying the actual printed data for
-- its label kind in the data jsonb (UPC code, ship-to + address, compliance
-- statement, lot + date, custom). Free-text label_kind / size so the design's
-- kinds and sizes extend without a migration.
-- ---------------------------------------------------------------------------

create table if not exists public.job_run_labels (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  job_run_id uuid not null references public.job_runs(id) on delete cascade,
  label_kind text not null default 'Custom',
  size text,
  data jsonb not null default '{}'::jsonb,
  qty integer not null default 0 check (qty >= 0),
  position int not null default 0,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid
);

create index if not exists job_run_labels_run_idx
  on public.job_run_labels(job_run_id, position);
create index if not exists job_run_labels_org_idx
  on public.job_run_labels(org_id);

alter table public.job_run_labels enable row level security;

drop policy if exists job_run_labels_select on public.job_run_labels;
create policy job_run_labels_select on public.job_run_labels
  for select to authenticated
  using (org_id = public.current_org_id());

drop policy if exists job_run_labels_insert on public.job_run_labels;
create policy job_run_labels_insert on public.job_run_labels
  for insert to authenticated
  with check (org_id = public.current_org_id());

drop policy if exists job_run_labels_update on public.job_run_labels;
create policy job_run_labels_update on public.job_run_labels
  for update to authenticated
  using (org_id = public.current_org_id())
  with check (org_id = public.current_org_id());

drop policy if exists job_run_labels_delete on public.job_run_labels;
create policy job_run_labels_delete on public.job_run_labels
  for delete to authenticated
  using (org_id = public.current_org_id());

-- ---------------------------------------------------------------------------
-- job_run_sow_steps: the structured scope of work for a run, in position order.
-- ---------------------------------------------------------------------------

create table if not exists public.job_run_sow_steps (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  job_run_id uuid not null references public.job_runs(id) on delete cascade,
  step_no int not null default 0,
  title text not null,
  detail text,
  duration_hours numeric check (duration_hours is null or duration_hours >= 0),
  position int not null default 0,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid
);

create index if not exists job_run_sow_steps_run_idx
  on public.job_run_sow_steps(job_run_id, position);
create index if not exists job_run_sow_steps_org_idx
  on public.job_run_sow_steps(org_id);

alter table public.job_run_sow_steps enable row level security;

drop policy if exists job_run_sow_steps_select on public.job_run_sow_steps;
create policy job_run_sow_steps_select on public.job_run_sow_steps
  for select to authenticated
  using (org_id = public.current_org_id());

drop policy if exists job_run_sow_steps_insert on public.job_run_sow_steps;
create policy job_run_sow_steps_insert on public.job_run_sow_steps
  for insert to authenticated
  with check (org_id = public.current_org_id());

drop policy if exists job_run_sow_steps_update on public.job_run_sow_steps;
create policy job_run_sow_steps_update on public.job_run_sow_steps
  for update to authenticated
  using (org_id = public.current_org_id())
  with check (org_id = public.current_org_id());

drop policy if exists job_run_sow_steps_delete on public.job_run_sow_steps;
create policy job_run_sow_steps_delete on public.job_run_sow_steps
  for delete to authenticated
  using (org_id = public.current_org_id());

-- ---------------------------------------------------------------------------
-- job_run_timeline: one build/ship timeline per run. Planned dates plus the
-- actuals filled as work progresses. mabd is the must-arrive-by date the
-- readiness check measures the ship date against (seeded from the project's
-- due date at build, operator-editable). Unique (job_run_id).
-- ---------------------------------------------------------------------------

create table if not exists public.job_run_timeline (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  job_run_id uuid not null references public.job_runs(id) on delete cascade,
  mabd date,
  materials_eta date,
  build_start date,
  build_end date,
  ship_date date,
  materials_received_on date,
  build_started_on date,
  build_ended_on date,
  shipped_on date,
  notes text,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  unique (job_run_id)
);

create index if not exists job_run_timeline_org_idx
  on public.job_run_timeline(org_id);

alter table public.job_run_timeline enable row level security;

drop policy if exists job_run_timeline_select on public.job_run_timeline;
create policy job_run_timeline_select on public.job_run_timeline
  for select to authenticated
  using (org_id = public.current_org_id());

drop policy if exists job_run_timeline_insert on public.job_run_timeline;
create policy job_run_timeline_insert on public.job_run_timeline
  for insert to authenticated
  with check (org_id = public.current_org_id());

drop policy if exists job_run_timeline_update on public.job_run_timeline;
create policy job_run_timeline_update on public.job_run_timeline
  for update to authenticated
  using (org_id = public.current_org_id())
  with check (org_id = public.current_org_id());

-- ---------------------------------------------------------------------------
-- job_run_jacket: the approval jacket for a run. A state machine (draft ->
-- approved / rejected; re-open back to draft). snapshot freezes a build summary
-- at approval. Unique (job_run_id).
-- ---------------------------------------------------------------------------

create table if not exists public.job_run_jacket (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  job_run_id uuid not null references public.job_runs(id) on delete cascade,
  status text not null default 'draft'
    check (status in ('draft', 'approved', 'rejected')),
  approved_by uuid,
  approved_at timestamptz,
  rejected_by uuid,
  rejected_at timestamptz,
  rejection_reason text,
  snapshot jsonb,
  notes text,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  unique (job_run_id)
);

create index if not exists job_run_jacket_org_status_idx
  on public.job_run_jacket(org_id, status);

alter table public.job_run_jacket enable row level security;

drop policy if exists job_run_jacket_select on public.job_run_jacket;
create policy job_run_jacket_select on public.job_run_jacket
  for select to authenticated
  using (org_id = public.current_org_id());

drop policy if exists job_run_jacket_insert on public.job_run_jacket;
create policy job_run_jacket_insert on public.job_run_jacket
  for insert to authenticated
  with check (org_id = public.current_org_id());

drop policy if exists job_run_jacket_update on public.job_run_jacket;
create policy job_run_jacket_update on public.job_run_jacket
  for update to authenticated
  using (org_id = public.current_org_id())
  with check (org_id = public.current_org_id());

-- ---------------------------------------------------------------------------
-- Audit: register 'job_run_jacket' as an auditable entity, then attach the
-- state-transition trigger. Strict superset of the current entity_type CHECK
-- (0144's full list plus 'job_run_jacket').
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
    'recurring_schedule', 'quote_tier', 'support_ticket', 'estimate',
    'job_run_jacket'
  ));

create or replace function public.trg_audit_job_run_jacket()
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
    v_diff := jsonb_build_object('status', new.status);
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
    v_org_id, 'job_run_jacket', v_entity_id, v_from, v_to, v_action, v_actor, v_diff);

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

revoke execute on function public.trg_audit_job_run_jacket() from public, anon;

drop trigger if exists audit_job_run_jacket on public.job_run_jacket;
create trigger audit_job_run_jacket
  after insert or update or delete on public.job_run_jacket
  for each row execute function public.trg_audit_job_run_jacket();
