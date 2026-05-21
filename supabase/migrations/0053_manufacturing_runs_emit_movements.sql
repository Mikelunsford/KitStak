-- ============================================================================
-- Migration: 0053_manufacturing_runs_emit_movements.sql
-- Wave: 9
-- Phase: Pillar 2 (Manufacturing) foundation, Path A step A2
-- Closes: F-Wave9-MFG-EMIT-MOVEMENTS-01. Prerequisite for A3
--   (manufacturing-api bundle), A4 (capabilities), A5 (SPA pages),
--   A6 (feature flag flip + operator-led smoke walk). Migration 0052
--   (Path A1) created the three new tables `manufacturing_runs`,
--   `manufacturing_run_consumed_line_items`, and
--   `manufacturing_run_produced_line_items` plus their audit triggers
--   but explicitly deferred stock_movements emission to this migration.
-- Date: 2026-05-20
--
-- DOWN MIGRATION (operator-only; not auto-run):
--   drop trigger if exists manufacturing_runs_emit_movements
--     on public.manufacturing_runs;
--   drop function if exists public.tg_manufacturing_runs_emit_movements();
--   This down is ready-to-run only while no manufacturing_runs row has
--   yet transitioned to `completed` in production. Once at least one
--   run has emitted stock_movements via this trigger, reverting would
--   leave those movement rows orphaned (no producer trigger), and any
--   subsequent run completion would silently no-op against inventory.
--   Operator must verify zero `manufacturing_run` source_entity_type
--   rows exist in stock_movements before reverting.
--
-- Constitutional alignment:
--   Migration rules    Forward-only. Idempotent via `create or replace
--                      function` and `drop trigger if exists` +
--                      `create trigger`. No existing migration edited;
--                      this is a new numbered file. No new top-level
--                      dependency.
--   Money rules        `unit_cost_cents` flows BIGINT cents end-to-end
--                      from manufacturing_run_*_line_items to
--                      stock_movements. Source columns are nullable so
--                      we preserve the 0048 / 0051 `coalesce(..., 0)`
--                      semantics: a NULL on the line surfaces as a
--                      0-cent cost on the movement row. `quantity`
--                      flows through as numeric(18,4) without
--                      truncation. No floating-point math.
--   RLS rules          Untouched. The new trigger function is SECURITY
--                      DEFINER with `set search_path = public`,
--                      mirroring tg_receiving_orders_emit_movements
--                      and tg_shipments_emit_movements as redefined in
--                      0051. Reads against the new line-item tables
--                      bypass RLS by design (same posture as the
--                      receiving / shipment emitters). No table
--                      policies, no GRANT or REVOKE changes.
--   Audit rules        Untouched. emit_movements writes go to
--                      `stock_movements`, not to `audit_log`. The
--                      manufacturing_runs status-transition audit
--                      trigger registered in 0052 continues to capture
--                      the draft|started -> completed transition as an
--                      append-only audit row on the hash chain. The
--                      stock_movements ledger is itself append-only
--                      (per 0030: reads-only for authenticated, only
--                      triggers and the service role can insert).
--   Idempotency rules  Untouched. No change to idempotency_keys, no
--                      change to any non-GET handler contract.
--
-- Trigger shape (mirror of 0051 + 0032):
--   AFTER UPDATE OF status ON manufacturing_runs FOR EACH ROW. The
--   `OF status` clause matches the receiving / shipment / production_runs
--   triggers in 0032 and the redefinition in 0051; the trigger therefore
--   fires only when the status column itself is part of the UPDATE
--   target list. The function body double-checks
--   `old.status IS DISTINCT FROM new.status AND new.status = 'completed'`
--   so non-completing transitions (draft -> started, draft -> cancelled,
--   started -> cancelled) are no-ops for inventory. A cancelled run
--   never produced anything and never consumed anything; no movements
--   are emitted. The `draft -> started` transition is also a no-op:
--   per operator decision, material is committed against the run only
--   at run completion. A future soft-hold trigger on started is filed
--   separately and is out of scope here.
--
-- movement_type codes (mirror of tg_production_runs_emit_movements):
--   Consumed materials -> 'production_consumed' (leaves inventory).
--   Produced outputs   -> 'production_produced' (enters inventory).
--   Both codes are members of the stock_movements.movement_type CHECK
--   constraint defined in 0030 and are summed with the canonical
--   direction signs by recompute_stock_level (0030): 'production_produced'
--   adds, 'production_consumed' subtracts. Manufacturing reuses the
--   existing production codes verbatim rather than introducing new
--   movement_type values; the constitutional rule is do-not-invent.
--   Pillar 1 production_runs and Pillar 2 manufacturing_runs are
--   distinguished at the ledger by `source_entity_type`
--   ('production_run' vs 'manufacturing_run').
--
-- Schema-driven guards (deltas from 0051):
--   manufacturing_run_consumed_line_items.item_id is NOT NULL at the
--   schema layer (per 0052). The consumed-side SELECT therefore needs
--   no `WHERE li.item_id IS NOT NULL` guard, matching the receiving /
--   shipment side from 0051.
--
--   manufacturing_run_produced_line_items.item_id is NULLABLE at the
--   schema layer (per 0052, lenient produced-side schema mirroring
--   F-Wave7-LINEFORM-VALIDATE-01). The produced-side SELECT MUST guard
--   with `WHERE li.item_id IS NOT NULL` so the descriptive-only output
--   rows (custom one-off outputs without a SKU) are skipped at terminal
--   transition and do not violate the NOT NULL contract on
--   stock_movements.item_id. Same forward-safe skip shape as 0048.
--
--   manufacturing_runs.warehouse_id is NULLABLE at the schema layer
--   (per 0052; not every manufacturing run is bound to a physical
--   warehouse at draft time). stock_movements.warehouse_id is NOT NULL
--   (per 0030). The outer guard
--   `if new.warehouse_id is null then return new` therefore short-
--   circuits emission for runs that complete without a warehouse
--   assignment; the operator can still close such a run for record-
--   keeping, but inventory is not affected. This is a delta from 0051,
--   where receiving_orders.warehouse_id and shipments.warehouse_id are
--   both NOT NULL and the guard is not required.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Trigger function: manufacturing_runs status -> completed emits
-- stock_movements rows from the two normalised child tables. Mirrors the
-- 0051 post-LINES-01 shape (SELECT-from-line-item-table, no per-line loop,
-- coalesce(unit_cost_cents, 0), order by position). Consumed-side has no
-- item_id guard because the column is NOT NULL at schema layer.
-- Produced-side carries `where li.item_id is not null` because the column
-- is nullable. Outer warehouse_id guard short-circuits when the run is
-- not warehouse-bound. Cancelled / draft / started -> nothing -> no-op.
-- ---------------------------------------------------------------------------

