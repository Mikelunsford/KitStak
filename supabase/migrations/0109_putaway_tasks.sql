-- ============================================================================
-- Migration: 0109_putaway_tasks.sql
-- Wave: 12
-- Phase: WMS Body B, Phase B3 (directed putaway). A putaway_task is a directed
--   move: take received stock off the dock and stow it in a final bin. The task
--   is a rich FSM (suggested / in_progress / done / cancelled). Completing a
--   task is a warehouse-flat INTERNAL MOVE: it emits TWO existing-type stock
--   movements, transfer_out at the source dock and transfer_in at the
--   destination bin, same quantity, so the warehouse total stays flat while the
--   bin grain shifts the stock from the dock to the bin (via the 0107 bin
--   recompute). No new ledger type is invented.
-- Closes: F-Wave12-WMS-B3-01. Implements the B3 DB layer from
--   03-workspace/specs/2026-06-14-wms-bodyb-phase1-handoff.md (section
--   "B3. Directed putaway") on top of the B1 warehouse_locations parent (0106),
--   the B2 stock-movement bin dimension (0107), and the receiving-to-dock source
--   (0108). The caps, byte-mirror PutawayTask types, wms-api /putaway routes, and
--   the SPA /wms/putaway surface are the B3 app layer.
-- Date: 2026-06-15
--
-- DOWN MIGRATION (operator-only; not auto-run). Drop in reverse:
--   drop index if exists public.stock_movements_putaway_task_uniq;
--   drop function if exists public.cancel_putaway_task(uuid, uuid, uuid);
--   drop function if exists public.complete_putaway_task(uuid, uuid, uuid);
--   drop function if exists public.start_putaway_task(uuid, uuid, uuid);
--   drop trigger if exists audit_putaway_tasks on public.putaway_tasks;
--   drop trigger if exists putaway_tasks_set_updated_at on public.putaway_tasks;
--   drop function if exists public.trg_audit_putaway_tasks();
--   drop function if exists public.trg_putaway_tasks_set_updated_at();
--   drop policy if exists putaway_tasks_write  on public.putaway_tasks;
--   drop policy if exists putaway_tasks_select on public.putaway_tasks;
--   drop table if exists public.putaway_tasks;
--   alter table public.audit_log drop constraint if exists audit_log_entity_type_check;
--   (operator restores the prior 0106 CHECK by hand if needed). Forward-only is
--   the constitutional path if any movement has already been emitted by a
--   completed task; the transfer_out / transfer_in rows stay in the ledger.
--
-- Constitutional alignment:
--   RLS rules          Pattern A on creation. org_id is denormalised onto the
--                      row (references organizations ON DELETE CASCADE) so RLS
--                      evaluates without a parent join, mirroring 0106. Selects
--                      are org-scoped only; the write policy is the INVENTORY
--                      3-role set ('org_owner','org_admin','ops'), matching
--                      warehouse_locations (0106) and warehouses (0030). WMS is
--                      warehouse execution, not the 3PL commercial layer, so it
--                      does NOT carry sales. Cross-tenant reads return 200 + [];
--                      the RPCs surface cross-tenant as NOT_FOUND (never 403).
--   Money rules        No _cents column. The emitted transfer movements carry
--                      unit_cost_cents = 0: a putaway is an internal relocation,
--                      not a revaluation, and the existing warehouse cost rollups
--                      net to zero across the paired transfer_out / transfer_in.
--                      No monetary math here.
--   Audit rules        putaway_tasks is a rich FSM (suggested / in_progress /
--                      done / cancelled) so its trigger records from_state ->
--                      to_state on every status change plus created / deleted,
--                      via the central audit_append_state_change helper, mirroring
--                      trg_audit_job_runs (0098). The emitted stock_movements are
--                      the spine ledger's own append-only record (source_entity_*
--                      points back at the task). The audit_log entity_type CHECK is
--                      extended via a guarded drop-then-add that re-adds the full
--                      0106 list plus putaway_task. Strict superset.
--   Ledger model       complete_putaway_task is a warehouse-flat internal move. It
--                      emits transfer_out at the source dock (location_id =
--                      source_location_id) and transfer_in at the destination bin
--                      (location_id = actual_location_id), same quantity. Per the
--                      0030 signed-CASE, transfer_out is -quantity and transfer_in
--                      is +quantity at the warehouse grain, so they net to ZERO
--                      (warehouse total flat); the 0107 AFTER INSERT trigger fires
--                      the bin recompute per row, so the source bin decreases and
--                      the destination bin increases by quantity. Reuses the
--                      existing 0030 movement types: no new ledger type. When
--                      source_location_id is NULL the transfer_out is a no-bin
--                      reduction (warehouse -qty, no bin row), still warehouse-flat
--                      against the transfer_in; correct for stock that was in the
--                      no-bin partition. When actual_location_id is NULL the
--                      complete is a status-only no-op (no movement at all).
--   Idempotency        The transition RPCs are idempotent on their target state
--                      (return the id when already there) so a retried complete
--                      does not double-emit. Concurrency-safety: each transition
--                      RPC opens with a `select ... for update` row lock on the
--                      task, so two concurrent completes serialise (the second
--                      blocks until the first commits, re-reads status = 'done',
--                      and returns idempotently without a second transfer pair).
--                      A DB-enforced backstop, the partial unique index
--                      stock_movements_putaway_task_uniq on (source_entity_id,
--                      movement_type) where source_entity_type = 'putaway_task',
--                      guarantees each task emits at most one transfer_out and one
--                      transfer_in even under a lock-bypass: a double emit violates
--                      the index and fails loudly instead of corrupting the bin
--                      grain. The index is additive and partial (scoped to
--                      putaway_task rows): no append-only posture change, no RLS /
--                      money / audit change on stock_movements. Handler-table
--                      Idempotency-Key contract is unchanged.
--   Migration rules    Forward-only. All DDL idempotent (IF EXISTS / IF NOT
--                      EXISTS, guarded constraint drop-then-add, CREATE OR
--                      REPLACE). Does not edit any numbered file. The 0030
--                      movement_type CHECK is NOT touched (no new type).
--   State machine      putaway_tasks.status text + CHECK. suggested ->
--                      in_progress -> done; suggested|in_progress -> cancelled;
--                      done is terminal. Transitions are driven by the three
--                      SECURITY DEFINER RPCs (start / cancel / complete), each
--                      idempotent on its target state, with paired <state>_at
--                      stamps.
--   Spine references   warehouse_id references warehouses; item_id references
--                      items; source / suggested / actual location_id reference
--                      warehouse_locations ON DELETE SET NULL (a deleted bin
--                      unlinks the task without losing its history). lot_id is a
--                      bare uuid (its FK lands in B4 once lots exists, the chassis
--                      bare-uuid forward-ref convention); license_plate_id is a
--                      bare uuid. source_entity_type / source_entity_id are a
--                      free-form audit ref (no FK), e.g. the receiving_order the
--                      stock arrived on.
--   Out of scope       Lots (the lot_id FK and lot capture) are B4. No new bundle
--                      gate: wms-api is already plugins.wms-gated.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Extend audit_log.entity_type CHECK to include putaway_task. Guarded
-- drop-then-add. Re-adds every value authoritative as of 0106 (the latest
-- carrier, which added warehouse_location on top of the 0102 list; 0107 and 0108
-- add NO entity_type) plus putaway_task. Strict superset.
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
    'job_run_daily_log',
    'job_run_daily_log_consumed_line_item', 'job_run_daily_log_produced_line_item',
    'billing_review',
    'warehouse_location',
    -- WMS Body B Directed putaway (this migration, 0109)
    'putaway_task'
  ));

