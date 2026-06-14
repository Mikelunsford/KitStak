-- ============================================================================
-- Migration: 0099_job_run_daily_logs.sql
-- Wave: 12
-- Phase: 3PL commercial pivot, Phase A6 (Job Runs and Daily Progress), step 2 of
--   4 (daily logs, the consumed / produced line tables, and the stock-affecting
--   post RPC).
-- Closes: the daily-execution layer from
--   03-workspace/specs/2026-06-04-3pl-commercial-pivot-and-wms-pillar-plan.md
--   (section 6.1 job_run_daily_logs) and
--   03-workspace/specs/2026-06-13-3pl-a6-job-runs-handoff.md (decisions 3 and 5).
--   A job_run_daily_log is one day's work on a job_run (0098). Posting a draft
--   daily log emits spine stock_movements (consumed out, produced in) exactly
--   like the manufacturing run emit path (0053), reusing the existing 0030
--   production_consumed / production_produced movement types. No new ledger type.
-- Date: 2026-06-14
--
-- DOWN MIGRATION (operator-only; not auto-run). Drop in reverse:
--   drop function if exists public.post_job_run_daily_log(uuid, uuid, uuid);
--   drop trigger if exists audit_job_run_daily_log_produced_line_items on public.job_run_daily_log_produced_line_items;
--   drop trigger if exists audit_job_run_daily_log_consumed_line_items on public.job_run_daily_log_consumed_line_items;
--   drop trigger if exists audit_job_run_daily_logs on public.job_run_daily_logs;
--   drop trigger if exists job_run_daily_log_produced_line_items_set_updated_at on public.job_run_daily_log_produced_line_items;
--   drop trigger if exists job_run_daily_log_consumed_line_items_set_updated_at on public.job_run_daily_log_consumed_line_items;
--   drop trigger if exists job_run_daily_logs_set_updated_at on public.job_run_daily_logs;
--   drop function if exists public.trg_audit_job_run_daily_log_produced_line_items();
--   drop function if exists public.trg_audit_job_run_daily_log_consumed_line_items();
--   drop function if exists public.trg_audit_job_run_daily_logs();
--   drop function if exists public.trg_job_run_daily_log_produced_line_items_set_updated_at();
--   drop function if exists public.trg_job_run_daily_log_consumed_line_items_set_updated_at();
--   drop function if exists public.trg_job_run_daily_logs_set_updated_at();
--   drop policy if exists job_run_daily_log_produced_line_items_write  on public.job_run_daily_log_produced_line_items;
--   drop policy if exists job_run_daily_log_produced_line_items_select on public.job_run_daily_log_produced_line_items;
--   drop policy if exists job_run_daily_log_consumed_line_items_write  on public.job_run_daily_log_consumed_line_items;
--   drop policy if exists job_run_daily_log_consumed_line_items_select on public.job_run_daily_log_consumed_line_items;
--   drop policy if exists job_run_daily_logs_write  on public.job_run_daily_logs;
--   drop policy if exists job_run_daily_logs_select on public.job_run_daily_logs;
--   drop table if exists public.job_run_daily_log_produced_line_items;
--   drop table if exists public.job_run_daily_log_consumed_line_items;
--   drop table if exists public.job_run_daily_logs;
--   alter table public.audit_log drop constraint if exists audit_log_entity_type_check;
--   (operator restores the prior 0098 CHECK by hand if needed).
--   This down is ready-to-run only while no daily log has yet posted in
--   production. Once a log has emitted stock_movements via the post RPC,
--   reverting would orphan those movement rows. Operator must verify zero
--   job_run_daily_log source_entity_type rows exist in stock_movements first.
--
-- Constitutional alignment:
--   Money rules        labor_rate_cents and unit_cost_cents are BIGINT cents with
--                      the _cents suffix; nullable, no _cents math here. quantity
--                      and labor_hours are numeric(18,4). No floats.
--   RLS rules          Pattern A on all three tables from creation. org_id is
--                      denormalised onto the daily log and both line tables so
--                      RLS evaluates without a parent join, mirroring 0052. ON
--                      DELETE CASCADE down the chain. Write gated to the 3PL
--                      commercial roles ('org_owner','org_admin','ops','sales'),
--                      matching job_runs (0098). Cross-tenant reads 200 + []; the
--                      post RPC surfaces cross-tenant as NOT_FOUND (never 403).
--   Audit rules        job_run_daily_logs is a small FSM (draft / posted) so its
--                      trigger records from_state -> to_state plus created /
--                      deleted, mirroring trg_audit_supply_plans (0096). The two
--                      line tables use the created / updated / deleted action-verb
--                      pattern from 0052. The audit_log entity_type CHECK is
--                      extended via a guarded drop-then-add that re-adds the full
--                      0098 list plus the three daily-log entity_types. Strict
--                      superset.
--   Migration rules    Forward-only. All DDL idempotent. Does not edit 0098.
--   State machine      job_run_daily_logs.status text + CHECK draft / posted.
--                      Posting (draft -> posted) is the stock-affecting action,
--                      driven by the post_job_run_daily_log RPC and idempotent on
--                      an already-posted log.
--   Emit rules         Posting emits production_consumed (negative on_hand) for
--                      each consumed line and production_produced (positive
--                      on_hand) for each produced line with an item_id, only when
--                      the parent run has a warehouse_id. source_entity_type =
--                      'job_run_daily_log'. Reuses the existing 0030 movement
--                      types (do-not-invent); no reserve interplay here. Mirrors
--                      0053.
--   Out of scope       JR- numbering is 0100. The supply_plans.job_run_id link
--                      and fulfill RPC are 0101. Caps, three-pl-api routes,
--                      byte-mirror types, and the SPA are the A6 app layer.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Extend audit_log.entity_type CHECK to include the daily-log entities. Guarded
-- drop-then-add. Re-adds every value authoritative as of 0098 (which added
-- job_run) plus the three daily-log entity_types. Strict superset.
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
    'job_run',
    -- 3PL commercial layer Job Run daily logs (this migration, 0099)
    'job_run_daily_log',
    'job_run_daily_log_consumed_line_item', 'job_run_daily_log_produced_line_item'
  ));