create or replace function public.tg_manufacturing_runs_emit_movements()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status is null
     or new.status = old.status
     or new.status <> 'completed' then
    return new;
  end if;

  if new.warehouse_id is null then
    return new;
  end if;

  -- Consumed materials leave inventory.
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
    'production_consumed',
    li.quantity,
    coalesce(li.unit_cost_cents, 0),
    'manufacturing_run',
    new.id,
    coalesce(new.completed_at, now()),
    new.updated_by
  from public.manufacturing_run_consumed_line_items li
  where li.org_id = new.org_id
    and li.manufacturing_run_id = new.id
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
    new.org_id,
    new.warehouse_id,
    li.item_id,
    'production_produced',
    li.quantity,
    coalesce(li.unit_cost_cents, 0),
    'manufacturing_run',
    new.id,
    coalesce(new.completed_at, now()),
    new.updated_by
  from public.manufacturing_run_produced_line_items li
  where li.org_id = new.org_id
    and li.manufacturing_run_id = new.id
    and li.item_id is not null
  order by li.position;

  return new;
end;
$$;

revoke execute on function public.tg_manufacturing_runs_emit_movements() from public, anon;

drop trigger if exists manufacturing_runs_emit_movements on public.manufacturing_runs;
create trigger manufacturing_runs_emit_movements
  after update of status on public.manufacturing_runs
  for each row execute function public.tg_manufacturing_runs_emit_movements();

comment on function public.tg_manufacturing_runs_emit_movements() is
  'Pillar 2 Manufacturing: on draft|started -> completed, emits production_consumed and production_produced stock_movements rows from the two normalised line-item tables. source_entity_type = manufacturing_run distinguishes Pillar 2 runs from Pillar 1 production_runs at the ledger. Mirrors the 0051 post-LINES-01 emit_movements shape.';
