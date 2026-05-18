-- ============================================================================
-- Migration: 0001_foundation.sql
-- Wave: 0
-- Phase: Foundation
-- Closes: R-W0-CHASSIS-01, R-W0-AUDIT-01, R-W0-IDEMP-01, R-W0-BRAND-01
-- Date: 2026-05-17
-- DOWN MIGRATION: operator-only. Drop in reverse dependency order. Not auto-run.
--
-- Constitutional alignment:
--   Money rules         BIGINT cents enforced on every monetary column.
--   RLS rules           Every tenant-scoped table carries an RLS policy from creation.
--   Idempotency rules   idempotency_keys PK is (key, user_id, org_id, route_hash).
--   Audit rules         audit_log is append-only with hash-chain columns from day one.
--   Migration rules     Forward-only. All DDL is idempotent.
-- ============================================================================

create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";
create extension if not exists "citext";

-- ---------------------------------------------------------------------------
-- Helper functions: tenant scope resolution from JWT claims.
-- ---------------------------------------------------------------------------

create or replace function public.current_org_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select nullif(
    coalesce(
      current_setting('request.jwt.claim.app_metadata.kitstak_org_id', true),
      current_setting('request.jwt.claims', true)::jsonb -> 'app_metadata' ->> 'kitstak_org_id'
    ),
    ''
  )::uuid;
$$;

revoke execute on function public.current_org_id() from public, anon;
grant execute on function public.current_org_id() to authenticated, service_role;

create or replace function public.current_user_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    current_setting('request.jwt.claim.app_metadata.kitstak_org_role', true),
    current_setting('request.jwt.claims', true)::jsonb -> 'app_metadata' ->> 'kitstak_org_role'
  );
$$;

revoke execute on function public.current_user_role() from public, anon;
grant execute on function public.current_user_role() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- organizations: the root tenant entity. One row per customer.
-- ---------------------------------------------------------------------------

create table if not exists public.organizations (
  id uuid primary key default uuid_generate_v4(),
  slug citext not null unique,
  display_name text not null,
  legal_name text,
  industry text,
  region text not null default 'us-west-1',
  default_locale text not null default 'en-US',
  default_timezone text not null default 'America/Chicago',
  default_currency_code text not null default 'USD',
  date_format text not null default 'MM/dd/yyyy',
  plan_code text not null default 'starter',
  status text not null default 'active'
    check (status in ('active', 'suspended', 'archived')),
  billing_email text,
  support_email text,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  deleted_at timestamptz
);

create index if not exists organizations_status_idx
  on public.organizations (status)
  where deleted_at is null;

alter table public.organizations enable row level security;

drop policy if exists organizations_select on public.organizations;
create policy organizations_select on public.organizations
  for select to authenticated
  using (id = public.current_org_id());

drop policy if exists organizations_write on public.organizations;
create policy organizations_write on public.organizations
  for all to authenticated
  using (
    id = public.current_org_id()
    and public.current_user_role() in ('org_owner', 'org_admin')
  )
  with check (
    id = public.current_org_id()
    and public.current_user_role() in ('org_owner', 'org_admin')
  );

-- ---------------------------------------------------------------------------
-- roles: the static set of capability bundles.
-- ---------------------------------------------------------------------------