comment on constraint audit_log_entity_type_check on public.audit_log is
  'Enumerates every entity_type allowed in audit_log. Authoritative full list as of 0099, which adds job_run_daily_log, job_run_daily_log_consumed_line_item, job_run_daily_log_produced_line_item on top of the 0098 list. Update via forward migration; never subset.';

-- ---------------------------------------------------------------------------
-- job_run_daily_logs: one day's work on a job_run. Child of job_runs,
-- denormalised org_id for Pattern A RLS. FSM draft / posted; posting is the
-- stock-affecting action. labor_hours / labor_rate_cents are the per-day labor
-- actuals (KitForce time entries link forward via kitforce_time_entry_id, a
-- nullable soft pointer with no FK so the link is optional and validated in-org
-- by the handler, decision 8).
-- ---------------------------------------------------------------------------

create table if not exists public.job_run_daily_logs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  job_run_id uuid not null references public.job_runs(id) on delete cascade,
  log_date date not null default current_date,
  labor_hours numeric(18,4) not null default 0 check (labor_hours >= 0),
  labor_rate_cents bigint check (labor_rate_cents is null or labor_rate_cents >= 0),
  kitforce_time_entry_id uuid,
  status text not null default 'draft'
    check (status in ('draft', 'posted')),
  posted_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid
);

create index if not exists job_run_daily_logs_parent_idx
  on public.job_run_daily_logs (org_id, job_run_id, log_date);
create index if not exists job_run_daily_logs_org_idx
  on public.job_run_daily_logs (org_id);
create index if not exists job_run_daily_logs_org_status_idx
  on public.job_run_daily_logs (org_id, status);

alter table public.job_run_daily_logs enable row level security;

drop policy if exists job_run_daily_logs_select on public.job_run_daily_logs;
create policy job_run_daily_logs_select on public.job_run_daily_logs
  for select to authenticated
  using (org_id = public.current_org_id());

