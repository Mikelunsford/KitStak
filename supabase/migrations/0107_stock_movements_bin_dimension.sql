-- ============================================================================
-- Migration: 0107_stock_movements_bin_dimension.sql
-- Wave: 12
-- Phase: WMS Body B, Phase B2 (the stock-movement bin dimension. THE SPINE
--   STOP-POINT). The append-only stock_movements ledger gains an additive
--   nullable bin dimension (location_id, plus the forward refs lot_id and
--   license_plate_id), a bin_stock_levels rollup that derives bin-grain
--   quantity_on_hand the identical way the spine derives the warehouse grain,
--   the recompute_bin_stock_level function, and the AFTER INSERT trigger wiring
--   that fires both rollups off the same row. The sum-reconcile invariant holds
--   by construction (see the Constitutional alignment block).
-- Closes: F-Wave12-WMS-B2-01 (and the carried stop-point risk R-W12-CO-02).
--   Implements the B2 DB layer from
--   03-workspace/specs/2026-06-14-wms-bodyb-phase1-handoff.md (section
--   "B2. Stock-movement bin dimension (THE SPINE STOP-POINT)" and section 4
--   "The B2 operator stop-point") on top of the spine ledger
--   (0030_inventory_warehouses_stock.sql) and the B1 warehouse_locations parent
--   (0106_warehouse_locations.sql). The read cap, byte-mirror BinStockLevel type,
--   the wms-api /bin-stock GET routes, and the SPA /wms/bin-stock surface are
--   the B2 app layer.
-- Date: 2026-06-15
--
-- DOWN MIGRATION (operator-only; not auto-run). Drop in reverse:
--   -- 1) Restore the 0030 trg_stock_movements_recompute body so the trigger
--   --    stops firing the bin recompute (operator copies the function verbatim
--   --    from migration 0030, then re-declares the trigger).
--   drop trigger if exists stock_movements_recompute_ai on public.stock_movements;
--   -- (operator re-creates the trigger pointing at the restored 0030 function.)
--   -- 2) Drop the bin recompute and the rollup table.
--   drop function if exists public.recompute_bin_stock_level(uuid, uuid, uuid, uuid);
--   drop policy if exists bin_stock_levels_select on public.bin_stock_levels;
--   drop table if exists public.bin_stock_levels;
--   -- 3) Drop the additive ledger columns and the bin index. Forward-only is the
--   --    constitutional path if any row already carries a non-null location_id.
--   drop index if exists public.stock_movements_warehouse_item_location_idx;
--   alter table public.stock_movements drop column if exists license_plate_id;
--   alter table public.stock_movements drop column if exists lot_id;
--   alter table public.stock_movements drop column if exists location_id;
--
-- Constitutional alignment:
--   RLS rules          stock_movements append-only posture is UNCHANGED. No new
--                      write policy; the table stays service-role-insert /
--                      authenticated-select. bin_stock_levels is Pattern A
--                      SELECT-only for authenticated (org_id = current_org_id());
--                      it has NO write policy, exactly like the spine
--                      stock_levels rollup. All writes flow through the
--                      SECURITY DEFINER recompute_bin_stock_level, never the
--                      client. Cross-tenant reads return 200 + [].
--   Money rules        Untouched. No _cents column added. bin_stock_levels
--                      carries no money; movements keep the existing
--                      unit_cost_cents. No monetary math.
--   Idempotency        Untouched. The bin columns are additive and nullable;
--                      movement-emitting handlers keep their Idempotency-Key
--                      contract. No handler-table change here.
--   Audit rules        bin_stock_levels is NOT audited. The spine stock_levels
--                      rollup is not audited (no per-row audit trigger in 0030);
--                      bin_stock_levels follows it. No new entity_type, so the
--                      audit_log_entity_type_check is UNTOUCHED. The stock_movements
--                      ledger remains the source of truth; the rollups are pure
--                      derivations.
--   Additive safety    location_id / lot_id / license_plate_id are nullable with
--                      NO default and NO backfill. Every existing row keeps a
--                      NULL location_id (the WMS-off / pre-WMS partition), so no
--                      bin row is created for it and the warehouse total recompute
--                      is byte-identical to today. Off equals totals intact.
--   Warehouse recompute UNCHANGED. recompute_stock_level (0095) is not touched.
--                      The trigger still calls it with (new.warehouse_id,
--                      new.item_id) on every insert; the new bin branch only runs
--                      additionally when new.location_id is not null.
--   Sum-reconcile      Holds by construction. The warehouse total is a pure
--                      sum(signed quantity) over the movement set with no GROUP BY
--                      (0095). The bin rollup partitions the SAME movement set by
--                      a nullable dimension using the BYTE-IDENTICAL signed-CASE.
--                      Summing the subtotals over every location partition
--                      (including the NULL no-bin partition that lives only in the
--                      warehouse total) yields the unpartitioned total identically.
--                      The bin recompute SKIPS the NULL partition (it is captured
--                      by the warehouse grain, not double-counted), so the bin
--                      rows hold only the located stock and reconcile back.
--   Migration rules    Forward-only. All DDL idempotent (ADD COLUMN IF NOT EXISTS,
--                      CREATE TABLE / INDEX IF NOT EXISTS, CREATE OR REPLACE,
--                      guarded DROP TRIGGER then CREATE TRIGGER). Does not edit any
--                      numbered file. The existing stock_movements_warehouse_item
--                      index and the movement_type CHECK are NOT touched (B2 adds
--                      no new movement type).
--   Forward refs       location_id FKs warehouse_locations (exists after 0106).
--                      lot_id and license_plate_id are bare uuids here; B4 adds
--                      the lot_id FK once lots exists (chassis bare-uuid forward-ref
--                      convention).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Additive nullable bin dimension on the append-only stock_movements ledger
--    (created 0030). Forward-only, idempotent. NO not null, NO default, NO
--    backfill. Existing rows keep NULL location (the WMS-off / pre-WMS default).
--    location_id FKs warehouse_locations (exists after 0106). lot_id stays a bare
--    uuid here; B4 adds its FK once lots exists. license_plate_id is a bare uuid
--    (pallet / license-plate grouping, no parent table in Phase 1).
-- ---------------------------------------------------------------------------