comment on constraint audit_log_entity_type_check on public.audit_log is
  'Enumerates every entity_type allowed in audit_log. Authoritative full list as of 0109, which adds the WMS putaway_task type on top of the 0106 list (0107 and 0108 add no entity_type). Update via forward migration when a new auditable entity ships, and never subset the prior list.';

-- ---------------------------------------------------------------------------
-- putaway_tasks: a directed move of received stock from a dock to a final bin.
-- Pattern A. Rich FSM suggested / in_progress / done / cancelled with paired
-- timestamps. org_id is denormalised for RLS. source_location_id is the dock the
-- stock is pulled from (the ledger source for the transfer_out); suggested_/
-- actual_location_id are the recommended and final destination bins. lot_id is a
-- bare uuid (FK closed in B4). source_entity_type / source_entity_id are a
-- free-form audit ref (no FK).
-- ---------------------------------------------------------------------------

create table if not exists public.putaway_tasks (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  warehouse_id uuid not null references public.warehouses(id),
  item_id uuid not null references public.items(id),
  quantity numeric(18,4) not null check (quantity > 0),
  source_location_id uuid references public.warehouse_locations(id) on delete set null,
  suggested_location_id uuid references public.warehouse_locations(id) on delete set null,
  actual_location_id uuid references public.warehouse_locations(id) on delete set null,
  lot_id uuid,
  license_plate_id uuid,
  source_entity_type text,
  source_entity_id uuid,
  status text not null default 'suggested'
    check (status in ('suggested', 'in_progress', 'done', 'cancelled')),
  started_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  notes text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  deleted_at timestamptz
);

