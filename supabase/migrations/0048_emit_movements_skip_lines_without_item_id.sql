-- Migration: 0048_emit_movements_skip_lines_without_item_id.sql
-- Wave: 6
-- Phase: 6.5 hotfix (post Phase 6 chassis)
-- Closes: F-Wave6-EMIT-MOVEMENTS-01
-- Date: 2026-05-19
--
-- DOWN MIGRATION (operator-only, not auto-run):
--   Restore the three trigger function bodies from migration 0032 by
--   replaying CREATE OR REPLACE FUNCTION for:
--     public.tg_receiving_orders_emit_movements()
--     public.tg_production_runs_emit_movements()
--     public.tg_shipments_emit_movements()
--   using the byte-for-byte bodies as originally defined in
--   supabase/migrations/0032_ops_receiving_production_shipments.sql
--   (lines 172..209, 224..285, 299..336). This down is NOT
--   ready-to-run: existing receiving / shipment / production_runs
--   rows may have payload lines that omit item_id (descriptive-only
--   lines such as { name, quantity }). Restoring the original bodies
--   would re-introduce the NOT NULL violation on the next terminal
--   transition for those rows. Operator must first scrub or backfill
--   payload lines before reverting.
--
-- Constitutional alignment:
--   Audit rules: untouched. The audit_log hash chain and the separate
--     audit_*_status state-transition triggers (registered in 0033 and
--     0037) continue to write append-only audit rows on every status
--     change. This migration touches only the emit_movements trigger
--     function bodies; the audit triggers are independent.
--   Migration rules: forward-only. Idempotent via CREATE OR REPLACE
--     FUNCTION. The AFTER UPDATE OF status triggers themselves are
--     NOT recreated; only the function bodies change.
--   RLS rules: untouched. No table policies, no GRANT or REVOKE
--     changes beyond what already exists on these SECURITY DEFINER
--     functions in 0032.
--   Money rules: untouched. unit_cost_cents continues to use bigint
--     cents with the same coalesce(..., 0) shape. No floating point
--     math introduced.
--   Idempotency rules: untouched. No change to idempotency_keys or
--     to any non-GET handler contract.
--   Behaviour: lines whose payload.item_id is missing, NULL, or not
--     castable to a valid UUID are now skipped for stock movement
--     emission at the receiving / production-consumed / shipment
--     terminal transitions. Until F-Wave7-LINES-01 normalises
--     receiving / shipment / production lines into real tables with
--     an FK-enforced item_id column, payload JSON lines may carry
--     descriptive-only fields (name, quantity) and would otherwise
--     crash the terminal transition with a NOT NULL violation on
--     stock_movements.item_id. Skipping is the only forward-safe
--     shape that preserves the operator's ability to transition.
--     The produced branch on production_runs is preserved
--     byte-for-byte; it already coalesces to new.output_item_id
--     which is NOT NULL on production_runs.

-- ---------------------------------------------------------------------------
-- Trigger function: receiving_orders status -> received emits stock_movements.
-- Skip lines whose payload.item_id is missing or not a valid UUID.
-- ---------------------------------------------------------------------------

create or replace function public.tg_receiving_orders_emit_movements()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_line jsonb;
  v_item_id uuid;
begin
  if new.status is null or new.status = old.status or new.status <> 'received' then
    return new;
  end if;

  for v_line in
    select * from jsonb_array_elements(coalesce(new.payload -> 'lines', '[]'::jsonb))
  loop
    begin
      v_item_id := (v_line ->> 'item_id')::uuid;
    exception when others then
      v_item_id := null;
    end;

    if v_item_id is null then
      continue;
    end if;

    insert into public.stock_movements (
      org_id, warehouse_id, item_id,
      movement_type, quantity, unit_cost_cents,
      source_entity_type, source_entity_id,
      occurred_at, created_by
    ) values (
      new.org_id,
      new.warehouse_id,
      v_item_id,
      'receipt',
      coalesce((v_line ->> 'quantity')::numeric, 0),
      coalesce((v_line ->> 'unit_cost_cents')::bigint, 0),
      'receiving_order',
      new.id,
      coalesce(new.received_date::timestamptz, now()),
      new.updated_by
    );
  end loop;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Trigger function: production_runs status -> completed emits stock_movements.
-- Skip consumed lines whose payload.item_id is missing or not a valid UUID.
-- The produced branch is preserved byte-for-byte from 0032 because
-- production_runs.output_item_id is NOT NULL and provides a safe fallback.
-- ---------------------------------------------------------------------------

create or replace function public.tg_production_runs_emit_movements()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_line jsonb;
  v_item_id uuid;
  v_produced jsonb;
begin
  if new.status is null or new.status = old.status or new.status <> 'completed' then
    return new;
  end if;

  -- Consumed components
  for v_line in
    select * from jsonb_array_elements(coalesce(new.payload -> 'consumed', '[]'::jsonb))
  loop
    begin
      v_item_id := (v_line ->> 'item_id')::uuid;
    exception when others then
      v_item_id := null;
    end;

    if v_item_id is null then
      continue;
    end if;

    insert into public.stock_movements (
      org_id, warehouse_id, item_id,
      movement_type, quantity, unit_cost_cents,
      source_entity_type, source_entity_id,
      occurred_at, created_by
    ) values (
      new.org_id,
      new.warehouse_id,
      v_item_id,
      'production_consumed',
      coalesce((v_line ->> 'quantity')::numeric, 0),
      coalesce((v_line ->> 'unit_cost_cents')::bigint, 0),
      'production_run',
      new.id,
      coalesce(new.completed_at, now()),
      new.updated_by
    );
  end loop;

  -- Produced output
  v_produced := new.payload -> 'produced';
  if v_produced is not null then
    insert into public.stock_movements (
      org_id, warehouse_id, item_id,
      movement_type, quantity, unit_cost_cents,
      source_entity_type, source_entity_id,
      occurred_at, created_by
    ) values (
      new.org_id,
      new.warehouse_id,
      coalesce((v_produced ->> 'item_id')::uuid, new.output_item_id),
      'production_produced',
      coalesce((v_produced ->> 'quantity')::numeric, new.quantity_produced),
      coalesce((v_produced ->> 'unit_cost_cents')::bigint, 0),
      'production_run',
      new.id,
      coalesce(new.completed_at, now()),
      new.updated_by
    );
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Trigger function: shipments status -> shipped emits stock_movements.
-- Skip lines whose payload.item_id is missing or not a valid UUID.
-- ---------------------------------------------------------------------------

create or replace function public.tg_shipments_emit_movements()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_line jsonb;
  v_item_id uuid;
begin
  if new.status is null or new.status = old.status or new.status <> 'shipped' then
    return new;
  end if;

  for v_line in
    select * from jsonb_array_elements(coalesce(new.payload -> 'lines', '[]'::jsonb))
  loop
    begin
      v_item_id := (v_line ->> 'item_id')::uuid;
    exception when others then
      v_item_id := null;
    end;

    if v_item_id is null then
      continue;
    end if;

    insert into public.stock_movements (
      org_id, warehouse_id, item_id,
      movement_type, quantity, unit_cost_cents,
      source_entity_type, source_entity_id,
      occurred_at, created_by
    ) values (
      new.org_id,
      new.warehouse_id,
      v_item_id,
      'shipment',
      coalesce((v_line ->> 'quantity')::numeric, 0),
      coalesce((v_line ->> 'unit_cost_cents')::bigint, 0),
      'shipment',
      new.id,
      coalesce(new.ship_date::timestamptz, now()),
      new.updated_by
    );
  end loop;

  return new;
end;
$$;
