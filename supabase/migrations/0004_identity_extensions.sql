-- ============================================================================
-- Migration: 0004_identity_extensions.sql
-- Wave: 2
-- Phase: Identity / tenancy / branding / settings backend
-- Closes: R-W2-AGENT-A-01 org_settings table missing,
--         R-W2-AGENT-A-02 org_domains table missing,
--         R-W2-AGENT-A-03 numbering_sequences table + RPC missing,
--         R-W2-AGENT-A-04 identity_providers metadata table missing
-- Date: 2026-05-18
-- DOWN MIGRATION: operator-only. Drop in reverse dependency order
--   (next_doc_number, numbering_sequences, org_domains, org_settings,
--   identity_providers). Not auto-run.
--
-- Constitutional alignment:
--   RLS rules          Every new tenant-scoped table carries an RLS policy
--                      from the migration that creates it. Pattern A for
--                      org_settings, org_domains, numbering_sequences,
--                      identity_providers (all single-table org_id scoping).
--   Audit rules        Untouched. The audit_log chain from 0001-0002 covers
--                      organizations.status only. Later waves attach triggers
--                      to state-machine tables in this migration set.
--   Idempotency rules  Untouched. next_doc_number serialises per-tenant
--                      per-doc-type via pg_advisory_xact_lock so concurrent
--                      callers receive distinct, gap-free numbers.
--   Money rules        Untouched.
--   Migration rules    Forward-only. All DDL idempotent.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- org_settings: per-tenant key/value store. Three-part composite key so a
-- single tenant can carry independent group/key namespaces (general,
-- finance, sales, ops). JSONB value lets the SPA store typed leaves
-- without a schema-change-per-setting churn cycle.
--
-- Read by settings-api/settings. Writes are gated by capability check at the
-- handler boundary (settings.write); RLS adds Pattern A defence in depth.
-- ---------------------------------------------------------------------------

create table if not exists public.org_settings (
  org_id uuid not null references public.organizations(id) on delete cascade,
  group_key text not null,
  setting_key text not null,
  value jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  primary key (org_id, group_key, setting_key)
);

create index if not exists org_settings_group_idx
  on public.org_settings (org_id, group_key);

alter table public.org_settings enable row level security;

drop policy if exists org_settings_select on public.org_settings;
create policy org_settings_select on public.org_settings
  for select to authenticated
  using (org_id = public.current_org_id());

drop policy if exists org_settings_write on public.org_settings;
create policy org_settings_write on public.org_settings
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
-- org_domains: custom-host mapping for whitelabel deployments. Public
-- resolver looks up by host header at app boot before authentication. Once
-- the SPA knows the org_id it knows which branding to fetch on first paint.
--
-- verified_at distinguishes operator-attested mappings from pending claims.
-- The resolver only returns rows where verified_at is not null.
-- ---------------------------------------------------------------------------

create table if not exists public.org_domains (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  host text not null,
  is_primary boolean not null default false,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  unique (host)
);

create index if not exists org_domains_org_idx
  on public.org_domains (org_id);

alter table public.org_domains enable row level security;

drop policy if exists org_domains_select on public.org_domains;
create policy org_domains_select on public.org_domains
  for select to authenticated
  using (org_id = public.current_org_id());

drop policy if exists org_domains_write on public.org_domains;
create policy org_domains_write on public.org_domains
  for all to authenticated
  using (
    org_id = public.current_org_id()
    and public.current_user_role() in ('org_owner', 'org_admin')
  )
  with check (
    org_id = public.current_org_id()
    and public.current_user_role() in ('org_owner', 'org_admin')
  );

-- Public host resolution: a SECURITY DEFINER RPC. The tenants-api public
-- route calls this with verify_jwt = false; the RPC restricts to verified
-- rows and returns org_id / org_slug only.
create or replace function public.resolve_org_by_host(p_host text)
returns table (org_id uuid, org_slug text)
language sql
stable
security definer
set search_path = public
as $$
  select d.org_id, o.slug::text as org_slug
    from public.org_domains d
    join public.organizations o on o.id = d.org_id
   where d.host = lower(p_host)
     and d.verified_at is not null
     and o.deleted_at is null
   limit 1;
$$;

revoke execute on function public.resolve_org_by_host(text) from public;
grant  execute on function public.resolve_org_by_host(text) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- numbering_sequences: per-tenant per-doc-type seed rows for gap-free,
-- pg_advisory_xact_lock-serialised allocation. _shared/numbering.ts wraps
-- the next_doc_number RPC; sales and finance bundles in later waves are the
-- first callers.
--
-- reset_period: 'never' | 'yearly' | 'monthly'. The RPC compares
-- last_reset_period to the current period; on transition the seq resets to
-- 1 and last_reset_period is updated.
-- ---------------------------------------------------------------------------

create table if not exists public.numbering_sequences (
  org_id uuid not null references public.organizations(id) on delete cascade,
  doc_type text not null
    check (doc_type in (
      'quote', 'invoice', 'credit_note', 'payment',
      'project', 'purchase_order', 'vendor_bill', 'expense',
      'journal_entry', 'receiving_order', 'production_run', 'shipment'
    )),
  prefix text not null default '',
  pad_width integer not null default 5 check (pad_width between 1 and 12),
  include_year boolean not null default true,
  reset_period text not null default 'yearly'
    check (reset_period in ('never', 'yearly', 'monthly')),
  next_value bigint not null default 1,
  last_reset_period text,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  primary key (org_id, doc_type)
);

