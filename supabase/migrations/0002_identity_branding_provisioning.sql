-- ============================================================================
-- Migration: 0002_identity_branding_provisioning.sql
-- Wave: 1
-- Phase: Identity, tenancy, branding
-- Closes: R-W1-PROVISION-01, R-W1-FSM-01, R-W1-AUDIT-01, R-W1-SSO-01, R-W1-BRAND-01
-- Date: 2026-05-17
-- DOWN MIGRATION: operator-only. Drop new objects in reverse dependency order
--   (saml_configs, sso_connections, RPCs, trigger, function), then relax the
--   organizations.status check back to ('active', 'suspended', 'archived').
--   Not auto-run.
--
-- Constitutional alignment:
--   RLS rules          Every new tenant-scoped table carries a Pattern A or B
--                      policy from the migration that creates it.
--   Audit rules        organizations.status transitions are written by an
--                      auto-state-transition trigger. The trigger is the
--                      single writer; no best-effort handler writes.
--                      audit_log remains append-only via the absence of
--                      INSERT/UPDATE/DELETE policies for authenticated.
--                      Service-role writes only; trigger runs as definer.
--   Idempotency rules  provision_organization is an atomic transaction.
--                      Re-running with the same slug returns the existing org
--                      row instead of duplicating tenant state.
--   Money rules        Untouched.
--   Migration rules    Forward-only. All DDL idempotent.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- organizations.status: lift the check to include 'provisioning' as the
-- initial state on creation. provision_organization transitions to 'active'.
-- ---------------------------------------------------------------------------

do $$
begin
  if exists (
    select 1 from pg_constraint
     where conrelid = 'public.organizations'::regclass
       and conname  = 'organizations_status_check'
  ) then
    alter table public.organizations
      drop constraint organizations_status_check;
  end if;
end$$;

alter table public.organizations
  add constraint organizations_status_check
  check (status in ('provisioning', 'active', 'suspended', 'archived'));

-- ---------------------------------------------------------------------------
-- audit_log: chain-tail helper view per org. The trigger consults the last
-- written payload_hash to chain forward. We rely on pg_advisory_xact_lock
-- keyed on org_id to serialise concurrent writers within a transaction.
-- ---------------------------------------------------------------------------

create or replace function public.kitstak_audit_canonical(payload jsonb)
returns text
language sql
immutable
as $$
  -- Deterministic canonical JSON: jsonb's text cast already sorts keys
  -- alphabetically and normalises whitespace. Wrapping here so the trigger
  -- and verifier share one definition.
  select coalesce(payload::text, 'null');
$$;

revoke execute on function public.kitstak_audit_canonical(jsonb) from public, anon;
grant execute on function public.kitstak_audit_canonical(jsonb) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Trigger function: organizations -> audit_log on status change.
-- AFTER UPDATE OF status. Writes a single row per transition. Hash chain is
-- maintained per-org by reading the last payload_hash for that org under an
-- advisory transaction lock.
-- ---------------------------------------------------------------------------

create or replace function public.trg_audit_organizations_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prev_hash text;
  v_payload   jsonb;
  v_payload_hash text;
  v_triggered_by uuid;
  v_lock_key bigint;
begin
  if new.status is null or new.status = old.status then
    return new;
  end if;

  -- Resolve actor: COALESCE(auth.uid(), new.updated_by). Either may be null
  -- in maintenance contexts; the column is nullable.
  begin
    v_triggered_by := coalesce(auth.uid(), new.updated_by);
  exception when others then
    v_triggered_by := new.updated_by;
  end;

  -- Serialise per-org writers within the same transaction for chain stability.
  v_lock_key := ('x' || substr(md5(new.id::text), 1, 16))::bit(64)::bigint;
  perform pg_advisory_xact_lock(v_lock_key);

  select payload_hash
    into v_prev_hash
    from public.audit_log
   where org_id = new.id
   order by triggered_at desc, id desc
   limit 1;

  v_payload := jsonb_build_object(
    'org_id',       new.id,
    'entity_type',  'organization',
    'entity_id',    new.id,
    'from_state',   old.status,
    'to_state',     new.status,
    'action',       'status_change',
    'triggered_by', v_triggered_by,
    'diff_json',    jsonb_build_object(
                       'status', jsonb_build_object(
                         'from', old.status,
                         'to',   new.status
                       )
                    ),
    'prev_hash',    v_prev_hash
  );

  v_payload_hash := encode(
    digest(public.kitstak_audit_canonical(v_payload), 'sha256'),
    'hex'
  );

  insert into public.audit_log (
    org_id, entity_type, entity_id,
    from_state, to_state, action,
    triggered_by, diff_json,
    prev_hash, payload_hash
  ) values (
    new.id, 'organization', new.id,
    old.status, new.status, 'status_change',
    v_triggered_by,
    jsonb_build_object(
      'status', jsonb_build_object('from', old.status, 'to', new.status)
    ),
    v_prev_hash, v_payload_hash
  );

  return new;
