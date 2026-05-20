-- ============================================================================
-- Migration: 0051_emit_movements_read_line_item_tables.sql
-- Wave: 7
-- Phase: 8 follow-up (Phase 7 stabilization carryover)
-- Closes: F-Wave7-EMIT-MOVEMENTS-MIGRATION-01 (step 2 of the LINES-01
--   multi-stage drop plan recorded in
--   03-workspace/journal/phase-7-lines-normalization.md). Migration 0050
--   added `receiving_order_line_items` and `shipment_line_items` and the
--   ops-api handlers dual-write to both the new tables and the parent's
--   `payload.lines` JSON. The two emit_movements triggers, however, still
--   read from `payload.lines` (the bodies redefined in migration 0048).
--   This migration is step 2: redefine the two trigger function bodies via
--   `create or replace function` so the receiving and shipment terminal
--   transitions read from the new normalised tables instead of the JSON
--   mirror. The handler dual-write remains in place for one more release
--   (step 3 of the plan is F-Wave7-LINES-DUAL-WRITE-DROP-01); the
--   `payload.lines` field drop is step 4 (F-Wave7-LINES-PAYLOAD-DROP-01).
-- Date: 2026-05-20
-- DOWN MIGRATION (operator-only, not auto-run):
--   Replay the byte-for-byte function bodies from migration 0048
--   (supabase/migrations/0048_emit_movements_skip_lines_without_item_id.sql,
--   lines 59..107 for tg_receiving_orders_emit_movements and lines
--   195..243 for tg_shipments_emit_movements) via `create or replace
--   function` to point the trigger reads back at
--   `(new.payload -> 'lines')`. The `tg_production_runs_emit_movements`
--   function is untouched by this migration and needs no rollback. This
--   down is NOT ready-to-run: by the time the operator considers reverting,
--   the handler dual-write to `payload.lines` may already have been
--   dropped (step 3 of the plan), in which case `payload.lines` on rows
--   touched after that release will be stale relative to the line-item
--   tables. The reverted triggers would then under-report stock_movements
--   on those rows. Operator must verify dual-write is still active before
--   reverting.
--
-- Constitutional alignment:
--   Migration rules    Forward-only. Idempotent via `create or replace
--                      function`. The two AFTER UPDATE OF status triggers
--                      defined in 0032 are NOT recreated; only the function
--                      bodies change. The third emit_movements trigger
--                      (tg_production_runs_emit_movements) is OUT OF SCOPE
--                      and is intentionally not touched here. Normalising
--                      production_runs lines is filed as
--                      F-Wave7-PRODUCTION-LINES-NORMALIZE-01.
--   Money rules        unit_cost_cents stays BIGINT cents on the way into
--                      stock_movements, sourced from the
--                      receiving_order_line_items.unit_cost_cents BIGINT
--                      column added in 0050. The column is nullable on the
--                      new tables (the JSON shape treated unit_cost_cents
--                      as optional); the trigger preserves the 0048
--                      `coalesce(..., 0)` semantics so a NULL on the line
--                      surfaces as a 0-cent cost on the movement row,
--                      matching the pre-migration behaviour byte-for-byte.
--                      `quantity numeric(18,4)` flows through unmodified;
--                      no truncation to integer. No floating-point math.
--   Audit rules        Untouched. emit_movements writes go to
--                      `stock_movements`, not to `audit_log`. The
--                      independent audit_status state-transition triggers
--                      registered in 0033 / 0037 continue to capture the
--                      receiving / shipment terminal transitions as
--                      append-only audit rows. This migration touches only
--                      the two stock_movements emitter bodies; the audit
--                      triggers are unaffected.
--   RLS rules          Untouched. Both trigger functions remain SECURITY
--                      DEFINER with `set search_path = public` and the
--                      same SET role as 0048 / 0032 produced. No table
--                      policies, no GRANT or REVOKE changes. The new
--                      reads against receiving_order_line_items /
--                      shipment_line_items run inside a SECURITY DEFINER
--                      function and so bypass RLS by design, which is the
--                      same posture the JSON read had in 0048.
--   Idempotency rules  Untouched. No change to idempotency_keys, no change
--                      to any non-GET handler contract.
--   Behaviour          Lines that landed in receiving_order_line_items /
--                      shipment_line_items via the 0050 backfill or via
--                      the ops-api line-item handlers become the source of
--                      truth for stock_movements emission. Historical
--                      `payload.lines` entries that the 0050 backfill
--                      skipped (because item_id was missing or non-UUID)
--                      remain in `payload.lines` but are now silently
--                      ignored by the trigger, which is the intended
--                      forward-safe shape of the multi-stage drop. The
--                      new table's `item_id NOT NULL references items(id)`
--                      column means every row qualifies; the 0048 skip
--                      guard (the `exception when others then v_item_id
--                      := null; ... if v_item_id is null then continue`
--                      block) is no longer required because the column
--                      itself enforces non-null at the schema layer. The
--                      new trigger bodies therefore drop the per-line
--                      exception block and read item_id directly from the
--                      table column. `unit_cost_cents` is still wrapped
--                      in coalesce(..., 0) because the column is nullable
--                      on the new tables.
--
-- Trigger ordering note:
--   The receive RPC (`POST /receiving-orders/:id/receive`) at
--   supabase/functions/ops-api/index.ts:352..374 flips
--   receiving_orders.status to 'received' inside a single UPDATE
--   statement that fires the AFTER UPDATE OF status trigger registered
--   in 0032. At trigger time the receiving_order_line_items rows have
--   already been inserted by the line-item POST handlers (the operator
--   adds lines BEFORE pressing Receive); the receive RPC itself does
--   not touch the line-item table. The new trigger body therefore
--   reads the canonical line-item rows for `new.org_id` and `new.id`
--   directly. Same ordering for the ship RPC and the shipment_line_items
--   table.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Trigger function: receiving_orders status -> received emits stock_movements
-- from receiving_order_line_items (the normalised table added in 0050)
-- instead of `(new.payload -> 'lines')` JSON. The skip-missing-item_id guard
-- from 0048 is no longer required: the new table column is
-- `item_id NOT NULL references items(id)`, so every row qualifies. Other
-- semantics preserved byte-for-byte against 0048: movement_type 'receipt',
-- occurred_at coalesces new.received_date cast to timestamptz then now(),
-- created_by mirrors new.updated_by, source_entity_type / source_entity_id
-- point at the parent receiving_order.
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
    occurred_at, created_by
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
    new.updated_by
  from public.receiving_order_line_items li
  where li.org_id = new.org_id
    and li.receiving_order_id = new.id
  order by li.position;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Trigger function: shipments status -> shipped emits stock_movements