alter table public.stock_movements
  add column if not exists location_id uuid references public.warehouse_locations(id) on delete set null;
alter table public.stock_movements
  add column if not exists lot_id uuid;
alter table public.stock_movements
  add column if not exists license_plate_id uuid;

-- Index for bin-grain queries. The existing stock_movements_warehouse_item_idx
-- (warehouse_id, item_id, occurred_at desc) is unchanged.
create index if not exists stock_movements_warehouse_item_location_idx
  on public.stock_movements (warehouse_id, item_id, location_id);

-- ---------------------------------------------------------------------------
-- 2) bin_stock_levels: one row per (warehouse, location, item, lot). A read-only
--    rollup modelled on stock_levels (0030). The four-key unique is the group-by
--    key (handoff decision (d): lot included from the start, nullable, null-safe
--    matched). Writes flow only through the SECURITY DEFINER recompute, exactly
--    like stock_levels: Pattern A SELECT-only, NO write policy. NOT audited.
-- ---------------------------------------------------------------------------

create table if not exists public.bin_stock_levels (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  warehouse_id uuid not null references public.warehouses(id) on delete cascade,
  location_id uuid not null references public.warehouse_locations(id) on delete cascade,
  item_id uuid not null,
  lot_id uuid,
  quantity_on_hand numeric(18,4) not null default 0,
  last_movement_at timestamptz,
  updated_at timestamptz not null default now(),
  -- NULLS NOT DISTINCT is load-bearing: lot_id is nullable and the no-lot
  -- partition (lot_id IS NULL) is the dominant Phase 1 case. Under Postgres'
  -- default NULLS DISTINCT, two no-lot rows for the same (warehouse, location,
  -- item) would both be allowed and the recompute's on-conflict arbiter would
  -- never fire, so every recompute into a no-lot bin would INSERT a duplicate
  -- instead of updating, breaking the sum-reconcile from the second movement.
  -- NULLS NOT DISTINCT treats NULL lot_id as equal so the upsert dedups it.
  unique nulls not distinct (warehouse_id, location_id, item_id, lot_id)
);

create index if not exists bin_stock_levels_org_idx
  on public.bin_stock_levels (org_id);

create index if not exists bin_stock_levels_warehouse_item_idx
  on public.bin_stock_levels (warehouse_id, item_id);

create index if not exists bin_stock_levels_location_idx
  on public.bin_stock_levels (location_id);

alter table public.bin_stock_levels enable row level security;

drop policy if exists bin_stock_levels_select on public.bin_stock_levels;
create policy bin_stock_levels_select on public.bin_stock_levels
  for select to authenticated
  using (org_id = public.current_org_id());

-- read-only via the recompute trigger. No write policy for authenticated;
-- service_role updates via the SECURITY DEFINER recompute_bin_stock_level.

-- ---------------------------------------------------------------------------
-- 3) recompute_bin_stock_level: derives bin-grain quantity_on_hand for one
--    (warehouse, item, location, lot) from stock_movements and upserts the
--    bin_stock_levels row. A NEW function: the existing recompute_stock_level
--    hard-codes its grain in the WHERE and the on conflict, so it cannot be
--    reused. CRITICAL: the signed-CASE below is BYTE-IDENTICAL to the
--    quantity_on_hand CASE in recompute_stock_level (0030 / 0095), or the
--    sum-reconcile invariant breaks. The NULL no-bin partition is not rolled up
--    here; it lives only in the warehouse total. lot is null-safe matched.
-- ---------------------------------------------------------------------------

