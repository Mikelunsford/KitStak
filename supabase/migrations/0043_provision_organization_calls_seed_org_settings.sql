-- ============================================================================
-- Migration: 0043_provision_organization_calls_seed_org_settings.sql
-- Wave: 6
-- Phase: 6.5 (workflow integration remediation, Option B follow-up to 0042)
-- Closes: F-Wave6-DATA-02 (forward-path self-heal for provision_organization)
-- Date: 2026-05-18
-- DOWN MIGRATION: operator-only. Not auto-run. Restoring the 0002 definition
--   would re-introduce the symptom 0042 backfill closed. Operator can drop
--   the new function body via the file in 0002 if rolling back the entire
--   feature-flag chassis.
--
-- Constitutional alignment:
--   Migration rules  Forward-only. CREATE OR REPLACE FUNCTION is idempotent.
--                    The signature `(text, text, uuid, text)` matches the
--                    one declared in migration 0002, so we are redefining
--                    the same resolution target; no second overload is
--                    created and no GRANT changes are required.
--   RLS rules        Untouched.
--   Audit rules      The existing organizations.status UPDATE still fires
--                    trg_audit_organizations_status (installed in 0002),
--                    so the provisioning audit trail is preserved.
--   Idempotency      seed_org_settings uses ON CONFLICT DO NOTHING per flag
--                    so re-running provision_organization with the same slug
--                    short-circuits early (existing org id returned) without
--                    a duplicate seed pass; the slug short-circuit at the top
--                    of the function returns before seed_org_settings is
--                    invoked.
--   Money rules      Untouched.
--
-- Root cause: provision_organization (0002) transitions a new org to 'active'
-- but never seeds org_feature_flags. The first request through the SPA hits
-- bundle gates that read org_feature_flags, finds nothing, returns false,
-- and renders an empty workspace (Wave 6 chassis Phase 6 symptom).
--
-- Fix: after the status transition, invoke public.seed_org_settings(v_org_id)
-- so every newly provisioned org ships with the 10 canonical flag rows in
-- their default (disabled) state. Operator-controlled flips remain operator
-- territory; this just guarantees the rows exist for the gate reader.
-- ============================================================================

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

  -- Self-heal forward path: ensure the new org carries the canonical
  -- feature-flag rows so bundle gates and per-route flag reads find them.
  -- Idempotent via ON CONFLICT DO NOTHING inside seed_org_settings.
  perform public.seed_org_settings(v_org_id);

  return v_org_id;
end;
$$;

-- GRANT/REVOKE unchanged from migration 0002; the signature is identical so
-- the existing privileges still apply. Re-asserting here for clarity in case
-- a future operator-only down-migration drops and recreates.
revoke execute on function public.provision_organization(text, text, uuid, text)
  from public, anon, authenticated;
grant  execute on function public.provision_organization(text, text, uuid, text)
  to service_role;