create index if not exists putaway_tasks_org_idx
  on public.putaway_tasks (org_id) where deleted_at is null;
create index if not exists putaway_tasks_org_status_idx
  on public.putaway_tasks (org_id, status) where deleted_at is null;
create index if not exists putaway_tasks_org_warehouse_idx
  on public.putaway_tasks (org_id, warehouse_id) where deleted_at is null;
create index if not exists putaway_tasks_source_location_idx
  on public.putaway_tasks (source_location_id) where source_location_id is not null;
create index if not exists putaway_tasks_suggested_location_idx
  on public.putaway_tasks (suggested_location_id) where suggested_location_id is not null;
create index if not exists putaway_tasks_actual_location_idx
  on public.putaway_tasks (actual_location_id) where actual_location_id is not null;

alter table public.putaway_tasks enable row level security;

drop policy if exists putaway_tasks_select on public.putaway_tasks;
create policy putaway_tasks_select on public.putaway_tasks
  for select to authenticated
  using (org_id = public.current_org_id());

drop policy if exists putaway_tasks_write on public.putaway_tasks;
create policy putaway_tasks_write on public.putaway_tasks
  for all to authenticated
  using (
    org_id = public.current_org_id()
    and public.current_user_role() in ('org_owner', 'org_admin', 'ops')
  )
  with check (
    org_id = public.current_org_id()
    and public.current_user_role() in ('org_owner', 'org_admin', 'ops')
  );

-- ---------------------------------------------------------------------------
-- updated_at stamping trigger. Plain BEFORE UPDATE; no audit side effect.
-- ---------------------------------------------------------------------------

create or replace function public.trg_putaway_tasks_set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end; $$;

drop trigger if exists putaway_tasks_set_updated_at on public.putaway_tasks;
create trigger putaway_tasks_set_updated_at
  before update on public.putaway_tasks
  for each row execute function public.trg_putaway_tasks_set_updated_at();

-- ---------------------------------------------------------------------------
-- Audit trigger: putaway_tasks. Rich FSM, so to_state carries the status and
-- from_state carries the prior status on transitions. INSERT records created;
-- DELETE records deleted. Mirrors trg_audit_job_runs (0098).
-- ---------------------------------------------------------------------------

create or replace function public.trg_audit_putaway_tasks()
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
      'status', new.status, 'warehouse_id', new.warehouse_id, 'item_id', new.item_id);
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
    v_org_id, 'putaway_task', v_entity_id, v_from, v_to, v_action, v_actor, v_diff);

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

revoke execute on function public.trg_audit_putaway_tasks() from public, anon;

drop trigger if exists audit_putaway_tasks on public.putaway_tasks;
create trigger audit_putaway_tasks
  after insert or update or delete on public.putaway_tasks
  for each row execute function public.trg_audit_putaway_tasks();

-- ---------------------------------------------------------------------------
-- FSM transition RPCs. Each is the 3-arg cross-tenant pattern: reads the task's
-- org from the row, NOT_FOUND on a cross-tenant or missing task (never 403),
-- idempotent on its target state, STATE_CONFLICT on an out-of-order transition.
-- Mirrors start_job_run / cancel_job_run / complete_job_run (0098). start and
-- cancel are pure status flips with the paired <state>_at stamp; complete also
-- emits the warehouse-flat internal move (transfer_out + transfer_in).
-- ---------------------------------------------------------------------------

