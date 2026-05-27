-- ============================================================================
-- Migration: 0069_provision_organization_claim_stamp.sql
-- Wave: 9
-- Phase: Cowork smoke-fix wave
-- Closes: F-Wave9-COWORK-SMOKE-02
-- Date: 2026-05-27
--
-- Background:
--   Cowork verified on prod 2026-05-26 that provision_organization() seeds
--   every tenant-scoped row a fresh org needs (organizations, profiles,
--   org_memberships, org_branding, numbering, COA, default warehouse,
--   feature flags) but never stamps the org claims onto
--   auth.users.raw_app_meta_data. The first JWT minted on the owner's
--   sign-in therefore lacks kitstak_org_id and kitstak_org_role, every
--   tenant-scoped Edge endpoint returns 401 NO_ACTIVE_ORG, and the SPA
--   renders as a half-empty shell until an operator manually backfills
--   the claims via direct UPDATE on auth.users.
--
--   This is the same gap migration 0057 closed for invited portal users
--   (create_portal_membership). We close it here for the owner provisioned
--   through provision_organization by adding one inline auth.users update
--   at the end of the function, using the same jsonb merge pattern.
--
-- DOWN MIGRATION (operator-only; not auto-run):
--   -- Restore the 0064 body of provision_organization (drop the auth.users
--   -- update added at the end of this migration). Copy the body verbatim
--   -- from 0064_provision_organization_completeness.sql.
--   --
--   -- The backfill DO block at the bottom of this migration is idempotent
--   -- (jsonb `||` merge preserves any pre-existing claims) and need not be
--   -- reversed; rolling back the stamp on existing owner users would
--   -- require operator review of which orgs are still owned by their
--   -- original provision-time owner.
--
-- Constitutional alignment:
--   Money rules        Untouched. No _cents column added.
--   RLS rules          provision_organization remains SECURITY DEFINER and
--                      service_role-only (REVOKE / GRANT preserved). The
--                      function already touches auth.users transitively
--                      through Supabase auth machinery; the new direct
--                      jsonb_set / jsonb merge does NOT change RLS posture
--                      on auth.users (RLS on auth.users is managed by
--                      Supabase auth and is not enabled for the auth
--                      schema's own tables). This mirrors the pattern
--                      already shipped in 0057 for portal users.
--   Audit rules        Identity-layer raw_app_meta_data writes do not
--                      have audit_log triggers installed (same posture as
--                      0057 and the auth-api /sessions/switch-org handler
--                      that writes the same field via
--                      auth.admin.updateUserById).
--   Migration rules    Forward-only. CREATE OR REPLACE FUNCTION is
--                      idempotent. The backfill DO block at the bottom is
--                      idempotent via jsonb `||` merge (existing claims
--                      preserved).
--   Idempotency        Re-provisioning an existing org short-circuits at
--                      the slug lookup before the stamp fires, so the
--                      stamp only runs on first provision. The backfill
--                      uses jsonb merge so re-running on already-stamped
--                      users is a no-op.
--
--   Why this is safe: writes to auth.users.raw_app_meta_data do NOT
--   change a user's existing JWT-bearing sessions (those tokens are
--   already signed). They only affect NEW JWTs minted on the next
--   sign-in. So a fresh owner's first sign-in mints a JWT with the
--   claims, and backfilled existing owners pick the claims up on their
--   next session refresh without disturbing any live session.
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

  -- ----- 0064 additions: complete the new-org seed surface ------------------

  -- Feature flags (10 canonical entries, disabled). Already wired in 0043.
  perform public.seed_org_settings(v_org_id);

  -- Numbering sequences for all 11 doc types. Without this, the first
  -- next_doc_number(...) call auto-heals via a fallback insert but loses
  -- the configured prefix, pad_width, and reset_period.
  perform public.seed_org_numbering(v_org_id);

  -- 13 system chart-of-accounts rows. Required for any COA-gated finance
  -- feature.
  perform public.seed_org_chart_of_accounts(v_org_id);

  -- A single DEFAULT warehouse. HARD blocker for receiving orders,
  -- shipments, and manufacturing runs without it.
  perform public.seed_org_default_warehouse(v_org_id);

  -- ----- 0069 addition: stamp owner JWT claims ------------------------------
  --
  -- Stamp kitstak_org_id + kitstak_org_role onto the owner's
  -- auth.users.raw_app_meta_data so the next-minted JWT carries the org
  -- claim. Without this, requireCaller in every authenticated edge
  -- function returns 401 (NO_ACTIVE_ORG) and the SPA renders as a
  -- half-empty shell on the owner's first sign-in.
  --
  -- Uses jsonb `||` merge so any pre-existing claims on the row are
  -- preserved (e.g. an existing user being provisioned as the owner of
  -- a second org would have their previous claims rewritten; this is the
  -- desired behaviour since the new org is the active context after
  -- provision and matches the auth-api /sessions/switch-org semantics).
  --
  -- Mirrors the pattern in 0057_portal_membership_claim_stamp.sql for
  -- invited portal users.
  update auth.users
     set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) ||
       jsonb_build_object(
         'kitstak_org_id', v_org_id::text,
         'kitstak_org_role', 'org_owner'
       )
   where id = p_owner_user_id;

  -- --------------------------------------------------------------------------

  return v_org_id;
end;
$$;

revoke execute on function public.provision_organization(text, text, uuid, text)
  from public, anon, authenticated;
grant  execute on function public.provision_organization(text, text, uuid, text)
  to service_role;

comment on function public.provision_organization(text, text, uuid, text) is
  'Atomic org provisioning. Seeds org row, owner profile, owner membership, branding, feature flags, numbering sequences, chart of accounts, default warehouse, AND stamps kitstak_org_id + kitstak_org_role onto the owner''s auth.users.raw_app_meta_data so the next-minted JWT carries the org claim. Idempotent via slug short-circuit. service_role only.';

-- ---------------------------------------------------------------------------
-- Backfill: for every existing organization, find the org_owner membership
-- and stamp kitstak_org_id + kitstak_org_role onto that user's
-- raw_app_meta_data. Idempotent via jsonb merge; any pre-existing claims
-- are preserved. Re-running on already-stamped users is a no-op.
--
-- This closes the gap for orgs provisioned before 0069 whose owners had
-- their claims set manually (or, in the failing Cowork-smoke case, not at
-- all). The next-minted JWT for any backfilled owner will carry the
-- claims; existing JWT-bearing sessions are unaffected (already-signed
-- tokens do not re-read the row).
--
-- Loops over (org_id, owner_user_id) pairs by joining org_memberships to
-- roles on code = 'org_owner', filtered to active memberships. If an org
-- has multiple active org_owners (e.g. a co-founder promoted later), each
-- is stamped to point at this org; on multi-org owners the most recent
-- loop iteration wins, matching switch-org semantics where the active
-- context is always the most recently selected.
-- ---------------------------------------------------------------------------

do $$
declare
  v_row record;
begin
  for v_row in
    select m.org_id, m.user_id
      from public.org_memberships m
      join public.roles r on r.id = m.role_id
     where r.code = 'org_owner'
       and m.is_active = true
     order by m.joined_at
  loop
    update auth.users
       set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) ||
         jsonb_build_object(
           'kitstak_org_id', v_row.org_id::text,
           'kitstak_org_role', 'org_owner'
         )
     where id = v_row.user_id;
  end loop;
end$$;