end;
$$;

revoke execute on function public.trg_audit_organizations_status() from public, anon;

drop trigger if exists audit_organizations_status on public.organizations;
create trigger audit_organizations_status
  after update of status on public.organizations
  for each row execute function public.trg_audit_organizations_status();

-- ---------------------------------------------------------------------------
-- verify_audit_chain(p_org_id): walks the per-org chain and returns the first
-- row whose recomputed payload_hash disagrees with the stored value, or null
-- if the chain is intact. Nightly verifier consumes this RPC.
-- ---------------------------------------------------------------------------

create or replace function public.verify_audit_chain(p_org_id uuid)
returns table (
  broken_id           uuid,
  broken_triggered_at timestamptz,
  expected_hash       text,
  stored_hash         text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  r           public.audit_log%rowtype;
  v_prev_hash text := null;
  v_payload   jsonb;
  v_expected  text;
begin
  for r in
    select * from public.audit_log
     where org_id = p_org_id
     order by triggered_at asc, id asc
  loop
    v_payload := jsonb_build_object(
      'org_id',       r.org_id,
      'entity_type',  r.entity_type,
      'entity_id',    r.entity_id,
      'from_state',   r.from_state,
      'to_state',     r.to_state,
      'action',       r.action,
      'triggered_by', r.triggered_by,
      'diff_json',    r.diff_json,
      'prev_hash',    v_prev_hash
    );
    v_expected := encode(
      digest(public.kitstak_audit_canonical(v_payload), 'sha256'),
      'hex'
    );

    if r.payload_hash is distinct from v_expected
       or r.prev_hash  is distinct from v_prev_hash then
      broken_id           := r.id;
      broken_triggered_at := r.triggered_at;
      expected_hash       := v_expected;
      stored_hash         := r.payload_hash;
      return next;
      return;
    end if;

    v_prev_hash := r.payload_hash;
  end loop;
  return;
end;
$$;

revoke execute on function public.verify_audit_chain(uuid) from public, anon;
grant execute on function public.verify_audit_chain(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- provision_organization(p_slug, p_display_name, p_owner_user_id, p_owner_email):
-- atomic transaction that
--   1. inserts an organization row in 'provisioning' status,
--   2. ensures a profile row exists for the owner,
--   3. inserts an org_membership binding the owner to org_owner,
--   4. inserts a default org_branding row,
--   5. transitions the organization to 'active' (fires the audit trigger).
-- Returns the org_id. Re-runs with the same slug short-circuit by returning
-- the existing organization id without mutation.
-- ---------------------------------------------------------------------------

create or replace function public.provision_organization(
  p_slug           text,
  p_display_name   text,
  p_owner_user_id  uuid,
  p_owner_email    text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id  uuid;
  v_role_id uuid;
begin
  if p_slug is null or length(trim(p_slug)) = 0 then
    raise exception 'VALIDATION_ERROR: p_slug is required' using errcode = '22023';
  end if;
  if p_display_name is null or length(trim(p_display_name)) = 0 then
    raise exception 'VALIDATION_ERROR: p_display_name is required' using errcode = '22023';
  end if;
  if p_owner_user_id is null then
    raise exception 'VALIDATION_ERROR: p_owner_user_id is required' using errcode = '22023';
  end if;
  if p_owner_email is null or length(trim(p_owner_email)) = 0 then
    raise exception 'VALIDATION_ERROR: p_owner_email is required' using errcode = '22023';
  end if;

  select id into v_org_id
    from public.organizations
   where slug = p_slug
   limit 1;

  if v_org_id is not null then
    return v_org_id;
  end if;

  select id into v_role_id from public.roles where code = 'org_owner' limit 1;
  if v_role_id is null then
    raise exception 'INTERNAL_ERROR: org_owner role missing'
      using errcode = 'P0001';
  end if;

  insert into public.organizations (
    slug, display_name, status, created_by, updated_by
  ) values (
    p_slug, p_display_name, 'provisioning', p_owner_user_id, p_owner_user_id
  )
  returning id into v_org_id;

  insert into public.profiles (user_id, email, display_name, is_active)
  values (p_owner_user_id, p_owner_email, p_display_name, true)
  on conflict (user_id) do nothing;

  insert into public.org_memberships (
    org_id, user_id, role_id, is_active, joined_at, created_by, updated_by
  ) values (
    v_org_id, p_owner_user_id, v_role_id, true, now(), p_owner_user_id, p_owner_user_id
  )
  on conflict (org_id, user_id) do nothing;

  insert into public.org_branding (org_id, created_by, updated_by)
  values (v_org_id, p_owner_user_id, p_owner_user_id)
  on conflict (org_id) do nothing;

  update public.organizations
     set status     = 'active',
         updated_at = now(),
         updated_by = p_owner_user_id
   where id = v_org_id;

  return v_org_id;
end;
$$;

revoke execute on function public.provision_organization(text, text, uuid, text)
  from public, anon, authenticated;
grant  execute on function public.provision_organization(text, text, uuid, text)
  to service_role;

-- ---------------------------------------------------------------------------
-- sso_connections: per-tenant SSO provider entry. Pattern A RLS.
-- saml_configs:     per-connection SAML config. Pattern B RLS (parent join).
-- Schema only in Wave 1; provider integration deferred.
-- ---------------------------------------------------------------------------

create table if not exists public.sso_connections (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  provider text not null check (provider in ('saml', 'oidc')),
  display_name text not null,
  is_active boolean not null default false,
  default_role_code text not null default 'viewer'
    references public.roles(code) on update cascade,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  unique (org_id, display_name)
);

create index if not exists sso_connections_org_idx
  on public.sso_connections (org_id) where is_active;

alter table public.sso_connections enable row level security;

drop policy if exists sso_connections_select on public.sso_connections;
create policy sso_connections_select on public.sso_connections
  for select to authenticated
  using (org_id = public.current_org_id());

drop policy if exists sso_connections_write on public.sso_connections;
create policy sso_connections_write on public.sso_connections
  for all to authenticated
  using (
    org_id = public.current_org_id()
    and public.current_user_role() in ('org_owner', 'org_admin')
  )
  with check (
    org_id = public.current_org_id()
    and public.current_user_role() in ('org_owner', 'org_admin')
  );

create table if not exists public.saml_configs (
  sso_connection_id uuid primary key
    references public.sso_connections(id) on delete cascade,
  idp_entity_id text not null,
  idp_sso_url text not null,
  idp_metadata_url text,
  idp_x509_cert text not null,
  sp_entity_id text not null,
  sp_acs_url text not null,
  attribute_mappings jsonb not null default '{}'::jsonb,
  signature_algorithm text not null default 'rsa-sha256',
  want_assertions_signed boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid
);

alter table public.saml_configs enable row level security;

drop policy if exists saml_configs_select on public.saml_configs;
create policy saml_configs_select on public.saml_configs
  for select to authenticated
  using (
    exists (
      select 1 from public.sso_connections sc
       where sc.id = saml_configs.sso_connection_id
         and sc.org_id = public.current_org_id()
    )
  );

drop policy if exists saml_configs_write on public.saml_configs;
create policy saml_configs_write on public.saml_configs
  for all to authenticated
  using (
    exists (
      select 1 from public.sso_connections sc
       where sc.id = saml_configs.sso_connection_id
         and sc.org_id = public.current_org_id()
         and public.current_user_role() in ('org_owner', 'org_admin')
    )
  )
  with check (
    exists (
      select 1 from public.sso_connections sc
       where sc.id = saml_configs.sso_connection_id
         and sc.org_id = public.current_org_id()
         and public.current_user_role() in ('org_owner', 'org_admin')
    )
  );
