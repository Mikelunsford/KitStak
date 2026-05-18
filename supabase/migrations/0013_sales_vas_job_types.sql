-- ============================================================================
-- Migration: 0013_sales_vas_job_types.sql
-- Wave: 2
-- Phase: Sales chassis (value_added_services, job_types)
-- Closes: R-W2-VAS-01, R-W2-JOB-TYPES-01
-- Date: 2026-05-18
-- DOWN MIGRATION: operator-only. Drop value_added_services, job_types in
--   reverse dependency order. Not auto-run.
--
-- Constitutional alignment:
--   Money rules    base_price_cents stored as BIGINT cents.
--   RLS rules      Pattern A on every table.
--   Migration rules Forward-only. All DDL idempotent.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- value_added_services: per-org VAS catalog. Pattern A. Money in cents.
-- Pricing model varies (flat, per-unit, hourly) and is selected by `kind`.
-- ---------------------------------------------------------------------------

create table if not exists public.value_added_services (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  code text not null,
  name text not null,
  description text,
  kind text not null default 'flat'
    check (kind in ('flat', 'per_unit', 'hourly', 'tiered')),
  base_price_cents bigint not null default 0 check (base_price_cents >= 0),
  currency_code text not null default 'USD' references public.currencies(code),
  default_tax_id uuid references public.taxes(id) on delete set null,
  is_active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  deleted_at timestamptz,
  unique (org_id, code)
);

create index if not exists value_added_services_org_active_idx
  on public.value_added_services (org_id) where is_active and deleted_at is null;

alter table public.value_added_services enable row level security;

drop policy if exists value_added_services_select on public.value_added_services;
create policy value_added_services_select on public.value_added_services
  for select to authenticated
  using (org_id = public.current_org_id());

drop policy if exists value_added_services_write on public.value_added_services;
create policy value_added_services_write on public.value_added_services
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
-- job_types: per-org job classification used when work moves into projects.
-- Pattern A.
-- ---------------------------------------------------------------------------

create table if not exists public.job_types (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  code text not null,
  name text not null,
  description text,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  deleted_at timestamptz,
  unique (org_id, code)
);

alter table public.job_types enable row level security;

drop policy if exists job_types_select on public.job_types;
create policy job_types_select on public.job_types
  for select to authenticated
  using (org_id = public.current_org_id());

drop policy if exists job_types_write on public.job_types;
create policy job_types_write on public.job_types
  for all to authenticated
  using (
    org_id = public.current_org_id()
    and public.current_user_role() in ('org_owner', 'org_admin', 'sales', 'ops')
  )
  with check (
    org_id = public.current_org_id()
    and public.current_user_role() in ('org_owner', 'org_admin', 'sales', 'ops')
  );