drop policy if exists job_run_daily_logs_write on public.job_run_daily_logs;
create policy job_run_daily_logs_write on public.job_run_daily_logs
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
-- job_run_daily_log_consumed_line_items: materials consumed that day. item_id
-- REQUIRED (strict consumed-side schema, mirroring 0052). Child of the daily
-- log, denormalised org_id for Pattern A RLS.
-- ---------------------------------------------------------------------------

create table if not exists public.job_run_daily_log_consumed_line_items (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  job_run_daily_log_id uuid not null references public.job_run_daily_logs(id) on delete cascade,
  item_id uuid not null references public.items(id),
  quantity numeric(18,4) not null default 0 check (quantity >= 0),
  unit_cost_cents bigint check (unit_cost_cents is null or unit_cost_cents >= 0),
  uom text,
  position int not null default 0,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid
);

create index if not exists job_run_daily_log_consumed_line_items_parent_idx
  on public.job_run_daily_log_consumed_line_items (org_id, job_run_daily_log_id, position);
create index if not exists job_run_daily_log_consumed_line_items_org_idx
  on public.job_run_daily_log_consumed_line_items (org_id);
create index if not exists job_run_daily_log_consumed_line_items_item_idx
  on public.job_run_daily_log_consumed_line_items (item_id);

alter table public.job_run_daily_log_consumed_line_items enable row level security;

drop policy if exists job_run_daily_log_consumed_line_items_select on public.job_run_daily_log_consumed_line_items;
create policy job_run_daily_log_consumed_line_items_select on public.job_run_daily_log_consumed_line_items
  for select to authenticated
  using (org_id = public.current_org_id());

drop policy if exists job_run_daily_log_consumed_line_items_write on public.job_run_daily_log_consumed_line_items;
create policy job_run_daily_log_consumed_line_items_write on public.job_run_daily_log_consumed_line_items
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
-- job_run_daily_log_produced_line_items: outputs that day. Same shape as
-- consumed EXCEPT item_id is NULLABLE (lenient produced-side schema, mirroring
-- 0052). Produced lines without an item_id are descriptive only and are skipped
-- by the post emit (they have no SKU to move).
-- ---------------------------------------------------------------------------

create table if not exists public.job_run_daily_log_produced_line_items (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  job_run_daily_log_id uuid not null references public.job_run_daily_logs(id) on delete cascade,
  item_id uuid references public.items(id),
  quantity numeric(18,4) not null default 0 check (quantity >= 0),
  unit_cost_cents bigint check (unit_cost_cents is null or unit_cost_cents >= 0),
  uom text,
  position int not null default 0,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid
);

create index if not exists job_run_daily_log_produced_line_items_parent_idx
  on public.job_run_daily_log_produced_line_items (org_id, job_run_daily_log_id, position);
create index if not exists job_run_daily_log_produced_line_items_org_idx
  on public.job_run_daily_log_produced_line_items (org_id);
create index if not exists job_run_daily_log_produced_line_items_item_idx
  on public.job_run_daily_log_produced_line_items (item_id)
  where item_id is not null;

alter table public.job_run_daily_log_produced_line_items enable row level security;

drop policy if exists job_run_daily_log_produced_line_items_select on public.job_run_daily_log_produced_line_items;
create policy job_run_daily_log_produced_line_items_select on public.job_run_daily_log_produced_line_items
  for select to authenticated
  using (org_id = public.current_org_id());

drop policy if exists job_run_daily_log_produced_line_items_write on public.job_run_daily_log_produced_line_items;
create policy job_run_daily_log_produced_line_items_write on public.job_run_daily_log_produced_line_items
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
-- updated_at stamping triggers. Plain BEFORE UPDATE; no audit side effect.
-- ---------------------------------------------------------------------------

create or replace function public.trg_job_run_daily_logs_set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end; $$;

drop trigger if exists job_run_daily_logs_set_updated_at on public.job_run_daily_logs;
create trigger job_run_daily_logs_set_updated_at
  before update on public.job_run_daily_logs
  for each row execute function public.trg_job_run_daily_logs_set_updated_at();

create or replace function public.trg_job_run_daily_log_consumed_line_items_set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end; $$;