alter table public.numbering_sequences enable row level security;

drop policy if exists numbering_sequences_select on public.numbering_sequences;
create policy numbering_sequences_select on public.numbering_sequences
  for select to authenticated
  using (org_id = public.current_org_id());

drop policy if exists numbering_sequences_write on public.numbering_sequences;
create policy numbering_sequences_write on public.numbering_sequences
  for all to authenticated
  using (
    org_id = public.current_org_id()
    and public.current_user_role() in ('org_owner', 'org_admin')
  )
  with check (
    org_id = public.current_org_id()
    and public.current_user_role() in ('org_owner', 'org_admin')
  );

-- next_doc_number: SECURITY DEFINER allocator. Caller is service-role from
-- edge functions. Uses pg_advisory_xact_lock keyed on (org_id, doc_type) for
-- single-writer serialisation under concurrent load. Returns the formatted
-- string (e.g. INV2026-000123). Creates the seed row on first call so
-- handlers do not need to bootstrap.
create or replace function public.next_doc_number(p_org_id uuid, p_doc_type text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lock_key bigint;
  v_row public.numbering_sequences%rowtype;
  v_period text;
  v_value bigint;
  v_formatted text;
begin
  if p_org_id is null then
    raise exception 'VALIDATION_ERROR: p_org_id is required' using errcode = '22023';
  end if;
  if p_doc_type is null or length(trim(p_doc_type)) = 0 then
    raise exception 'VALIDATION_ERROR: p_doc_type is required' using errcode = '22023';
  end if;

  v_lock_key := ('x' || substr(md5(p_org_id::text || ':' || p_doc_type), 1, 16))::bit(64)::bigint;
  perform pg_advisory_xact_lock(v_lock_key);

  select * into v_row
    from public.numbering_sequences
   where org_id = p_org_id and doc_type = p_doc_type;

  if not found then
    insert into public.numbering_sequences (org_id, doc_type)
    values (p_org_id, p_doc_type)
    returning * into v_row;
  end if;

  -- Compute the current period token per reset policy.
  v_period := case v_row.reset_period
    when 'never'   then ''
    when 'yearly'  then to_char(now(), 'YYYY')
    when 'monthly' then to_char(now(), 'YYYY-MM')
  end;

  if v_row.reset_period <> 'never'
     and v_row.last_reset_period is distinct from v_period then
    update public.numbering_sequences
       set next_value = 1,
           last_reset_period = v_period,
           updated_at = now()
     where org_id = p_org_id and doc_type = p_doc_type
    returning * into v_row;
  end if;

  v_value := v_row.next_value;

  update public.numbering_sequences
     set next_value = v_row.next_value + 1,
         updated_at = now()
   where org_id = p_org_id and doc_type = p_doc_type;

  v_formatted :=
    coalesce(v_row.prefix, '')
    || case when v_row.include_year then to_char(now(), 'YYYY') || '-' else '' end
    || lpad(v_value::text, v_row.pad_width, '0');

  return v_formatted;
end;
$$;

revoke execute on function public.next_doc_number(uuid, text) from public, anon;
grant  execute on function public.next_doc_number(uuid, text) to authenticated, service_role;

-- reset_numbering_sequence: operator-only reset. Audit log entry handled at
-- the handler boundary in settings-api so we capture actor and reason.
create or replace function public.reset_numbering_sequence(
  p_org_id uuid,
  p_doc_type text,
  p_next_value bigint default 1
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_org_id is null or p_doc_type is null or p_next_value < 1 then
    raise exception 'VALIDATION_ERROR' using errcode = '22023';
  end if;
  update public.numbering_sequences
     set next_value = p_next_value,
         last_reset_period = null,
         updated_at = now()
   where org_id = p_org_id and doc_type = p_doc_type;
end;
$$;

revoke execute on function public.reset_numbering_sequence(uuid, text, bigint) from public, anon;
grant  execute on function public.reset_numbering_sequence(uuid, text, bigint) to service_role;

-- ---------------------------------------------------------------------------
-- identity_providers: per-tenant SSO provider metadata. Distinct from the
-- sso_connections / saml_configs pair in 0002: those carry the protocol
-- bindings (entity ids, ACS urls). identity_providers carries the
-- product-level metadata (display label, icon, allowed email domains for
-- auto-routing) that the sign-in page needs without touching SAML internals.
-- Closes D-007 per the Decisions log.
-- ---------------------------------------------------------------------------

create table if not exists public.identity_providers (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  provider_kind text not null check (provider_kind in ('saml', 'oidc', 'password')),
  display_label text not null,
  icon_url text,
  email_domain_pattern text,
  sso_connection_id uuid references public.sso_connections(id) on delete set null,
  is_enabled boolean not null default false,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  unique (org_id, display_label)
);

create index if not exists identity_providers_org_idx
  on public.identity_providers (org_id) where is_enabled;

alter table public.identity_providers enable row level security;

drop policy if exists identity_providers_select on public.identity_providers;
create policy identity_providers_select on public.identity_providers
  for select to authenticated
  using (org_id = public.current_org_id());

drop policy if exists identity_providers_write on public.identity_providers;
create policy identity_providers_write on public.identity_providers
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
-- profiles update self capability already covered by 0001 RLS. No change.
-- ---------------------------------------------------------------------------
