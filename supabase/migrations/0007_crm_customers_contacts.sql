-- ============================================================================
-- Migration: 0007_crm_customers_contacts.sql
-- Wave: 2
-- Phase: CRM core (Agent B)
-- Closes: R-W2-CRM-01 (customer / contact entity gap), R-W2-CRM-02 (RLS Pattern A
--         on tenant-scoped CRM tables)
-- Date: 2026-05-18
-- DOWN MIGRATION: operator-only. Drop in reverse dependency order:
--   drop table public.contacts cascade;
--   drop table public.customers cascade;
--   Not auto-run.
--
-- Constitutional alignment:
--   Money rules        No monetary columns in this migration. Currency code
--                      surface only.
--   RLS rules          Pattern A on customers and contacts: scope to
--                      current_org_id() and gate writes behind staff roles.
--                      Filter never throws; cross-tenant read returns empty.
--   Idempotency rules  Idempotency is enforced at the handler boundary; the
--                      schema only carries the 4-tuple audit columns.
--   Audit rules        Schema includes 4-tuple stamping; stage/state change
--                      triggers land in 0010. No INSERT/UPDATE/DELETE policy
--                      on audit_log here.
--   Migration rules    Forward-only. All DDL idempotent.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- customers: per-tenant customer account. Pattern A RLS. Soft-delete via
-- deleted_at. Tags as text array for cheap filtering; structured custom
-- fields are deferred to a later wave.
-- ---------------------------------------------------------------------------

create table if not exists public.customers (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  display_name text not null,
  kind text not null default 'company'
    check (kind in ('company', 'individual')),
  status text not null default 'new'
    check (status in ('new', 'active', 'inactive')),
  primary_email citext,
  primary_phone text,
  tax_id text,
  billing_address jsonb,
  shipping_address jsonb,
  default_currency_code text,
  tags text[] not null default '{}'::text[],
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  deleted_at timestamptz
);

create index if not exists customers_org_status_idx
  on public.customers (org_id, status)
  where deleted_at is null;

create index if not exists customers_org_display_name_idx
  on public.customers (org_id, lower(display_name))
  where deleted_at is null;

create index if not exists customers_org_email_idx
  on public.customers (org_id, primary_email)
  where deleted_at is null and primary_email is not null;

alter table public.customers enable row level security;

drop policy if exists customers_select on public.customers;
create policy customers_select on public.customers
  for select to authenticated
  using (org_id = public.current_org_id());

drop policy if exists customers_write on public.customers;
create policy customers_write on public.customers
  for all to authenticated
  using (
    org_id = public.current_org_id()
    and public.current_user_role() in (
      'org_owner', 'org_admin', 'sales', 'ops'
    )
  )
  with check (
    org_id = public.current_org_id()
    and public.current_user_role() in (
      'org_owner', 'org_admin', 'sales', 'ops'
    )
  );

-- ---------------------------------------------------------------------------
-- contacts: per-customer contact people. Pattern A RLS (carries its own
-- org_id, joined to customer.org_id by FK + handler-level filter).
-- ---------------------------------------------------------------------------

create table if not exists public.contacts (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  first_name text not null,
  last_name text,
  email citext,
  phone text,
  title text,
  is_primary boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  deleted_at timestamptz
);

create unique index if not exists contacts_primary_per_customer_uq
  on public.contacts (customer_id)
  where is_primary and deleted_at is null;

create index if not exists contacts_org_customer_idx
  on public.contacts (org_id, customer_id)
  where deleted_at is null;

create index if not exists contacts_org_email_idx
  on public.contacts (org_id, email)
  where deleted_at is null and email is not null;

alter table public.contacts enable row level security;

drop policy if exists contacts_select on public.contacts;
create policy contacts_select on public.contacts
  for select to authenticated
  using (org_id = public.current_org_id());

drop policy if exists contacts_write on public.contacts;
create policy contacts_write on public.contacts
  for all to authenticated
  using (
    org_id = public.current_org_id()
    and public.current_user_role() in (
      'org_owner', 'org_admin', 'sales', 'ops'
    )
  )
  with check (
    org_id = public.current_org_id()
    and public.current_user_role() in (
      'org_owner', 'org_admin', 'sales', 'ops'
    )
  );