-- from shipment_line_items (the normalised table added in 0050) instead of
-- `(new.payload -> 'lines')` JSON. Same shape as the receiving trigger
-- above: the item_id NOT NULL column on the new table removes the need for
-- the 0048 exception-wrapped skip guard. Other semantics preserved
-- byte-for-byte against 0048: movement_type 'shipment', occurred_at
-- coalesces new.ship_date cast to timestamptz then now(), created_by
-- mirrors new.updated_by, source_entity_type / source_entity_id point at
-- the parent shipment.
-- ---------------------------------------------------------------------------

create or replace function public.tg_shipments_emit_movements()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status is null or new.status = old.status or new.status <> 'shipped' then
    return new;
  end if;

  insert into public.stock_movements (
    org_id, warehouse_id, item_id,
    movement_type, quantity, unit_cost_cents,
    source_entity_type, source_entity_id,
    occurred_at, created_by
  )
  select
    new.org_id,
    new.warehouse_id,
    li.item_id,
    'shipment',
    li.quantity,
    coalesce(li.unit_cost_cents, 0),
    'shipment',
    new.id,
    coalesce(new.ship_date::timestamptz, now()),
    new.updated_by
  from public.shipment_line_items li
  where li.org_id = new.org_id
    and li.shipment_id = new.id
  order by li.position;

  return new;
end;
$$;