create table if not exists public.roles (
  id uuid primary key default uuid_generate_v4(),
  code text not null unique
    check (code in (
      'org_owner', 'org_admin', 'sales', 'ops',
      'accounting', 'viewer', 'customer_user', 'vendor_user'
    )),
  label text not null,
  description text,
  is_staff boolean not null default true,
  is_system boolean not null default true,
  scope_level integer not null default 0,
  capabilities jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.roles enable row level security;

drop policy if exists roles_select on public.roles;
create policy roles_select on public.roles
  for select to authenticated using (true);

-- ---------------------------------------------------------------------------
-- org_memberships: which user belongs to which org with which role.
-- ---------------------------------------------------------------------------

create table if not exists public.org_memberships (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null,
  role_id uuid not null references public.roles(id),
  customer_id uuid,
  is_active boolean not null default true,
  invited_at timestamptz,
  joined_at timestamptz,
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  unique (org_id, user_id)
);

create index if not exists org_memberships_user_idx
  on public.org_memberships (user_id) where is_active;

alter table public.org_memberships enable row level security;

drop policy if exists org_memberships_select on public.org_memberships;
create policy org_memberships_select on public.org_memberships
  for select to authenticated
  using (org_id = public.current_org_id());

drop policy if exists org_memberships_write on public.org_memberships;
create policy org_memberships_write on public.org_memberships
  for all to authenticated
  using (
    org_id = public.current_org_id()
    and public.current_user_role() in ('org_owner', 'org_admin')
  )
  with check (
    org_id = public.current_org_id()
    and public.current_user_role() in ('org_owner', 'org_admin')
  );

-- ---------------------------------------------------------------------------
-- profiles: lightweight user metadata mirror keyed by Supabase auth.users.id.
-- ---------------------------------------------------------------------------

create table if not exists public.profiles (
  user_id uuid primary key,
  email citext not null,
  display_name text,
  given_name text,
  family_name text,
  photo_url text,
  phone text,
  locale text,
  timezone text,
  last_org_id uuid,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid
);

alter table public.profiles enable row level security;

drop policy if exists profiles_self_select on public.profiles;
create policy profiles_self_select on public.profiles
  for select to authenticated
  using (user_id = auth.uid());

drop policy if exists profiles_self_update on public.profiles;
create policy profiles_self_update on public.profiles
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- org_branding: server-rendered theme tokens per tenant.
-- Replaces any client-side persistence of branding values.
-- ---------------------------------------------------------------------------

create table if not exists public.org_branding (
  org_id uuid primary key references public.organizations(id) on delete cascade,
  logo_url text,
  icon_url text,
  email_logo_url text,
  primary_color text not null default '#0a1628',
  accent_color text not null default '#c8102e',
  on_primary text not null default '#f5f1e8',
  font_family text not null default 'Inter Tight',
  invoice_pdf_footer text,
  quote_pdf_footer text,
  app_name_override text,
  support_url text,
  privacy_url text,
  terms_url text,
  custom_css text,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid
);

alter table public.org_branding enable row level security;

drop policy if exists org_branding_select on public.org_branding;
create policy org_branding_select on public.org_branding
  for select to authenticated
  using (org_id = public.current_org_id());

drop policy if exists org_branding_write on public.org_branding;
create policy org_branding_write on public.org_branding
  for all to authenticated
  using (
    org_id = public.current_org_id()
    and public.current_user_role() in ('org_owner', 'org_admin')
  )
  with check (
    org_id = public.current_org_id()
    and public.current_user_role() in ('org_owner', 'org_admin')
  );

-- ---------------------------------------------------------------------------
-- org_feature_flags: per-tenant feature toggle store with JSONB config.
-- Reserved plugin slots seeded later. Bundle gates return 404 when off;
-- per-route gates return 403 FEATURE_DISABLED.
-- ---------------------------------------------------------------------------

create table if not exists public.org_feature_flags (
  org_id uuid not null references public.organizations(id) on delete cascade,
  flag_key text not null,
  is_enabled boolean not null default false,
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  primary key (org_id, flag_key)
);

alter table public.org_feature_flags enable row level security;

drop policy if exists org_feature_flags_select on public.org_feature_flags;
create policy org_feature_flags_select on public.org_feature_flags
  for select to authenticated
  using (org_id = public.current_org_id());

drop policy if exists org_feature_flags_write on public.org_feature_flags;
create policy org_feature_flags_write on public.org_feature_flags
  for all to authenticated
  using (
    org_id = public.current_org_id()
    and public.current_user_role() in ('org_owner', 'org_admin')
  )
  with check (
    org_id = public.current_org_id()
    and public.current_user_role() in ('org_owner', 'org_admin')
  );

-- ---------------------------------------------------------------------------
-- idempotency_keys: keyed replays for state-changing endpoints.
-- PK is (key, user_id, org_id, route_hash) so the same UUID may be re-used
-- across orgs or routes without collision.
-- ---------------------------------------------------------------------------

create table if not exists public.idempotency_keys (
  key text not null,
  user_id uuid not null,
  org_id uuid not null references public.organizations(id) on delete cascade,
  route_hash text not null default '',
  body_hash text,
  status_code integer not null,
  response_jsonb jsonb,
  created_at timestamptz not null default now(),
  primary key (key, user_id, org_id, route_hash)
);

create index if not exists idempotency_keys_created_at_idx
  on public.idempotency_keys (created_at);

alter table public.idempotency_keys enable row level security;

drop policy if exists idempotency_keys_select on public.idempotency_keys;
create policy idempotency_keys_select on public.idempotency_keys
  for select to authenticated
  using (org_id = public.current_org_id() and user_id = auth.uid());

-- service_role-only writes; no direct insert/update/delete by authenticated.

-- ---------------------------------------------------------------------------
-- audit_log: append-only ledger with per-org hash chain.
-- ---------------------------------------------------------------------------

create table if not exists public.audit_log (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  entity_type text not null,
  entity_id uuid not null,
  from_state text,
  to_state text not null,
  action text,
  triggered_by uuid,
  triggered_at timestamptz not null default now(),
  diff_json jsonb,
  notes text,
  prev_hash text,
  payload_hash text,
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists audit_log_org_entity_idx
  on public.audit_log (org_id, entity_type, entity_id, triggered_at desc);

alter table public.audit_log enable row level security;

drop policy if exists audit_log_select on public.audit_log;
create policy audit_log_select on public.audit_log
  for select to authenticated
  using (org_id = public.current_org_id());

-- No INSERT, UPDATE, DELETE policy for authenticated. Service-role writes only.

-- ---------------------------------------------------------------------------
-- Seed default roles. Idempotent.
-- ---------------------------------------------------------------------------

insert into public.roles (code, label, description, is_staff, scope_level)
values
  ('org_owner', 'Owner', 'Owns the org. Full control.', true, 100),
  ('org_admin', 'Admin', 'Administers org membership and settings.', true, 90),
  ('sales', 'Sales', 'Quotes, leads, opportunities, customers.', true, 60),
  ('ops', 'Operations', 'Receiving, production, shipments.', true, 60),
  ('accounting', 'Accounting', 'Invoices, payments, period close.', true, 60),
  ('viewer', 'Viewer', 'Read-only across the org.', true, 10),
  ('customer_user', 'Customer User', 'External customer-portal user.', false, 5),
  ('vendor_user', 'Vendor User', 'External vendor-portal user.', false, 5)
on conflict (code) do nothing;
