-- ============================================================================
-- Migration: 0011_sales_chassis_currencies_taxes_fx.sql
-- Wave: 2
-- Phase: Sales chassis (currencies, exchange rates, taxes, payment methods,
--        pricing tiers, customer pricing overrides)
-- Closes: R-W2-SALES-CHASSIS-01, R-W2-FX-01, R-W2-TAX-01
-- Date: 2026-05-18
-- DOWN MIGRATION: operator-only. Drop in reverse dependency order:
--   customer_pricing_overrides, pricing_tiers, payment_methods, taxes,
--   exchange_rates, currencies. Then drop the set_default RPCs. Not auto-run.
--
-- Constitutional alignment:
--   Money rules         All monetary columns stored as BIGINT cents with the
--                       _cents suffix. Currency snapshotted on every taxable
--                       artifact via currency_code column.
--   RLS rules           currencies + exchange_rates are Pattern C global
--                       (USING true). Tenant tables (taxes, payment_methods,
--                       pricing_tiers, customer_pricing_overrides) are
--                       Pattern A with role check on write.
--   Audit rules         No state machine on these tables; default_for_org
--                       flips are written by the SECURITY DEFINER RPCs that
--                       perform atomic flips.
--   Migration rules     Forward-only. All DDL idempotent.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- currencies: ISO 4217 codes. Pattern C global. The `is_zero_decimal` column
-- mirrors the SPA money.ts ZERO_DECIMAL_CURRENCIES set so downstream consumers
-- can read it from one source of truth.
-- ---------------------------------------------------------------------------