drop trigger if exists job_run_daily_log_consumed_line_items_set_updated_at
  on public.job_run_daily_log_consumed_line_items;
create trigger job_run_daily_log_consumed_line_items_set_updated_at
  before update on public.job_run_daily_log_consumed_line_items
  for each row execute function public.trg_job_run_daily_log_consumed_line_items_set_updated_at();

create or replace function public.trg_job_run_daily_log_produced_line_items_set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end; $$;

drop trigger if exists job_run_daily_log_produced_line_items_set_updated_at
  on public.job_run_daily_log_produced_line_items;
create trigger job_run_daily_log_produced_line_items_set_updated_at
  before update on public.job_run_daily_log_produced_line_items
  for each row execute function public.trg_job_run_daily_log_produced_line_items_set_updated_at();

-- ---------------------------------------------------------------------------
-- Audit trigger: job_run_daily_logs. Small FSM (draft / posted), so to_state
-- carries the status. INSERT records created; DELETE records deleted. Mirrors
-- trg_audit_supply_plans (0096).
-- ---------------------------------------------------------------------------

create or replace function public.trg_audit_job_run_daily_logs()
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
      'status', new.status, 'job_run_id', new.job_run_id, 'log_date', new.log_date);
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
    v_org_id, 'job_run_daily_log', v_entity_id, v_from, v_to, v_action, v_actor, v_diff);

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

revoke execute on function public.trg_audit_job_run_daily_logs() from public, anon;

drop trigger if exists audit_job_run_daily_logs on public.job_run_daily_logs;
create trigger audit_job_run_daily_logs
  after insert or update or delete on public.job_run_daily_logs
  for each row execute function public.trg_audit_job_run_daily_logs();

-- ---------------------------------------------------------------------------
-- Audit trigger: job_run_daily_log_consumed_line_items. created / updated /
-- deleted action verbs in to_state, mirroring 0052.
-- ---------------------------------------------------------------------------

create or replace function public.trg_audit_job_run_daily_log_consumed_line_items()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid;
  v_org_id uuid;
  v_entity_id uuid;
  v_to text;
  v_action text;
  v_diff jsonb;
begin
  if tg_op = 'INSERT' then
    v_org_id := new.org_id; v_entity_id := new.id; v_to := 'created'; v_action := 'insert';
    begin v_actor := coalesce(auth.uid(), new.created_by);
    exception when others then v_actor := new.created_by; end;
    v_diff := jsonb_build_object(
      'job_run_daily_log_id', new.job_run_daily_log_id, 'item_id', new.item_id,
      'quantity', new.quantity, 'unit_cost_cents', new.unit_cost_cents,
      'uom', new.uom, 'position', new.position);
  elsif tg_op = 'UPDATE' then
    v_org_id := new.org_id; v_entity_id := new.id; v_to := 'updated'; v_action := 'update';
    begin v_actor := coalesce(auth.uid(), new.updated_by);
    exception when others then v_actor := new.updated_by; end;
    v_diff := jsonb_build_object(
      'item_id', jsonb_build_object('from', old.item_id, 'to', new.item_id),
      'quantity', jsonb_build_object('from', old.quantity, 'to', new.quantity),
      'unit_cost_cents', jsonb_build_object('from', old.unit_cost_cents, 'to', new.unit_cost_cents),
      'position', jsonb_build_object('from', old.position, 'to', new.position));
  else
    v_org_id := old.org_id; v_entity_id := old.id; v_to := 'deleted'; v_action := 'delete';
    begin v_actor := coalesce(auth.uid(), old.updated_by);
    exception when others then v_actor := old.updated_by; end;
    v_diff := jsonb_build_object(
      'job_run_daily_log_id', old.job_run_daily_log_id, 'item_id', old.item_id,
      'quantity', old.quantity, 'unit_cost_cents', old.unit_cost_cents);
  end if;

  perform public.audit_append_state_change(
    v_org_id, 'job_run_daily_log_consumed_line_item', v_entity_id,
    null, v_to, v_action, v_actor, v_diff);

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

