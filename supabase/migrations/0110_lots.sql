-- ============================================================================
-- Migration: 0110_lots.sql
-- Wave: 12
-- Phase: WMS Body B, Phase B4 (lot and expiration capture). The lots parent
--   table plus full lot capture end to end: a received line can carry a lot
--   (receiving_order_line_items.lot_id), the receipt emitter threads that lot
--   onto the spine ledger row (alongside the 0108 dock location_id), and a
--   putaway task auto-defaults its lot from the source receiving line so the
--   putaway transfer cites the SAME lot the receipt credited at the dock. The
--   0107 bin recompute null-safe-matches lot, so a lot-keyed bin row appears and
--   reconciles at the (location, lot) grain. FEFO is groundwork only here (the
--   expiration_date index); FEFO consumption is a later phase.
-- Closes: F-Wave12-WMS-B4-01. Implements the B4 DB layer from
--   03-workspace/specs/2026-06-14-wms-bodyb-phase1-handoff.md (section
--   "B4. Lot and expiration capture", decisions (c) lot always optional and
--   (d) bin grain keys on lot) on top of the B1 warehouse_locations parent
--   (0106), the B2 stock-movement bin dimension (0107), the 0108 receiving dock,
--   and the B3 putaway_tasks (0109). The caps, byte-mirror Lot types, wms-api
--   /lots routes, the receiving line-item lot capture, and the SPA /wms/lots
--   surface are the B4 app layer.
-- Date: 2026-06-15
--
-- DOWN MIGRATION (operator-only; not auto-run). Drop in reverse:
--   -- 1) Restore the 0108 tg_receiving_orders_emit_movements body VERBATIM via
--   --    `create or replace function` so the emitted receipt stops carrying
--   --    lot_id (operator copies the function body from migration 0108, which
--   --    threads location_id := new.dock_location_id but no lot_id). The AFTER
--   --    UPDATE OF status trigger is NOT recreated (0032 registered it by name;
--   --    0048 / 0051 / 0108 only replaced the body).
--   drop index if exists public.receiving_order_line_items_lot_idx;
--   alter table public.receiving_order_line_items drop column if exists lot_id;
--   -- 2) Drop the three additive lot_id FK closures (the columns stay; they were
--   --    bare uuids before this migration and remain so after the drop).
--   alter table public.bin_stock_levels  drop constraint if exists bin_stock_levels_lot_id_fkey;
--   alter table public.putaway_tasks     drop constraint if exists putaway_tasks_lot_id_fkey;
--   alter table public.stock_movements   drop constraint if exists stock_movements_lot_id_fkey;
--   -- 3) Drop the lot RPC, triggers, policies, and table.
--   drop function if exists public.quarantine_lot(uuid, uuid, uuid);
--   drop trigger if exists audit_lots on public.lots;
--   drop trigger if exists lots_set_updated_at on public.lots;
--   drop function if exists public.trg_audit_lots();
--   drop function if exists public.trg_lots_set_updated_at();
--   drop policy if exists lots_write  on public.lots;
--   drop policy if exists lots_select on public.lots;
--   drop table if exists public.lots;
--   alter table public.audit_log drop constraint if exists audit_log_entity_type_check;
--   (operator restores the prior 0109 CHECK by hand if needed). Forward-only is
--   the constitutional path if any movement / putaway / bin row already cites a
--   lot.
--
-- Constitutional alignment:
--   RLS rules          Pattern A on creation. org_id is denormalised onto the
--                      row (references organizations ON DELETE CASCADE) so RLS
--                      evaluates without a parent join, mirroring 0106 / 0109.
--                      Selects are org-scoped only; the write policy is the
--                      INVENTORY 3-role set ('org_owner','org_admin','ops'),
--                      matching warehouse_locations (0106), putaway_tasks (0109),
--                      and warehouses (0030). WMS is warehouse execution, not the
--                      3PL commercial layer, so it does NOT carry sales.
--                      Cross-tenant reads return 200 + []; the RPC surfaces
--                      cross-tenant as NOT_FOUND (never 403).
--   Money rules        No _cents column. A lot carries no money: it is a
--                      provenance / expiry record, not a valuation. No monetary
--                      math here.
--   Audit rules        lots is a near-config FSM whose state is its status
--                      (active / quarantined / expired / consumed) so its trigger
--                      records from_state -> to_state on every status change plus
--                      created / deleted, via the central audit_append_state_change
--                      helper, mirroring trg_audit_putaway_tasks (0109). The
--                      audit_log entity_type CHECK is extended via a guarded
--                      drop-then-add that re-adds the full 0109 list plus lot.
--                      Strict superset; never a subset of any prior enumeration.
--   Spine ledger       lot capture does NOT change the append-only posture or any
--                      recompute. The 0108 receipt emitter is restated VERBATIM
--                      (same received-guard, same SELECT, same location_id :=
--                      new.dock_location_id) and ADDS lot_id := li.lot_id onto the
--                      same row. movement_type stays 'receipt'. The 0107 bin
--                      recompute already null-safe-matches lot_id; this migration
--                      simply supplies the lot so a lot-keyed bin row forms. The
--                      stock_movements RLS / CHECK / recompute are untouched.
--   Additive safety    receiving_order_line_items.lot_id is nullable with NO
--                      default and NO backfill: every existing line keeps a NULL
--                      lot, so the emitted receipt carries a NULL lot_id (the
--                      no-lot partition) and reconciles byte-identically to today.
--                      The three lot_id FK closures are additive only: the columns
--                      were bare uuids in 0107 / 0109 and are unpopulated, so the
--                      FK addition has zero data risk and no append-only / RLS /
--                      money / audit posture change on stock_movements.
--   Forward refs       stock_movements.lot_id, putaway_tasks.lot_id, and
--                      bin_stock_levels.lot_id were bare uuids in 0107 / 0109.
--                      Now that lots exists this migration closes their FKs ON
--                      DELETE SET NULL (a deleted lot unlinks the ledger / task /
--                      bin row without losing history). receiving_order_line_items
--                      .lot_id FKs lots(id) ON DELETE SET NULL too.
--   Migration rules    Forward-only. All DDL idempotent (IF EXISTS / IF NOT
--                      EXISTS, ADD COLUMN IF NOT EXISTS, guarded constraint
--                      drop-then-add for the audit CHECK and each FK, CREATE OR
--                      REPLACE). Does not edit any numbered file. The 0030
--                      movement_type CHECK is NOT touched (no new movement type).
--   State machine      lots.status text + CHECK (active / quarantined / expired /
--                      consumed). Phase 1 ships only the quarantine transition
--                      (active -> quarantined) as the minimal hold; the CHECK
--                      reserves expired / consumed for a later phase (expiry-driven
--                      auto-transition and FEFO consumption are named not promised).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Extend audit_log.entity_type CHECK to include lot. Guarded drop-then-add.
-- Re-adds every value authoritative as of 0109 (the latest carrier, which added
-- putaway_task on top of the 0106 warehouse_location list) plus lot. Strict
-- superset.
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
    'putaway_task',
    -- WMS Body B Lot and expiration capture (this migration, 0110)
    'lot'
  ));