create table if not exists public.currencies (
  code text primary key check (char_length(code) = 3),
  name text not null,
  symbol text,
  is_zero_decimal boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.currencies enable row level security;

drop policy if exists currencies_select on public.currencies;
create policy currencies_select on public.currencies
  for select to authenticated using (true);

-- Seed canonical ISO subset. Zero-decimal flags must mirror SPA money.ts.
insert into public.currencies (code, name, symbol, is_zero_decimal) values
  ('USD', 'United States Dollar', '$', false),
  ('EUR', 'Euro', '€', false),
  ('GBP', 'Pound Sterling', '£', false),
  ('CAD', 'Canadian Dollar', '$', false),
  ('AUD', 'Australian Dollar', '$', false),
  ('MXN', 'Mexican Peso', '$', false),
  ('JPY', 'Japanese Yen', '¥', true),
  ('KRW', 'South Korean Won', '₩', true),
  ('VND', 'Vietnamese Dong', '₫', true),
  ('CLP', 'Chilean Peso', '$', true),
  ('ISK', 'Icelandic Krona', 'kr', true)
on conflict (code) do nothing;

-- ---------------------------------------------------------------------------
-- exchange_rates: Pattern C global rates anchored to a base currency. Rate
-- expressed as a 1e9-scaled integer to avoid floating point drift on the
-- wire and at rest (1.000000000 = 1_000_000_000). Effective date is the
-- date the rate applies from; lookups always pick the most recent rate
-- on or before the target date.
-- ---------------------------------------------------------------------------

create table if not exists public.exchange_rates (
  id uuid primary key default uuid_generate_v4(),
  base_currency_code text not null references public.currencies(code),
  quote_currency_code text not null references public.currencies(code),
  rate_e9 bigint not null check (rate_e9 > 0),
  effective_date date not null,
  source text not null default 'manual',
  created_at timestamptz not null default now(),
  created_by uuid,
  unique (base_currency_code, quote_currency_code, effective_date)
);

create index if not exists exchange_rates_pair_date_idx
  on public.exchange_rates (base_currency_code, quote_currency_code, effective_date desc);

alter table public.exchange_rates enable row level security;

drop policy if exists exchange_rates_select on public.exchange_rates;
create policy exchange_rates_select on public.exchange_rates
  for select to authenticated using (true);

-- ---------------------------------------------------------------------------
-- taxes: per-org tax rates. Pattern A. Stored as basis points (rate_bps) so
-- the wire is integer. 825 = 8.25%. default_for_org is mutually exclusive
-- per org and is set via the atomic-flip RPC set_default_tax.
-- ---------------------------------------------------------------------------

create table if not exists public.taxes (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  code text not null,
  name text not null,
  rate_bps integer not null check (rate_bps >= 0 and rate_bps <= 100000),
  is_compound boolean not null default false,
  is_active boolean not null default true,
  default_for_org boolean not null default false,
  notes text,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  deleted_at timestamptz,
  unique (org_id, code)
);

create unique index if not exists taxes_default_per_org_uq
  on public.taxes (org_id) where default_for_org and deleted_at is null;

create index if not exists taxes_org_active_idx
  on public.taxes (org_id) where is_active and deleted_at is null;

alter table public.taxes enable row level security;

drop policy if exists taxes_select on public.taxes;
create policy taxes_select on public.taxes
  for select to authenticated
  using (org_id = public.current_org_id());

drop policy if exists taxes_write on public.taxes;
create policy taxes_write on public.taxes
  for all to authenticated
  using (
    org_id = public.current_org_id()
    and public.current_user_role() in ('org_owner', 'org_admin', 'accounting', 'sales')
  )
  with check (
    org_id = public.current_org_id()
    and public.current_user_role() in ('org_owner', 'org_admin', 'accounting', 'sales')
  );

-- ---------------------------------------------------------------------------
-- set_default_tax: atomic flip RPC. Clears any prior default for the org,
-- then sets the new row's default_for_org flag. SECURITY DEFINER so the
-- partial unique index can be respected inside a single transaction.
-- ---------------------------------------------------------------------------

create or replace function public.set_default_tax(p_tax_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
begin
  select org_id into v_org_id
    from public.taxes
   where id = p_tax_id and deleted_at is null
   limit 1;
  if v_org_id is null then
    raise exception 'NOT_FOUND: tax not found' using errcode = 'P0001';
  end if;
  if v_org_id <> public.current_org_id() then
    raise exception 'FORBIDDEN: cross-tenant tax flip' using errcode = '42501';
  end if;

  update public.taxes
     set default_for_org = false,
         updated_at = now()
   where org_id = v_org_id
     and default_for_org;

  update public.taxes
     set default_for_org = true,
         updated_at = now()
   where id = p_tax_id;
end;
$$;

revoke execute on function public.set_default_tax(uuid) from public, anon;
grant execute on function public.set_default_tax(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- payment_methods: per-org payment method catalog. Pattern A. default_for_org
-- mutually exclusive via partial unique index, flipped by set_default_payment_method.
-- ---------------------------------------------------------------------------

create table if not exists public.payment_methods (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  code text not null,
  label text not null,
  kind text not null default 'manual'
    check (kind in ('manual', 'ach', 'wire', 'card', 'check', 'other')),
  is_active boolean not null default true,
  default_for_org boolean not null default false,
  notes text,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  deleted_at timestamptz,
  unique (org_id, code)
);

create unique index if not exists payment_methods_default_per_org_uq
  on public.payment_methods (org_id) where default_for_org and deleted_at is null;

alter table public.payment_methods enable row level security;

drop policy if exists payment_methods_select on public.payment_methods;
create policy payment_methods_select on public.payment_methods
  for select to authenticated
  using (org_id = public.current_org_id());

drop policy if exists payment_methods_write on public.payment_methods;
create policy payment_methods_write on public.payment_methods
  for all to authenticated
  using (
    org_id = public.current_org_id()
    and public.current_user_role() in ('org_owner', 'org_admin', 'accounting', 'sales')
  )
  with check (
    org_id = public.current_org_id()
    and public.current_user_role() in ('org_owner', 'org_admin', 'accounting', 'sales')
  );

create or replace function public.set_default_payment_method(p_method_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
begin
  select org_id into v_org_id
    from public.payment_methods
   where id = p_method_id and deleted_at is null
   limit 1;
  if v_org_id is null then
    raise exception 'NOT_FOUND: payment method not found' using errcode = 'P0001';
  end if;
  if v_org_id <> public.current_org_id() then
    raise exception 'FORBIDDEN: cross-tenant payment method flip' using errcode = '42501';
  end if;

  update public.payment_methods
     set default_for_org = false,
         updated_at = now()
   where org_id = v_org_id and default_for_org;

  update public.payment_methods
     set default_for_org = true,
         updated_at = now()
   where id = p_method_id;
end;
$$;

revoke execute on function public.set_default_payment_method(uuid) from public, anon;
grant execute on function public.set_default_payment_method(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- pricing_tiers: per-org pricing tier definitions. Pattern A. Discount stored
-- as basis points (discount_bps). Tier resolution is the responsibility of
-- the items / quote-line math, not this table.
-- ---------------------------------------------------------------------------

create table if not exists public.pricing_tiers (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  code text not null,
  name text not null,
  discount_bps integer not null default 0 check (discount_bps >= 0 and discount_bps <= 100000),
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  deleted_at timestamptz,
  unique (org_id, code)
);

alter table public.pricing_tiers enable row level security;

drop policy if exists pricing_tiers_select on public.pricing_tiers;
create policy pricing_tiers_select on public.pricing_tiers
  for select to authenticated
  using (org_id = public.current_org_id());

drop policy if exists pricing_tiers_write on public.pricing_tiers;
create policy pricing_tiers_write on public.pricing_tiers
  for all to authenticated
  using (
    org_id = public.current_org_id()
    and public.current_user_role() in ('org_owner', 'org_admin', 'accounting', 'sales')
  )
  with check (
    org_id = public.current_org_id()
    and public.current_user_role() in ('org_owner', 'org_admin', 'accounting', 'sales')
  );

-- ---------------------------------------------------------------------------
-- customer_pricing_overrides: per (customer, item) override. Item references
-- public.items (created in 0012). We forward-declare the column without a FK
-- and add the FK after items exists in 0012's tail. Simpler: skip the FK and
-- rely on application enforcement, since the customer dimension itself is
-- owned by a separate agent. Money columns end in _cents BIGINT.
-- ---------------------------------------------------------------------------

create table if not exists public.customer_pricing_overrides (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  customer_id uuid not null,
  item_id uuid not null,
  unit_price_cents bigint check (unit_price_cents >= 0),
  discount_bps integer check (discount_bps >= 0 and discount_bps <= 100000),
  currency_code text references public.currencies(code),
  is_active boolean not null default true,
  effective_from date,
  effective_to date,
  notes text,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  deleted_at timestamptz,
  unique (org_id, customer_id, item_id)
);

create index if not exists customer_pricing_overrides_lookup_idx
  on public.customer_pricing_overrides (org_id, customer_id, item_id)
  where is_active and deleted_at is null;

alter table public.customer_pricing_overrides enable row level security;

drop policy if exists customer_pricing_overrides_select on public.customer_pricing_overrides;
create policy customer_pricing_overrides_select on public.customer_pricing_overrides
  for select to authenticated
  using (org_id = public.current_org_id());

drop policy if exists customer_pricing_overrides_write on public.customer_pricing_overrides;
create policy customer_pricing_overrides_write on public.customer_pricing_overrides
  for all to authenticated
  using (
    org_id = public.current_org_id()
    and public.current_user_role() in ('org_owner', 'org_admin', 'accounting', 'sales')
  )
  with check (
    org_id = public.current_org_id()
    and public.current_user_role() in ('org_owner', 'org_admin', 'accounting', 'sales')
  );
