-- ============================================================================
-- Migration: 0032_ops_receiving_production_shipments.sql
-- Wave: 2
-- Phase: 3PL Ops state machines + movement emitters (Agent E)
-- Closes: R-W2-OPS-01
-- Date: 2026-05-18
-- DOWN MIGRATION: operator-only. drop triggers, then tables, then helper
--   functions. Not auto-run.
--
-- Constitutional alignment:
--   RLS rules         Pattern A on org_id for all three.
--   Money rules       No monetary columns here; cost flows via stock_movements.
--   Migration rules   Forward-only. All DDL idempotent. State machines are
--                     text CHECK, not pg enum.
--   Audit rules       state transitions emit stock_movements rows via trigger,
--                     never best-effort handler writes.
-- ============================================================================

create table if not exists public.receiving_orders (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  receiving_number text,
  purchase_order_id uuid references public.purchase_orders(id),
  warehouse_id uuid not null references public.warehouses(id),
  vendor_id uuid references public.vendors(id),
  status text not null default 'created'
    check (status in ('created', 'in_progress', 'received', 'cancelled')),
  expected_date date,
  received_date date,
  reference text,
  notes text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  deleted_at timestamptz,
  unique (org_id, receiving_number)
);

create index if not exists receiving_orders_org_idx
  on public.receiving_orders (org_id)
  where deleted_at is null;

create index if not exists receiving_orders_org_status_idx
  on public.receiving_orders (org_id, status)
  where deleted_at is null;

alter table public.receiving_orders enable row level security;

drop policy if exists receiving_orders_select on public.receiving_orders;
create policy receiving_orders_select on public.receiving_orders
  for select to authenticated
  using (org_id = public.current_org_id());

drop policy if exists receiving_orders_write on public.receiving_orders;
create policy receiving_orders_write on public.receiving_orders
  for all to authenticated
  using (
    org_id = public.current_org_id()
    and public.current_user_role() in ('org_owner', 'org_admin', 'ops')
  )
  with check (
    org_id = public.current_org_id()
    and public.current_user_role() in ('org_owner', 'org_admin', 'ops')
  );

create table if not exists public.production_runs (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  run_number text,
  warehouse_id uuid not null references public.warehouses(id),
  output_item_id uuid not null,
  status text not null default 'planned'
    check (status in ('planned', 'in_progress', 'completed', 'cancelled')),
  quantity_planned numeric(18,4) not null default 0,
  quantity_produced numeric(18,4) not null default 0,
  scheduled_for date,
  started_at timestamptz,
  completed_at timestamptz,
  notes text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  deleted_at timestamptz,
  unique (org_id, run_number)
);

create index if not exists production_runs_org_idx
  on public.production_runs (org_id)
  where deleted_at is null;

create index if not exists production_runs_org_status_idx
  on public.production_runs (org_id, status)
  where deleted_at is null;

alter table public.production_runs enable row level security;

drop policy if exists production_runs_select on public.production_runs;
create policy production_runs_select on public.production_runs
  for select to authenticated
  using (org_id = public.current_org_id());

drop policy if exists production_runs_write on public.production_runs;
create policy production_runs_write on public.production_runs
  for all to authenticated
  using (
    org_id = public.current_org_id()
    and public.current_user_role() in ('org_owner', 'org_admin', 'ops')
  )
  with check (
    org_id = public.current_org_id()
    and public.current_user_role() in ('org_owner', 'org_admin', 'ops')
  );

create table if not exists public.shipments (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  shipment_number text,
  warehouse_id uuid not null references public.warehouses(id),
  customer_id uuid,
  sales_order_id uuid,
  status text not null default 'created'
    check (status in ('created', 'picking', 'shipped', 'cancelled')),
  ship_date date,
  carrier text,
  tracking_number text,
  notes text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  deleted_at timestamptz,
  unique (org_id, shipment_number)
);

