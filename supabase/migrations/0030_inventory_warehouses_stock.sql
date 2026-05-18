-- ============================================================================
-- Migration: 0030_inventory_warehouses_stock.sql
-- Wave: 2
-- Phase: Warehouses + stock_levels + stock_movements (Agent E)
-- Closes: R-W2-INV-01
-- Date: 2026-05-18
-- DOWN MIGRATION: operator-only. drop triggers, then stock_movements,
--   stock_levels, warehouses, the helper functions. Not auto-run.
--
-- Constitutional alignment:
--   RLS rules         All three are Pattern A on org_id.
--   Money rules       Unit cost is a BIGINT cents column (unit_cost_cents).
--                     Quantities are numeric(18,4) since we support partial
--                     units; cost math always pivots through _cents.
--   Migration rules   Forward-only. All DDL idempotent.
-- ============================================================================

create table if not exists public.warehouses (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  code text not null,
  display_name text not null,
  is_default boolean not null default false,
  address_line1 text,
  address_line2 text,
  city text,
  region text,
  postal_code text,
  country_code text,
  notes text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  deleted_at timestamptz,
  unique (org_id, code)
);

create index if not exists warehouses_org_idx
  on public.warehouses (org_id)
  where deleted_at is null;

alter table public.warehouses enable row level security;

drop policy if exists warehouses_select on public.warehouses;
create policy warehouses_select on public.warehouses
  for select to authenticated
  using (org_id = public.current_org_id());

drop policy if exists warehouses_write on public.warehouses;
create policy warehouses_write on public.warehouses
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
-- stock_levels: one row per (warehouse, item). quantity_available is
-- GENERATED ALWAYS AS (on_hand - reserved). Triggers maintain on_hand and
-- reserved via stock_movements row insertion.
-- ---------------------------------------------------------------------------

create table if not exists public.stock_levels (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  warehouse_id uuid not null references public.warehouses(id) on delete cascade,
  item_id uuid not null,
  quantity_on_hand numeric(18,4) not null default 0,
  quantity_reserved numeric(18,4) not null default 0,
  quantity_in_transit numeric(18,4) not null default 0,
  quantity_available numeric(18,4)
    generated always as (quantity_on_hand - quantity_reserved) stored,
  last_movement_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (warehouse_id, item_id)
);

create index if not exists stock_levels_org_idx
  on public.stock_levels (org_id);

create index if not exists stock_levels_warehouse_idx
  on public.stock_levels (warehouse_id);

create index if not exists stock_levels_item_idx
  on public.stock_levels (item_id);

alter table public.stock_levels enable row level security;

drop policy if exists stock_levels_select on public.stock_levels;
create policy stock_levels_select on public.stock_levels
  for select to authenticated
  using (org_id = public.current_org_id());

-- read-only via GENERATED + triggers. No write policy for authenticated;
-- service_role updates via trigger-emitted recomputes.

-- ---------------------------------------------------------------------------
-- stock_movements: append-only ledger. Reads-only for authenticated; only
-- triggers and the service role can insert.
-- ---------------------------------------------------------------------------

create table if not exists public.stock_movements (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  warehouse_id uuid not null references public.warehouses(id),
  item_id uuid not null,
  movement_type text not null
    check (movement_type in (
      'receipt', 'shipment', 'production_consumed',
      'production_produced', 'adjustment', 'transfer_in', 'transfer_out'
    )),
  quantity numeric(18,4) not null,
  unit_cost_cents bigint not null default 0,
  source_entity_type text,
  source_entity_id uuid,
  notes text,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  created_by uuid
);

create index if not exists stock_movements_org_idx
  on public.stock_movements (org_id, occurred_at desc);

create index if not exists stock_movements_warehouse_item_idx
  on public.stock_movements (warehouse_id, item_id, occurred_at desc);

create index if not exists stock_movements_source_idx
  on public.stock_movements (source_entity_type, source_entity_id);

alter table public.stock_movements enable row level security;

drop policy if exists stock_movements_select on public.stock_movements;
create policy stock_movements_select on public.stock_movements
  for select to authenticated
  using (org_id = public.current_org_id());

-- service_role-only inserts. No INSERT/UPDATE/DELETE policy for authenticated.

-- ---------------------------------------------------------------------------
-- seed_org_default_warehouse: idempotent. Used by provision_organization
-- evolution or org-bootstrap RPC.
-- ---------------------------------------------------------------------------

create or replace function public.seed_org_default_warehouse(p_org_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if p_org_id is null then
    raise exception 'VALIDATION_ERROR: p_org_id is required' using errcode = '22023';
  end if;

  select id into v_id
    from public.warehouses
   where org_id = p_org_id and is_default = true
   limit 1;
  if v_id is not null then
    return v_id;
  end if;

  insert into public.warehouses (
    org_id, code, display_name, is_default, is_active
  ) values (
    p_org_id, 'DEFAULT', 'Default Warehouse', true, true
  )
  returning id into v_id;

  return v_id;
end;
$$;

revoke execute on function public.seed_org_default_warehouse(uuid) from public, anon, authenticated;
grant execute on function public.seed_org_default_warehouse(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- recompute_stock_level: derives quantity_on_hand for one (warehouse, item)
-- from stock_movements and upserts the stock_levels row.
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
    max(occurred_at)
  into v_on_hand, v_last
  from public.stock_movements
  where warehouse_id = p_warehouse_id
    and item_id = p_item_id;

  insert into public.stock_levels (
    org_id, warehouse_id, item_id, quantity_on_hand, last_movement_at, updated_at
  ) values (
    v_org_id, p_warehouse_id, p_item_id, v_on_hand, v_last, now()
  )
  on conflict (warehouse_id, item_id) do update
    set quantity_on_hand   = excluded.quantity_on_hand,
        last_movement_at   = excluded.last_movement_at,
        updated_at         = now();
end;
$$;

revoke execute on function public.recompute_stock_level(uuid, uuid) from public, anon;
grant execute on function public.recompute_stock_level(uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Trigger function: AFTER INSERT on stock_movements -> recompute parent.
-- ---------------------------------------------------------------------------

create or replace function public.trg_stock_movements_recompute()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.recompute_stock_level(new.warehouse_id, new.item_id);
  return new;
end;
$$;

revoke execute on function public.trg_stock_movements_recompute() from public, anon;

drop trigger if exists stock_movements_recompute_ai on public.stock_movements;
create trigger stock_movements_recompute_ai
  after insert on public.stock_movements
  for each row execute function public.trg_stock_movements_recompute();