comment on constraint audit_log_entity_type_check on public.audit_log is
  'Enumerates every entity_type allowed in audit_log. Authoritative full list as of 0110, which adds the WMS lot type on top of the 0109 list (which added putaway_task on top of the 0106 warehouse_location list). Update via forward migration when a new auditable entity ships, and never subset the prior list.';

-- ---------------------------------------------------------------------------
-- lots: a lot / batch of an item, with optional expiration. A near-config FSM
-- whose state is its status (active / quarantined / expired / consumed). org_id
-- is denormalised for Pattern A RLS. lot_code is unique per (org, item) among
-- live rows. Phase 1 captures the lot at receiving and putaway; FEFO selection
-- is groundwork only (the expiration_date index).
-- ---------------------------------------------------------------------------

create table if not exists public.lots (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  item_id uuid not null references public.items(id),
  lot_code text not null,
  expiration_date date,
  received_at timestamptz,
  status text not null default 'active'
    check (status in ('active', 'quarantined', 'expired', 'consumed')),
  notes text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  deleted_at timestamptz
);

-- lot_code is unique per (org, item) among live rows; a soft-deleted code can be
-- reused.
create unique index if not exists lots_org_item_code_uniq
  on public.lots (org_id, item_id, lot_code)
  where deleted_at is null;

create index if not exists lots_org_idx
  on public.lots (org_id)
  where deleted_at is null;