revoke execute on function public.trg_audit_job_run_daily_log_consumed_line_items() from public, anon;

drop trigger if exists audit_job_run_daily_log_consumed_line_items
  on public.job_run_daily_log_consumed_line_items;
create trigger audit_job_run_daily_log_consumed_line_items
  after insert or update or delete on public.job_run_daily_log_consumed_line_items
  for each row execute function public.trg_audit_job_run_daily_log_consumed_line_items();

-- ---------------------------------------------------------------------------
-- Audit trigger: job_run_daily_log_produced_line_items. Same pattern as the
-- consumed-side trigger above; only the entity_type label differs.
-- ---------------------------------------------------------------------------

create or replace function public.trg_audit_job_run_daily_log_produced_line_items()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid;
  v_org_id uuid;
  v_entity_id uuid;
  v_to text;
  v_action text;
  v_diff jsonb;
begin
  if tg_op = 'INSERT' then
    v_org_id := new.org_id; v_entity_id := new.id; v_to := 'created'; v_action := 'insert';
    begin v_actor := coalesce(auth.uid(), new.created_by);
    exception when others then v_actor := new.created_by; end;
    v_diff := jsonb_build_object(
      'job_run_daily_log_id', new.job_run_daily_log_id, 'item_id', new.item_id,
      'quantity', new.quantity, 'unit_cost_cents', new.unit_cost_cents,
      'uom', new.uom, 'position', new.position);
  elsif tg_op = 'UPDATE' then
    v_org_id := new.org_id; v_entity_id := new.id; v_to := 'updated'; v_action := 'update';
    begin v_actor := coalesce(auth.uid(), new.updated_by);
    exception when others then v_actor := new.updated_by; end;
    v_diff := jsonb_build_object(
      'item_id', jsonb_build_object('from', old.item_id, 'to', new.item_id),
      'quantity', jsonb_build_object('from', old.quantity, 'to', new.quantity),
      'unit_cost_cents', jsonb_build_object('from', old.unit_cost_cents, 'to', new.unit_cost_cents),
      'position', jsonb_build_object('from', old.position, 'to', new.position));
  else
    v_org_id := old.org_id; v_entity_id := old.id; v_to := 'deleted'; v_action := 'delete';
    begin v_actor := coalesce(auth.uid(), old.updated_by);
    exception when others then v_actor := old.updated_by; end;
    v_diff := jsonb_build_object(
      'job_run_daily_log_id', old.job_run_daily_log_id, 'item_id', old.item_id,
      'quantity', old.quantity, 'unit_cost_cents', old.unit_cost_cents);
  end if;

  perform public.audit_append_state_change(
    v_org_id, 'job_run_daily_log_produced_line_item', v_entity_id,
    null, v_to, v_action, v_actor, v_diff);

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

revoke execute on function public.trg_audit_job_run_daily_log_produced_line_items() from public, anon;

drop trigger if exists audit_job_run_daily_log_produced_line_items
  on public.job_run_daily_log_produced_line_items;
create trigger audit_job_run_daily_log_produced_line_items
  after insert or update or delete on public.job_run_daily_log_produced_line_items
  for each row execute function public.trg_audit_job_run_daily_log_produced_line_items();