create index if not exists shipments_org_idx
  on public.shipments (org_id)
  where deleted_at is null;

create index if not exists shipments_org_status_idx
  on public.shipments (org_id, status)
  where deleted_at is null;

alter table public.shipments enable row level security;

drop policy if exists shipments_select on public.shipments;
create policy shipments_select on public.shipments
  for select to authenticated
  using (org_id = public.current_org_id());

drop policy if exists shipments_write on public.shipments;
create policy shipments_write on public.shipments
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
-- Trigger: receiving_orders status -> received emits stock_movements.
-- payload.lines is an array of { item_id, quantity, unit_cost_cents }.
-- ---------------------------------------------------------------------------

create or replace function public.tg_receiving_orders_emit_movements()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_line jsonb;
begin
  if new.status is null or new.status = old.status or new.status <> 'received' then
    return new;
  end if;

  for v_line in
    select * from jsonb_array_elements(coalesce(new.payload -> 'lines', '[]'::jsonb))
  loop
    insert into public.stock_movements (
      org_id, warehouse_id, item_id,
      movement_type, quantity, unit_cost_cents,
      source_entity_type, source_entity_id,
      occurred_at, created_by
    ) values (
      new.org_id,
      new.warehouse_id,
      (v_line ->> 'item_id')::uuid,
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

revoke execute on function public.tg_receiving_orders_emit_movements() from public, anon;

drop trigger if exists receiving_orders_emit_movements on public.receiving_orders;
create trigger receiving_orders_emit_movements
  after update of status on public.receiving_orders
  for each row execute function public.tg_receiving_orders_emit_movements();

-- ---------------------------------------------------------------------------
-- Trigger: production_runs status -> completed emits stock_movements.
-- payload.consumed is array of { item_id, quantity, unit_cost_cents }.
-- payload.produced is { item_id, quantity, unit_cost_cents }.
-- ---------------------------------------------------------------------------

create or replace function public.tg_production_runs_emit_movements()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_line jsonb;
  v_produced jsonb;
begin
  if new.status is null or new.status = old.status or new.status <> 'completed' then
    return new;
  end if;

  -- Consumed components
  for v_line in
    select * from jsonb_array_elements(coalesce(new.payload -> 'consumed', '[]'::jsonb))
  loop
    insert into public.stock_movements (
      org_id, warehouse_id, item_id,
      movement_type, quantity, unit_cost_cents,
      source_entity_type, source_entity_id,
      occurred_at, created_by
    ) values (
      new.org_id,
      new.warehouse_id,
      (v_line ->> 'item_id')::uuid,
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

revoke execute on function public.tg_production_runs_emit_movements() from public, anon;

drop trigger if exists production_runs_emit_movements on public.production_runs;
create trigger production_runs_emit_movements
  after update of status on public.production_runs
  for each row execute function public.tg_production_runs_emit_movements();

-- ---------------------------------------------------------------------------
-- Trigger: shipments status -> shipped emits stock_movements.
-- payload.lines is array of { item_id, quantity, unit_cost_cents }.
-- ---------------------------------------------------------------------------

create or replace function public.tg_shipments_emit_movements()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_line jsonb;
begin
  if new.status is null or new.status = old.status or new.status <> 'shipped' then
    return new;
  end if;

  for v_line in
    select * from jsonb_array_elements(coalesce(new.payload -> 'lines', '[]'::jsonb))
  loop
    insert into public.stock_movements (
      org_id, warehouse_id, item_id,
      movement_type, quantity, unit_cost_cents,
      source_entity_type, source_entity_id,
      occurred_at, created_by
    ) values (
      new.org_id,
      new.warehouse_id,
      (v_line ->> 'item_id')::uuid,
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

revoke execute on function public.tg_shipments_emit_movements() from public, anon;

drop trigger if exists shipments_emit_movements on public.shipments;
create trigger shipments_emit_movements
  after update of status on public.shipments
  for each row execute function public.tg_shipments_emit_movements();