create index if not exists lots_org_status_idx
  on public.lots (org_id, status)
  where deleted_at is null;

-- FEFO groundwork: a cheap ordered scan by soonest expiry per item. Full FEFO
-- consumption (picking the soonest-expiry lot) is a later phase.
create index if not exists lots_org_item_expiration_idx
  on public.lots (org_id, item_id, expiration_date)
  where deleted_at is null;

alter table public.lots enable row level security;

drop policy if exists lots_select on public.lots;
create policy lots_select on public.lots
  for select to authenticated
  using (org_id = public.current_org_id());

drop policy if exists lots_write on public.lots;
create policy lots_write on public.lots
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

create or replace function public.trg_lots_set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end; $$;

drop trigger if exists lots_set_updated_at on public.lots;
create trigger lots_set_updated_at
  before update on public.lots
  for each row execute function public.trg_lots_set_updated_at();

-- ---------------------------------------------------------------------------
-- Audit trigger: lots. FSM shape (status is the state), so to_state carries the
-- status and from_state carries the prior status on transitions. INSERT records
-- created; DELETE records deleted. Mirrors trg_audit_putaway_tasks (0109).
-- ---------------------------------------------------------------------------

create or replace function public.trg_audit_lots()
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
      'status', new.status, 'item_id', new.item_id, 'lot_code', new.lot_code);
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
    v_org_id, 'lot', v_entity_id, v_from, v_to, v_action, v_actor, v_diff);

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

revoke execute on function public.trg_audit_lots() from public, anon;

drop trigger if exists audit_lots on public.lots;
create trigger audit_lots
  after insert or update or delete on public.lots
  for each row execute function public.trg_audit_lots();

-- ---------------------------------------------------------------------------
-- quarantine_lot: the minimal hold transition (active -> quarantined). The
-- 3-arg cross-tenant pattern: reads the lot's org from the row, NOT_FOUND on a
-- cross-tenant or missing lot (never 403), idempotent on an already-quarantined
-- lot, STATE_CONFLICT when not active. Mirrors the 0109 transition RPCs. expired
-- / consumed are deferred (the CHECK reserves the values); Phase 1 ships only
-- this hold.
-- ---------------------------------------------------------------------------

