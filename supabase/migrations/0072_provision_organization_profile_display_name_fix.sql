-- ============================================================================
-- Migration: 0072_provision_organization_profile_display_name_fix.sql
-- Wave: 9
-- Phase: Cowork smoke-fix wave
-- Closes: F-Wave9-COWORK-SMOKE-08
-- Date: 2026-05-27
--
-- Background:
--   Cowork verified on prod 2026-05-26 that the /admin/members Name column
--   renders the organization's display_name instead of the member's own name
--   for the org owner. Root cause: provision_organization() seeds the
--   owner's profile row with profiles.display_name = p_display_name, but
--   p_display_name is the org's display_name (e.g. "Acme Logistics"). The
--   downstream GET /auth-api/members handler projects profiles.display_name
--   straight into OrgMemberRow.display_name; the SPA renders
--   display_name ?? email and therefore shows the org name in the Name
--   column. (Invited teammates seeded later via create_staff_membership are
--   not affected because that path leaves profiles.display_name NULL and
--   the SPA falls back to email.)
--
--   This migration fixes the seed so a newly provisioned owner lands with
--   profiles.display_name = NULL (the operator sets their own display name
--   from /admin/profile once they are in), AND backfills every existing
--   owner profile whose display_name equals their org's display_name back
--   to NULL so the bug clears on prod without operator intervention.
--
-- DOWN MIGRATION (operator-only; not auto-run):
--   -- Restore the 0069 body of provision_organization (re-add the
--   -- p_display_name argument to the profiles INSERT). Copy the body
--   -- verbatim from 0069_provision_organization_claim_stamp.sql.
--   --
--   -- The backfill UPDATE at the bottom of this migration is one-way
--   -- (NULLs cannot be reversed without a snapshot of the prior values).
--   -- No down-path exists; rolling back would require operator review of
--   -- which owners actually want their org's display_name surfaced as
--   -- their personal display name in the members list.
--
-- Constitutional alignment:
--   Money rules        Untouched. No _cents column added.
--   RLS rules          provision_organization remains SECURITY DEFINER and
--                      service_role-only (REVOKE / GRANT preserved). No RLS
--                      policy change. The backfill UPDATE runs at migration
--                      time as the superuser applying the migration; RLS
--                      does not gate DDL-time data fixes.
--   Audit rules        public.profiles does not have an audit_log trigger
--                      (identity-layer table; same posture as
--                      0057 / 0069 raw_app_meta_data writes). No
--                      audit_log entry is expected for the backfill.
--   Migration rules    Forward-only. CREATE OR REPLACE FUNCTION is
--                      idempotent. The backfill UPDATE is idempotent: once
--                      profiles.display_name is NULL it can no longer
--                      match an org's display_name, so re-running is a
--                      no-op.
--   Idempotency        Re-provisioning an existing org short-circuits at
--                      the slug lookup before the profiles INSERT fires,
--                      so the change to the INSERT clause only affects
--                      first provisioning. The backfill scope is bounded
--                      (one row per current owner whose display_name still
--                      matches the org's display_name).
--
--   Why the SPA does not need a parallel change: GET /auth-api/members
--   already projects display_name as nullable, and MembersPage already
--   renders `row.display_name ?? row.email` for the Name cell. Returning
--   NULL therefore engages the existing email fallback. A defensive SPA
--   helper memberDisplayLabel(row) adds a UUID-slice fallback for the
--   degenerate case where both display_name and email are blank.
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

  -- profiles.display_name is the PERSON's display name, not the org's. The
  -- owner sets their own from /admin/profile once they are in. Seeding it
  -- with the org's display_name surfaced the org name in /admin/members
  -- Name column (F-Wave9-COWORK-SMOKE-08). Leave NULL; the SPA falls back
  -- to email via row.display_name ?? row.email.
  insert into public.profiles (user_id, email, display_name, is_active)
  values (p_owner_user_id, p_owner_email, null, true)
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

  -- ----- 0064 additions: complete the new-org seed surface ------------------

  perform public.seed_org_settings(v_org_id);
  perform public.seed_org_numbering(v_org_id);
  perform public.seed_org_chart_of_accounts(v_org_id);
  perform public.seed_org_default_warehouse(v_org_id);

  -- ----- 0069 addition: stamp owner JWT claims ------------------------------

  update auth.users
     set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) ||
       jsonb_build_object(
         'kitstak_org_id', v_org_id::text,
         'kitstak_org_role', 'org_owner'
       )
   where id = p_owner_user_id;

  return v_org_id;
end;
$$;

revoke execute on function public.provision_organization(text, text, uuid, text)
  from public, anon, authenticated;
grant  execute on function public.provision_organization(text, text, uuid, text)
  to service_role;

comment on function public.provision_organization(text, text, uuid, text) is
  'Atomic org provisioning. Seeds org row, owner profile (display_name NULL; the owner sets their personal display name from /admin/profile), owner membership, branding, feature flags, numbering sequences, chart of accounts, default warehouse, AND stamps kitstak_org_id + kitstak_org_role onto the owner''s auth.users.raw_app_meta_data so the next-minted JWT carries the org claim. Idempotent via slug short-circuit. service_role only.';

-- ---------------------------------------------------------------------------
-- Backfill: for every existing owner profile whose display_name equals the
-- display_name of the org they own, clear display_name to NULL so the
-- /admin/members Name column falls back to email instead of rendering the
-- org name (F-Wave9-COWORK-SMOKE-08).
--
-- Scope is tight: only profiles belonging to a user who holds an active
-- org_owner membership in an organization whose display_name matches the
-- profile's display_name. A user who has manually set a display_name that
-- happens to equal their org's display_name will be re-NULLed (acceptable
-- false positive; they can re-set it from /admin/profile). Members who
-- were invited via create_staff_membership are not in scope because
-- create_staff_membership leaves profiles.display_name NULL.
--
-- Idempotent: once display_name is NULL the WHERE clause no longer matches,
-- so re-running is a no-op.
-- ---------------------------------------------------------------------------

do $$
declare
  v_count integer;
begin
  with affected as (
    select p.user_id
      from public.profiles p
      join public.org_memberships m on m.user_id = p.user_id and m.is_active = true
      join public.roles r           on r.id      = m.role_id and r.code      = 'org_owner'
      join public.organizations o   on o.id      = m.org_id
     where p.display_name is not null
       and p.display_name = o.display_name
  )
  update public.profiles
     set display_name = null
   where user_id in (select user_id from affected);

  get diagnostics v_count = row_count;
  raise notice '0072 backfill: cleared profiles.display_name on % owner row(s) where it matched the org display_name', v_count;
end$$;
