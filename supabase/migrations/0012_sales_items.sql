-- ============================================================================
-- Migration: 0012_sales_items.sql
-- Wave: 2
-- Phase: Sales chassis (items, item_categories, units)
-- Closes: R-W2-ITEMS-01, R-W2-CATALOG-01
-- Date: 2026-05-18
-- DOWN MIGRATION: operator-only. Drop items, item_categories, units in
--   reverse dependency order. Not auto-run.
--
-- Constitutional alignment:
--   AUDIT D-001    One clean items table. No `pricing_menu` legacy.
--   Money rules    unit_price_cents and unit_cost_cents are BIGINT cents.
--   RLS rules      Pattern A on every table.
--   Migration rules Forward-only. All DDL idempotent.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- units: per-org unit of measure (each, case, lb, kg, etc.). Pattern A.
-- ---------------------------------------------------------------------------

create table if not exists public.units (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  code text not null,
  label text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  deleted_at timestamptz,
  unique (org_id, code)
);

alter table public.units enable row level security;

drop policy if exists units_select on public.units;
create policy units_select on public.units
  for select to authenticated
  using (org_id = public.current_org_id());

drop policy if exists units_write on public.units;
create policy units_write on public.units
  for all to authenticated
  using (
    org_id = public.current_org_id()
    and public.current_user_role() in ('org_owner', 'org_admin', 'sales', 'ops')
  )
  with check (
    org_id = public.current_org_id()
    and public.current_user_role() in ('org_owner', 'org_admin', 'sales', 'ops')
  );

-- ---------------------------------------------------------------------------
-- item_categories: per-org item category taxonomy. Pattern A.
-- ---------------------------------------------------------------------------

create table if not exists public.item_categories (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  code text not null,
  name text not null,
  parent_id uuid references public.item_categories(id) on delete set null,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  deleted_at timestamptz,
  unique (org_id, code)
);

create index if not exists item_categories_parent_idx
  on public.item_categories (org_id, parent_id) where deleted_at is null;

alter table public.item_categories enable row level security;

drop policy if exists item_categories_select on public.item_categories;
create policy item_categories_select on public.item_categories
  for select to authenticated
  using (org_id = public.current_org_id());

drop policy if exists item_categories_write on public.item_categories;
create policy item_categories_write on public.item_categories
  for all to authenticated
  using (
    org_id = public.current_org_id()
    and public.current_user_role() in ('org_owner', 'org_admin', 'sales', 'ops')
  )
  with check (
    org_id = public.current_org_id()
    and public.current_user_role() in ('org_owner', 'org_admin', 'sales', 'ops')
  );

-- ---------------------------------------------------------------------------
-- items: one clean table. Replaces TS1's pricing_menu legacy. Pattern A.
-- Money columns _cents BIGINT. Currency snapshotted on every quote-line that
-- references this row; the items.currency_code is the listing currency.
-- ---------------------------------------------------------------------------

create table if not exists public.items (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  sku text not null,
  name text not null,
  description text,
  category_id uuid references public.item_categories(id) on delete set null,
  unit_id uuid references public.units(id) on delete set null,
  kind text not null default 'product'
    check (kind in ('product', 'service', 'kit', 'subscription', 'bundle')),
  unit_price_cents bigint not null default 0 check (unit_price_cents >= 0),
  unit_cost_cents bigint check (unit_cost_cents is null or unit_cost_cents >= 0),
  currency_code text not null default 'USD' references public.currencies(code),
  default_tax_id uuid references public.taxes(id) on delete set null,
  is_active boolean not null default true,
  is_taxable boolean not null default true,
  is_sellable boolean not null default true,
  is_purchasable boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  deleted_at timestamptz,
  unique (org_id, sku)
);

create index if not exists items_org_sku_idx
  on public.items (org_id, sku) where deleted_at is null;
create index if not exists items_org_category_idx
  on public.items (org_id, category_id) where is_active and deleted_at is null;
create index if not exists items_org_kind_idx
  on public.items (org_id, kind) where is_active and deleted_at is null;

alter table public.items enable row level security;

drop policy if exists items_select on public.items;
create policy items_select on public.items
  for select to authenticated
  using (org_id = public.current_org_id());

drop policy if exists items_write on public.items;
create policy items_write on public.items
  for all to authenticated
  using (
    org_id = public.current_org_id()
    and public.current_user_role() in ('org_owner', 'org_admin', 'sales', 'ops')
  )
  with check (
    org_id = public.current_org_id()
    and public.current_user_role() in ('org_owner', 'org_admin', 'sales', 'ops')
  );

-- Forward-declared FK from customer_pricing_overrides.item_id is intentionally
-- left unenforced; the cross-table relationship is the application's job.
-- A future migration can add `alter table customer_pricing_overrides add
-- foreign key (item_id) references items(id) on delete restrict;` once
-- the customer dimension is finalized by its owner agent.
