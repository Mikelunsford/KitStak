-- ============================================================================
-- Migration: 0095_stock_movements_reserve_type.sql
-- Wave: 12
-- Phase: 3PL commercial pivot, Phase A5 (Supply Plan), step 1 of 3 (ledger
--   prerequisite).
-- Closes: activates the dormant spine reservation path so a Supply Plan can
--   reserve available stock via the append-only ledger. Implements the reserve
--   mechanism named in
--   03-workspace/specs/2026-06-04-3pl-commercial-pivot-and-wms-pillar-plan.md
--   (section 6.1 supply_plan_lines: "The reserve action writes a reserved
--   stock_movement so the spine quantity_reserved reflects it and
--   quantity_available auto-derives. This honors the generated-column
--   contract"). Two changes:
--     1) extend the stock_movements.movement_type CHECK to add 'reserve' and
--        'reserve_release' (guarded drop-then-add, strict superset of 0030).
--     2) forward redefinition of recompute_stock_level (last and only defined
--        in 0030) to also derive quantity_reserved from the new movement types,
--        leaving the on_hand derivation byte-identical.
-- Date: 2026-06-13
--
-- DOWN MIGRATION (operator-only; not auto-run):
--   -- 1) Restore the 0030 recompute_stock_level body (drops the reserved
--   --    derivation). Operator copies the function verbatim from migration 0030.
--   -- 2) Restore the 0030 movement_type CHECK (operator re-adds the prior list
--   --    by hand; a forward migration is the constitutional path if reserve
--   --    movements already exist).
--   alter table public.stock_movements drop constraint if exists stock_movements_movement_type_check;
--
-- Constitutional alignment:
--   Money rules        Untouched. No _cents column added; reserve movements
--                      carry the existing unit_cost_cents (default 0). No
--                      monetary math.
--   RLS rules          Untouched. stock_movements stays service-role-insert /
--                      authenticated-select; stock_levels stays read-only via
--                      GENERATED + trigger. No policy change.
--   Audit rules        Untouched. stock_movements is a ledger, not an audited
--                      entity (no per-row audit trigger in 0030); reserve rows
--                      follow the same pattern. The Supply Plan release that
--                      creates them is audited at the supply_plan level (0096).
--                      No new entity_type here.
--   Migration rules    Forward-only. DDL is idempotent (guarded CHECK
--                      drop-then-add, CREATE OR REPLACE function). Does NOT edit
--                      0030; it redefines the function and the CHECK forward.
--   Generated column   Honored. recompute writes quantity_on_hand and
--                      quantity_reserved only; quantity_available stays GENERATED
--                      ALWAYS AS (on_hand - reserved) and is never written.
--   Additive safety    reserve / reserve_release are new movement types with no
--                      existing rows, so every existing (warehouse, item)
--                      recomputes quantity_reserved = 0, identical to today's
--                      dormant value. The on_hand CASE is unchanged, so on_hand
--                      and the derived available do not move for any existing
--                      stock. reserve movements are excluded from on_hand (they
--                      are soft holds, not physical moves).
--   Out of scope       supply_plans / supply_plan_lines and the release RPC are
--                      0096; SUP- numbering is 0097.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Extend the movement_type CHECK to add the two reservation verbs. Guarded
--    drop-then-add. Re-adds every value from the 0030 list plus 'reserve' and
--    'reserve_release'. Strict superset.
-- ---------------------------------------------------------------------------

do $$
begin
  if exists (
    select 1 from pg_constraint
     where conrelid = 'public.stock_movements'::regclass
       and conname  = 'stock_movements_movement_type_check'
  ) then
    alter table public.stock_movements
      drop constraint stock_movements_movement_type_check;
  end if;
end$$;

alter table public.stock_movements
  add constraint stock_movements_movement_type_check
  check (movement_type in (
    -- 0030 physical and adjustment movements
    'receipt',
    'shipment',
    'production_consumed',
    'production_produced',
    'adjustment',
    'transfer_in',
    'transfer_out',
    -- 0095 soft reservation holds (do not affect on_hand)
    'reserve',
    'reserve_release'
  ));

comment on constraint stock_movements_movement_type_check on public.stock_movements is
  'Authoritative movement_type list as of 0095, which adds the soft-hold verbs reserve and reserve_release (Supply Plan, Wave 12 / A5) on top of the 0030 physical and adjustment list. reserve and reserve_release move quantity_reserved only, never quantity_on_hand. Extend via forward migration; never subset.';

-- ---------------------------------------------------------------------------
-- 2) Redefine recompute_stock_level (0030) to derive quantity_reserved from the
--    new soft-hold movements alongside the unchanged quantity_on_hand
--    derivation. reserve adds to reserved, reserve_release subtracts; neither
--    is in the on_hand CASE, so on_hand is byte-identical to 0030.
-- ---------------------------------------------------------------------------

create or replace function public.recompute_stock_level(
  p_warehouse_id uuid,
  p_item_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
  v_on_hand numeric(18,4);
  v_reserved numeric(18,4);
  v_last timestamptz;
begin
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
    coalesce(sum(
      case
        when movement_type = 'reserve'         then quantity
        when movement_type = 'reserve_release' then -quantity
        else 0
      end
    ), 0),
    max(occurred_at)
  into v_on_hand, v_reserved, v_last
  from public.stock_movements
  where warehouse_id = p_warehouse_id
    and item_id = p_item_id;

  insert into public.stock_levels (
    org_id, warehouse_id, item_id,
    quantity_on_hand, quantity_reserved,
    last_movement_at, updated_at
  ) values (
    v_org_id, p_warehouse_id, p_item_id,
    v_on_hand, v_reserved,
    v_last, now()
  )
  on conflict (warehouse_id, item_id) do update
    set quantity_on_hand   = excluded.quantity_on_hand,
        quantity_reserved  = excluded.quantity_reserved,
        last_movement_at   = excluded.last_movement_at,
        updated_at         = now();
end;
$$;

revoke execute on function public.recompute_stock_level(uuid, uuid) from public, anon;
grant execute on function public.recompute_stock_level(uuid, uuid) to service_role;

comment on function public.recompute_stock_level(uuid, uuid) is
  'Redefined in 0095 to also derive quantity_reserved from reserve / reserve_release ledger movements (Supply Plan, Wave 12 / A5). The quantity_on_hand derivation is byte-identical to 0030; quantity_available stays GENERATED as on_hand minus reserved. reserve movements are soft holds excluded from on_hand.';