create or replace function public.quarantine_lot(
  p_lot_id uuid,
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
  -- Row lock (for update): serialises concurrent transitions on this lot so a
  -- second caller blocks until the first commits, then re-reads the status and
  -- returns idempotently.
  select org_id, status into v_org_id, v_status
    from public.lots where id = p_lot_id for update;

  if v_org_id is null or v_org_id <> p_caller_org_id then
    raise exception 'NOT_FOUND: lot not found' using errcode = 'P0001';
  end if;

  if v_status = 'quarantined' then
    return p_lot_id; -- idempotent
  end if;
  if v_status <> 'active' then
    raise exception 'STATE_CONFLICT: lot not in active state (was %)', v_status
      using errcode = 'P0001';
  end if;

  update public.lots
     set status = 'quarantined', updated_by = p_actor
   where id = p_lot_id;

  return p_lot_id;
end;
$$;

revoke execute on function public.quarantine_lot(uuid, uuid, uuid) from public, anon;
grant execute on function public.quarantine_lot(uuid, uuid, uuid) to authenticated, service_role;

comment on function public.quarantine_lot(uuid, uuid, uuid) is
  'Quarantines a lot (Wave 12 / B4): active -> quarantined as the minimal hold. 3-arg cross-tenant guard (NOT_FOUND). Idempotent on an already-quarantined lot; STATE_CONFLICT when not active. Phase 1 ships only this hold; expired / consumed are reserved by the CHECK for a later phase.';

-- ---------------------------------------------------------------------------
-- Close the three forward-ref lot_id FKs. stock_movements.lot_id (0107),
-- putaway_tasks.lot_id (0109), and bin_stock_levels.lot_id (0107) were bare
-- uuids until lots existed. Now FK each ON DELETE SET NULL so a deleted lot
-- unlinks the ledger / task / bin row without losing history. Guarded
-- (drop-if-exists then add) and idempotent; additive only, the columns are
-- unpopulated, zero data risk and no posture change.
-- ---------------------------------------------------------------------------

alter table public.stock_movements drop constraint if exists stock_movements_lot_id_fkey;
alter table public.stock_movements
  add constraint stock_movements_lot_id_fkey
  foreign key (lot_id) references public.lots(id) on delete set null;

alter table public.putaway_tasks drop constraint if exists putaway_tasks_lot_id_fkey;
alter table public.putaway_tasks
  add constraint putaway_tasks_lot_id_fkey
  foreign key (lot_id) references public.lots(id) on delete set null;

alter table public.bin_stock_levels drop constraint if exists bin_stock_levels_lot_id_fkey;
alter table public.bin_stock_levels
  add constraint bin_stock_levels_lot_id_fkey
  foreign key (lot_id) references public.lots(id) on delete set null;

-- ---------------------------------------------------------------------------
-- Receiving lot capture. A received line can carry a lot. Additive nullable
-- column with NO default and NO backfill; every existing line keeps a NULL lot.
-- ON DELETE SET NULL so a deleted lot unlinks the line without losing it.
-- ---------------------------------------------------------------------------

alter table public.receiving_order_line_items
  add column if not exists lot_id uuid
    references public.lots(id) on delete set null;

create index if not exists receiving_order_line_items_lot_idx
  on public.receiving_order_line_items (org_id, lot_id)
  where lot_id is not null;

-- ---------------------------------------------------------------------------
-- Redefine tg_receiving_orders_emit_movements to carry the per-line lot onto
-- every emitted receipt. RESTATES the 0108 body VERBATIM (same received-guard,
-- same SELECT from receiving_order_line_items ordered by position, same column
-- set and values INCLUDING location_id := new.dock_location_id) and ADDS
-- lot_id := li.lot_id to BOTH the stock_movements INSERT column list and the
-- SELECT. movement_type stays 'receipt'. The AFTER UPDATE OF status trigger from
-- 0032 is NOT recreated (it already points at this function by name; 0048 /
-- 0051 / 0108 only replaced the body). The revoke re-asserts that this trigger
-- function is not directly executable.
--
-- CRITICAL: this preserves the 0108 dock threading. The receipt now carries
-- BOTH location_id (the header dock) AND lot_id (the line lot), so the 0107
-- recompute lands a bin row at the full (location, lot) grain and the
-- sum-reconcile invariant holds. When dock_location_id or lot_id is NULL the
-- corresponding dimension is simply absent, byte-identical to today.
-- ---------------------------------------------------------------------------

create or replace function public.tg_receiving_orders_emit_movements()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status is null or new.status = old.status or new.status <> 'received' then
    return new;
  end if;

  insert into public.stock_movements (
    org_id, warehouse_id, item_id,
    movement_type, quantity, unit_cost_cents,
    source_entity_type, source_entity_id,
    occurred_at, created_by,
    location_id, lot_id
  )
  select
    new.org_id,
    new.warehouse_id,
    li.item_id,
    'receipt',
    li.quantity,
    coalesce(li.unit_cost_cents, 0),
    'receiving_order',
    new.id,
    coalesce(new.received_date::timestamptz, now()),
    new.updated_by,
    new.dock_location_id,
    li.lot_id
  from public.receiving_order_line_items li
  where li.org_id = new.org_id
    and li.receiving_order_id = new.id
  order by li.position;

  return new;
end;
$$;

revoke execute on function public.tg_receiving_orders_emit_movements() from public, anon;

-- ---------------------------------------------------------------------------
-- Table comment for operator discoverability.
-- ---------------------------------------------------------------------------

comment on table public.lots is
  'WMS Body B Lot and expiration capture (add-on six, warehouse execution; Wave 12 / B4): a lot / batch of an item with optional expiration. Near-config FSM whose state is its status (active / quarantined / expired / consumed); Phase 1 ships only the quarantine hold (active -> quarantined). lot_code is unique per (org, item) among live rows. Captured at receiving (receiving_order_line_items.lot_id, threaded onto the receipt) and at putaway (auto-defaulted from the source receiving line). The 0107 bin recompute null-safe-matches lot, so a lot-keyed bin row reconciles to the warehouse total. The expiration_date index is FEFO groundwork; FEFO consumption is a later phase. Pattern A RLS via denormalised org_id, write gated to the inventory 3-role set (org_owner / org_admin / ops).';