-- ---------------------------------------------------------------------------
-- post_job_run_daily_log: draft -> posted. The stock-affecting action. When the
-- parent run has a warehouse_id, emit production_consumed (leaves inventory) for
-- each consumed line and production_produced (enters inventory) for each produced
-- line that carries an item_id, with source_entity_type = 'job_run_daily_log'.
-- Reuses the existing 0030 movement types (no new ledger type). occurred_at is
-- the log_date so the ledger reflects the day the work happened. 3-arg
-- cross-tenant guard (reads the log's org, NOT_FOUND never 403). Idempotent on an
-- already-posted log. Mirrors the 0053 manufacturing emit path.
-- ---------------------------------------------------------------------------

create or replace function public.post_job_run_daily_log(
  p_log_id uuid,
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
  v_log_date date;
  v_warehouse_id uuid;
begin
  select dl.org_id, dl.status, dl.log_date, jr.warehouse_id
    into v_org_id, v_status, v_log_date, v_warehouse_id
    from public.job_run_daily_logs dl
    join public.job_runs jr on jr.id = dl.job_run_id and jr.org_id = dl.org_id
   where dl.id = p_log_id;

  if v_org_id is null or v_org_id <> p_caller_org_id then
    raise exception 'NOT_FOUND: job run daily log not found' using errcode = 'P0001';
  end if;

  if v_status = 'posted' then
    return p_log_id; -- idempotent
  end if;
  if v_status <> 'draft' then
    raise exception 'STATE_CONFLICT: daily log not in draft state (was %)', v_status
      using errcode = 'P0001';
  end if;

  if v_warehouse_id is not null then
    -- Consumed materials leave inventory. item_id is NOT NULL at schema layer.
    insert into public.stock_movements (
      org_id, warehouse_id, item_id,
      movement_type, quantity, unit_cost_cents,
      source_entity_type, source_entity_id,
      occurred_at, created_by
    )
    select
      v_org_id, v_warehouse_id, li.item_id,
      'production_consumed', li.quantity, coalesce(li.unit_cost_cents, 0),
      'job_run_daily_log', p_log_id,
      coalesce(v_log_date::timestamptz, now()), p_actor
    from public.job_run_daily_log_consumed_line_items li
    where li.org_id = v_org_id
      and li.job_run_daily_log_id = p_log_id
    order by li.position;

    -- Produced outputs enter inventory. Skip lines without an item_id
    -- (descriptive-only outputs from the lenient produced-side schema).
    insert into public.stock_movements (
      org_id, warehouse_id, item_id,
      movement_type, quantity, unit_cost_cents,
      source_entity_type, source_entity_id,
      occurred_at, created_by
    )
    select
      v_org_id, v_warehouse_id, li.item_id,
      'production_produced', li.quantity, coalesce(li.unit_cost_cents, 0),
      'job_run_daily_log', p_log_id,
      coalesce(v_log_date::timestamptz, now()), p_actor
    from public.job_run_daily_log_produced_line_items li
    where li.org_id = v_org_id
      and li.job_run_daily_log_id = p_log_id
      and li.item_id is not null
    order by li.position;
  end if;

  update public.job_run_daily_logs
     set status = 'posted', posted_at = now(), updated_by = p_actor
   where id = p_log_id;

  return p_log_id;
end;
$$;

revoke execute on function public.post_job_run_daily_log(uuid, uuid, uuid) from public, anon;
grant execute on function public.post_job_run_daily_log(uuid, uuid, uuid) to authenticated, service_role;

comment on function public.post_job_run_daily_log(uuid, uuid, uuid) is
  'Posts a draft Job Run daily log (Wave 12 / A6): draft -> posted. When the parent run has a warehouse_id, emits production_consumed and production_produced stock_movements from the daily log consumed / produced line tables (source_entity_type = job_run_daily_log), reusing the 0030 movement types. 3-arg cross-tenant guard (NOT_FOUND). Idempotent on an already-posted log. Mirrors the 0053 emit path.';

-- ---------------------------------------------------------------------------
-- Table comments.
-- ---------------------------------------------------------------------------

comment on table public.job_run_daily_logs is
  'One day''s work on a job_run (Wave 12 / A6). FSM draft / posted; posting emits the consumed / produced stock_movements. labor_hours / labor_rate_cents are the per-day labor actuals. kitforce_time_entry_id is a nullable soft link to a KitForce time entry (no FK, validated in-org by the handler). Child of job_runs, denormalised org_id for Pattern A RLS.';
comment on table public.job_run_daily_log_consumed_line_items is
  'Materials consumed on a job_run_daily_log (Wave 12 / A6). item_id REQUIRED (strict consumed-side schema). Pattern A RLS via denormalised org_id.';
comment on table public.job_run_daily_log_produced_line_items is
  'Outputs of a job_run_daily_log (Wave 12 / A6). item_id NULLABLE (lenient produced-side schema); descriptive-only lines without an item_id are skipped by the post emit. Pattern A RLS via denormalised org_id.';