create or replace function public.recompute_bin_stock_level(
  p_warehouse_id uuid,
  p_item_id uuid,
  p_location_id uuid,
  p_lot_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
  v_on_hand numeric(18,4);
  v_last timestamptz;
begin
  -- The no-bin partition (NULL location) is captured by the warehouse grain, not
  -- by any bin row. Skip it here so it is never double-counted.
  if p_location_id is null then
    return;
  end if;

  select org_id into v_org_id from public.warehouses where id = p_warehouse_id;
  if v_org_id is null then
    return;
  end if;

  select
    coalesce(sum(
      case
        when movement_type in ('receipt', 'production_produced', 'transfer_in', 'adjustment')
          then quantity
        when movement_type in ('shipment', 'production_consumed', 'transfer_out')
          then -quantity
        else 0
      end
    ), 0),
    max(occurred_at)
  into v_on_hand, v_last
  from public.stock_movements
  where warehouse_id = p_warehouse_id
    and item_id = p_item_id
    and location_id = p_location_id
    and lot_id is not distinct from p_lot_id;

  insert into public.bin_stock_levels (
    org_id, warehouse_id, location_id, item_id, lot_id,
    quantity_on_hand, last_movement_at, updated_at
  ) values (
    v_org_id, p_warehouse_id, p_location_id, p_item_id, p_lot_id,
    v_on_hand, v_last, now()
  )
  on conflict (warehouse_id, location_id, item_id, lot_id) do update
    set quantity_on_hand   = excluded.quantity_on_hand,
        last_movement_at   = excluded.last_movement_at,
        updated_at         = now();
end;
$$;

revoke execute on function public.recompute_bin_stock_level(uuid, uuid, uuid, uuid) from public, anon;
grant execute on function public.recompute_bin_stock_level(uuid, uuid, uuid, uuid) to service_role;

comment on function public.recompute_bin_stock_level(uuid, uuid, uuid, uuid) is
  'WMS Body B Phase B2 (Wave 12): derives bin-grain quantity_on_hand for one (warehouse, item, location, lot) from the append-only stock_movements ledger and upserts the bin_stock_levels rollup. The signed-CASE is byte-identical to recompute_stock_level (0030 / 0095), so summing every location partition reconciles to the warehouse total by construction. The NULL no-bin partition is skipped (it lives only in the warehouse grain); lot is null-safe matched via is not distinct from.';

-- ---------------------------------------------------------------------------
-- 4) Extend the AFTER INSERT trigger to fire BOTH rollups off the same row.
--    Redefine trg_stock_movements_recompute (last defined in 0030; 0095 did not
--    touch it) so it still recomputes the warehouse grain UNCHANGED and, when
--    new.location_id is not null, ALSO recomputes the bin grain. WMS-off rows
--    have NULL location_id, so the bin branch is skipped and the warehouse total
--    stays the sole rollup. Off equals totals intact. The trigger is re-declared
--    idempotently (drop then create) since the function body changed.
-- ---------------------------------------------------------------------------

create or replace function public.trg_stock_movements_recompute()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- warehouse grain, unchanged (0030 / 0095).
  perform public.recompute_stock_level(new.warehouse_id, new.item_id);
  -- bin grain, only when the movement carries a bin (WMS on). WMS-off / pre-WMS
  -- rows leave location_id NULL and skip this branch entirely.
  if new.location_id is not null then
    perform public.recompute_bin_stock_level(
      new.warehouse_id, new.item_id, new.location_id, new.lot_id
    );
  end if;
  return new;
end;
$$;

revoke execute on function public.trg_stock_movements_recompute() from public, anon;

drop trigger if exists stock_movements_recompute_ai on public.stock_movements;
create trigger stock_movements_recompute_ai
  after insert on public.stock_movements
  for each row execute function public.trg_stock_movements_recompute();

-- ---------------------------------------------------------------------------
-- Table comment for operator discoverability.
-- ---------------------------------------------------------------------------

comment on table public.bin_stock_levels is
  'WMS Body B bin stock rollup (add-on six, warehouse execution; Wave 12 / B2): one row per (warehouse, location, item, lot) deriving bin-grain quantity_on_hand from the append-only stock_movements ledger. Read-only (Pattern A SELECT-only, no write policy); maintained by recompute_bin_stock_level off the AFTER INSERT trigger, exactly like the spine stock_levels rollup. NOT audited. The sum of quantity_on_hand over every location partition reconciles to stock_levels.quantity_on_hand for the same (warehouse, item) by construction. lot_id is nullable (the no-lot partition is the lot_id IS NULL row); the lot_id FK lands in B4 once lots exists.';
