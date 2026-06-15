-- ============================================================================
-- Migration: 0108_receiving_to_dock.sql
-- Wave: 12
-- Phase: WMS Body B receiving-to-dock (inserted ahead of B3 putaway and B4
--   lots; the spine-touching receive path). The append-only stock_movements
--   ledger already carries the additive nullable bin dimension (location_id,
--   0107). This migration lets the receive path SET that location: receiving
--   orders gain a single header dock (dock_location_id), and the receipt-emitting
--   trigger applies it to every line it emits. One dock per receipt
--   (operator decision, locked): the dock is a HEADER column on receiving_orders,
--   never per line.
-- Closes: F-Wave12-WMS-RECEIVE-DOCK-01.
-- Date: 2026-06-15
--
-- DOWN MIGRATION (operator-only; not auto-run). Reverse in order:
--   -- 1) Restore the 0051 tg_receiving_orders_emit_movements body VERBATIM via
--   --    `create or replace function` so the emitted receipt stops carrying
--   --    location_id (operator copies the function body from migration 0051
--   --    lines 120..155). The AFTER UPDATE OF status trigger is NOT recreated
--   --    (it already references this function by name; 0048 / 0051 only replaced
--   --    the body, never the trigger).
--   -- 2) Drop the dock index, then the column. Forward-only is the constitutional
--   --    path if any receiving_order already carries a non-null dock_location_id.
--   drop index if exists public.receiving_orders_dock_location_idx;
--   alter table public.receiving_orders drop column if exists dock_location_id;
--
-- Constitutional alignment:
--   stock_movements        Append-only posture UNCHANGED. No new write policy.
--                          No movement_type added: the emitted movement stays
--                          'receipt'. This migration only makes the receipt CARRY
--                          a location_id (the existing additive nullable column
--                          from 0107). The stock_movements RLS / CHECK are not
--                          touched.
--   Warehouse recompute    recompute_stock_level (warehouse grain, 0030 / 0095)
--                          UNCHANGED. The trigger still fires it on every receipt
--                          insert.
--   Bin recompute          The 0107 recompute_bin_stock_level + the 0107
--                          stock_movements_recompute_ai AFTER INSERT trigger are
--                          UNCHANGED. They already fire the bin rollup whenever a
--                          movement carries a non-null location_id; this migration
--                          simply supplies that location_id on the receipt.
--   Audit rules            UNCHANGED. No new entity_type. The
--                          audit_log_entity_type_check is NOT touched (0106 stays
--                          the authoritative redefinition). The receiving_orders
--                          state-transition audit trigger is unaffected: a new
--                          nullable header column does not change the audit path.
--   Money rules            UNCHANGED. No _cents column. unit_cost_cents flows
--                          through the receipt exactly as 0051 emitted it.
--   Idempotency            UNCHANGED. dock_location_id is an additive header
--                          field; the receive / create / patch handlers keep
--                          their Idempotency-Key contract.
--   Additive safety        dock_location_id is nullable with NO default and NO
--                          backfill. Every existing receiving order keeps a NULL
--                          dock, so the emitted receipt carries a NULL location_id
--                          (the WMS-off / pre-WMS partition) and only the warehouse
--                          recompute runs, byte-identical to today.
--   Off-flag no-op         A strict NULL no-op when plugins.wms is off: the SPA
--                          omits the picker so dock_location_id stays NULL, the
--                          receipt carries NULL location_id, and the sum-reconcile
--                          invariant is preserved by the byte-identical 0107
--                          recompute (the warehouse total stays the sole rollup).
--   Migration rules        Forward-only. All DDL idempotent (ADD COLUMN IF NOT
--                          EXISTS, CREATE INDEX IF NOT EXISTS, CREATE OR REPLACE).
--                          Does not edit any numbered file. The AFTER UPDATE OF
--                          status trigger registered in 0032 is NOT recreated;
--                          only the function body changes (0048 / 0051 precedent).
--   Spine references       dock_location_id FKs warehouse_locations (exists after
--                          0106) ON DELETE SET NULL: if the chosen dock is later
--                          deleted, the receipt history is preserved and the
--                          header simply unlinks. lot_id is NOT threaded here
--                          (lots are B4).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Additive nullable dock on receiving_orders. The inbound dock / staging
--    location for the WHOLE receipt (one dock per receipt). Nullable, NO default,
--    NO backfill. warehouse_locations exists after 0106. ON DELETE SET NULL so a
--    deleted dock unlinks the header without losing the receipt.
-- ---------------------------------------------------------------------------

alter table public.receiving_orders
  add column if not exists dock_location_id uuid
    references public.warehouse_locations(id) on delete set null;

-- Partial index over live dock links, matching the partial-index convention used
-- elsewhere in the codebase (e.g. receiving_orders_org_status_idx in 0032).
create index if not exists receiving_orders_dock_location_idx
  on public.receiving_orders (org_id, dock_location_id)
  where dock_location_id is not null;

-- ---------------------------------------------------------------------------
-- 2) Redefine tg_receiving_orders_emit_movements to carry the header dock onto
--    every emitted receipt. RESTATES the 0051 body verbatim (same guard, same
--    SELECT from receiving_order_line_items ordered by position, same column set
--    and values) and ADDS location_id := new.dock_location_id to the
--    stock_movements INSERT for EVERY line. movement_type stays 'receipt'. lot_id
--    is NOT threaded (B4). The AFTER UPDATE OF status trigger from 0032 is NOT
--    recreated (it already points at this function by name; 0048 / 0051 only
--    replaced the body). The revoke re-asserts that this trigger function is not
--    directly executable.
--
--    When new.dock_location_id is non-null the emitted receipt carries
--    location_id and the existing 0107 stock_movements_recompute_ai trigger fires
--    recompute_bin_stock_level, landing the bin row; when null only the warehouse
--    recompute runs, byte-identical to today.
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
    location_id
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
    new.dock_location_id
  from public.receiving_order_line_items li
  where li.org_id = new.org_id
    and li.receiving_order_id = new.id
  order by li.position;

  return new;
end;
$$;

revoke execute on function public.tg_receiving_orders_emit_movements() from public, anon;
