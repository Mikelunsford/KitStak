-- ============================================================================
-- Migration: 0025_vendors_vendors.sql
-- Wave: 2
-- Phase: Vendors, POs, Vendor bills, Expenses, Inventory, 3PL Ops (Agent E)
-- Closes: R-W2-VENDORS-01
-- Date: 2026-05-18
-- DOWN MIGRATION: operator-only. drop table public.vendors. Not auto-run.
--
-- Constitutional alignment:
--   RLS rules         Pattern A: org_id = current_org_id() plus role check.
--   Money rules       Untouched here; vendor totals live in vendor_bills.
--   Migration rules   Forward-only. All DDL idempotent.
--   Audit rules       vendors has no state machine; no auto-state trigger.
-- ============================================================================

create table if not exists public.vendors (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  vendor_number text,
  display_name text not null,
  legal_name text,
  email citext,
  phone text,
  website text,
  tax_id text,
  default_currency_code text not null default 'USD',
  default_payment_terms_days integer not null default 30,
  notes text,
  is_active boolean not null default true,
  address_line1 text,
  address_line2 text,
  city text,
  region text,
  postal_code text,
  country_code text,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  deleted_at timestamptz,
  unique (org_id, vendor_number)
);

create index if not exists vendors_org_idx
  on public.vendors (org_id)
  where deleted_at is null;

create index if not exists vendors_org_name_idx
  on public.vendors (org_id, display_name)
  where deleted_at is null;

alter table public.vendors enable row level security;

drop policy if exists vendors_select on public.vendors;
create policy vendors_select on public.vendors
  for select to authenticated
  using (org_id = public.current_org_id());

drop policy if exists vendors_write on public.vendors;
create policy vendors_write on public.vendors
  for all to authenticated
  using (
    org_id = public.current_org_id()
    and public.current_user_role() in ('org_owner', 'org_admin', 'ops', 'accounting')
  )
  with check (
    org_id = public.current_org_id()
    and public.current_user_role() in ('org_owner', 'org_admin', 'ops', 'accounting')
  );