create or replace function public.start_putaway_task(
  p_putaway_task_id uuid,
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
  -- Row lock (for update): serialises concurrent transitions on this task so a
  -- second caller blocks until the first commits, then re-reads the status and
  -- returns idempotently. With complete this is what prevents a double-emit of
  -- the transfer pair under concurrency.
  select org_id, status into v_org_id, v_status
    from public.putaway_tasks where id = p_putaway_task_id for update;

  if v_org_id is null or v_org_id <> p_caller_org_id then
    raise exception 'NOT_FOUND: putaway task not found' using errcode = 'P0001';
  end if;

  if v_status = 'in_progress' then
    return p_putaway_task_id; -- idempotent
  end if;
  if v_status <> 'suggested' then
    raise exception 'STATE_CONFLICT: putaway task not in suggested state (was %)', v_status
      using errcode = 'P0001';
  end if;

  update public.putaway_tasks
     set status = 'in_progress', started_at = now(), updated_by = p_actor
   where id = p_putaway_task_id;

  return p_putaway_task_id;
end;
$$;

revoke execute on function public.start_putaway_task(uuid, uuid, uuid) from public, anon;
grant execute on function public.start_putaway_task(uuid, uuid, uuid) to authenticated, service_role;

comment on function public.start_putaway_task(uuid, uuid, uuid) is
  'Starts a suggested putaway task (Wave 12 / B3): suggested -> in_progress, stamps started_at. 3-arg cross-tenant guard (NOT_FOUND). Idempotent on an already-started task. Status-only; no stock effect.';

create or replace function public.cancel_putaway_task(
  p_putaway_task_id uuid,
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
  -- Row lock (for update): serialises concurrent transitions on this task so a
  -- second caller blocks until the first commits, then re-reads the status and
  -- returns idempotently.
  select org_id, status into v_org_id, v_status
    from public.putaway_tasks where id = p_putaway_task_id for update;

  if v_org_id is null or v_org_id <> p_caller_org_id then
    raise exception 'NOT_FOUND: putaway task not found' using errcode = 'P0001';
  end if;

  if v_status = 'cancelled' then
    return p_putaway_task_id; -- idempotent
  end if;
  -- any state except done can be cancelled.
  if v_status = 'done' then
    raise exception 'STATE_CONFLICT: putaway task cannot be cancelled (was %)', v_status
      using errcode = 'P0001';
  end if;

  update public.putaway_tasks
     set status = 'cancelled', cancelled_at = now(), updated_by = p_actor
   where id = p_putaway_task_id;

  return p_putaway_task_id;
end;
$$;

revoke execute on function public.cancel_putaway_task(uuid, uuid, uuid) from public, anon;
grant execute on function public.cancel_putaway_task(uuid, uuid, uuid) to authenticated, service_role;

comment on function public.cancel_putaway_task(uuid, uuid, uuid) is
  'Cancels a putaway task (Wave 12 / B3): any state except done -> cancelled, stamps cancelled_at. 3-arg cross-tenant guard (NOT_FOUND). Idempotent on an already-cancelled task. Status-only; does NOT reverse a movement (only a completed task has emitted one, and done is terminal).';

create or replace function public.complete_putaway_task(
  p_putaway_task_id uuid,
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
  v_warehouse_id uuid;
  v_item_id uuid;
  v_quantity numeric(18,4);
  v_source_location_id uuid;
  v_actual_location_id uuid;
  v_lot_id uuid;
begin
  -- Row lock (for update): serialises concurrent completes on this task. The
  -- second transaction blocks here until the first commits, then re-reads
  -- status = 'done' below and returns idempotently, so the transfer_out /
  -- transfer_in pair is emitted exactly once. The
  -- stock_movements_putaway_task_uniq partial unique index is the DB-enforced
  -- backstop if a lock is ever bypassed.
  select org_id, status, warehouse_id, item_id, quantity,
         source_location_id, actual_location_id, lot_id
    into v_org_id, v_status, v_warehouse_id, v_item_id, v_quantity,
         v_source_location_id, v_actual_location_id, v_lot_id
    from public.putaway_tasks where id = p_putaway_task_id for update;

  if v_org_id is null or v_org_id <> p_caller_org_id then
    raise exception 'NOT_FOUND: putaway task not found' using errcode = 'P0001';
  end if;

  if v_status = 'done' then
    return p_putaway_task_id; -- idempotent: a retried complete never double-emits
  end if;
  if v_status <> 'in_progress' then
    raise exception 'STATE_CONFLICT: putaway task not in in_progress state (was %)', v_status
      using errcode = 'P0001';
  end if;

  update public.putaway_tasks
     set status = 'done', completed_at = now(), updated_by = p_actor
   where id = p_putaway_task_id;

  -- Warehouse-flat internal move. Emit only when a destination bin is set; with
  -- no actual_location_id the complete is a status-only no-op (decision (e)). The
  -- 0107 AFTER INSERT trigger fires the warehouse + bin recomputes per row; do
  -- not call recompute directly. unit_cost_cents = 0: a relocation, not a
  -- revaluation. transfer_out at the source dock and transfer_in at the
  -- destination bin net to zero at the warehouse grain (0030 signed-CASE), so the
  -- warehouse total stays flat while the bin grain shifts the quantity. When
  -- v_source_location_id is NULL the transfer_out is a no-bin reduction (warehouse
  -- -qty, no bin row), still warehouse-flat against the transfer_in.
  if v_actual_location_id is not null then
    insert into public.stock_movements (
      org_id, warehouse_id, item_id,
      location_id, lot_id,
      movement_type, quantity, unit_cost_cents,
      source_entity_type, source_entity_id,
      occurred_at, created_by
    ) values (
      v_org_id, v_warehouse_id, v_item_id,
      v_source_location_id, v_lot_id,
      'transfer_out', v_quantity, 0,
      'putaway_task', p_putaway_task_id,
      now(), p_actor
    ), (
      v_org_id, v_warehouse_id, v_item_id,
      v_actual_location_id, v_lot_id,
      'transfer_in', v_quantity, 0,
      'putaway_task', p_putaway_task_id,
      now(), p_actor
    );
  end if;

  return p_putaway_task_id;
end;
$$;

revoke execute on function public.complete_putaway_task(uuid, uuid, uuid) from public, anon;
grant execute on function public.complete_putaway_task(uuid, uuid, uuid) to authenticated, service_role;

comment on function public.complete_putaway_task(uuid, uuid, uuid) is
  'Completes a putaway task (Wave 12 / B3): in_progress -> done, stamps completed_at, THEN emits the warehouse-flat internal move. 3-arg cross-tenant guard (NOT_FOUND). Idempotent on an already-done task (no double emit). When actual_location_id is set it inserts transfer_out at source_location_id and transfer_in at actual_location_id (same quantity, unit_cost_cents 0), netting to zero at the warehouse grain while the 0107 bin recompute shifts the bin stock; with no actual_location_id it is a status-only no-op.';

-- ---------------------------------------------------------------------------
-- Backstop: a partial unique index on the emitted stock_movements. Each
-- putaway task emits exactly ONE transfer_out and ONE transfer_in (the paired
-- warehouse-flat move), so (source_entity_id, movement_type) is unique within
-- the source_entity_type = 'putaway_task' partition. The for-update row lock in
-- complete_putaway_task is the primary concurrency guard; this index is the
-- DB-enforced backstop, so if a lock is ever bypassed a double emit violates
-- the constraint and fails loudly instead of silently corrupting the bin grain.
-- Additive and partial: it touches only putaway_task-sourced rows, so the
-- append-only posture and the RLS / money / audit rules on stock_movements are
-- unchanged. Idempotent (IF NOT EXISTS).
-- ---------------------------------------------------------------------------

create unique index if not exists stock_movements_putaway_task_uniq
  on public.stock_movements (source_entity_id, movement_type)
  where source_entity_type = 'putaway_task';

-- ---------------------------------------------------------------------------
-- Table comment for operator discoverability.
-- ---------------------------------------------------------------------------

comment on table public.putaway_tasks is
  'WMS Body B Directed putaway (add-on six, warehouse execution; Wave 12 / B3): a directed move of received stock from a dock (source_location_id) to a final bin (actual_location_id). FSM suggested / in_progress / done; suggested|in_progress -> cancelled; done terminal. Completing a task emits a warehouse-flat internal move (transfer_out at the dock + transfer_in at the bin, existing 0030 types, unit_cost_cents 0), so the warehouse total stays flat while the 0107 bin recompute shifts the stock. lot_id is a bare uuid (FK lands in B4). source_entity_type / source_entity_id are a free-form audit ref (e.g. the receiving_order the stock arrived on). Pattern A RLS via denormalised org_id, write gated to the inventory 3-role set (org_owner / org_admin / ops).';
