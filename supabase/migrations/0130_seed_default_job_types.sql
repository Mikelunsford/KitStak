-- ============================================================================
-- Migration: 0130_seed_default_job_types.sql
-- Wave: Quote flow follow-ups (2026-06-23 operator walkthrough)
-- Phase: P1-4 Seed default job types
-- Closes: P1-4 (the Job Type dropdown on a quote showed only "None" and the
--   Apply Template picker was empty, so the Job Builder engine looked broken).
--   The engine was built (useJobTypes, jobTypesService, jobTemplatesService,
--   ApplyTemplatePanel, the 0094 convert-time snapshot) and the template
--   authoring UI is already routed and in the sidebar
--   (/3pl-operations/job-builders). The only gap was data: no org had any job
--   types seeded. This seeds the six add-ons in order for every org and wires
--   the same seed into provisioning so new orgs get them too.
-- Date: 2026-06-23
--
-- DOWN MIGRATION (operator-only; forward-only repo, do not auto-apply):
--   -- 1) Restore the 0072 body of provision_organization (drop the
--   --    seed_org_default_job_types call). Copy the body verbatim from
--   --    0072_provision_organization_profile_display_name_fix.sql.
--   -- 2) drop function if exists public.seed_org_default_job_types(uuid);
--   -- The seeded job_types rows are operator data; removing them is a
--   -- deliberate per-org decision, not a migration rollback step.
--
-- Constitutional alignment:
--   Money rules        Untouched. job_types carries no _cents column.
--   RLS rules          job_types keeps its 0013 Pattern A policies, unchanged.
--                      seed_org_default_job_types is SECURITY DEFINER with
--                      SET search_path = public and writes rows for the passed
--                      org_id only; provision_organization stays SECURITY
--                      DEFINER and service_role-only (REVOKE / GRANT preserved).
--   Audit rules        Untouched. job_types has no audit_log trigger (reference
--                      catalog, same posture as taxes / payment_methods), so the
--                      seed writes no audit rows, consistent with the rest of the
--                      new-org seed surface.
--   Idempotency        The seed inserts with ON CONFLICT (org_id, code) DO
--                      NOTHING, so re-running (or an org that already authored a
--                      job type with one of these codes) is a no-op for the
--                      existing rows and only fills the missing ones. The
--                      backfill loop is therefore safe to re-run.
--   Migration rules    Forward-only. CREATE OR REPLACE FUNCTION is idempotent;
--                      the backfill is idempotent via ON CONFLICT.
--   Capabilities       Untouched. Authoring job types / templates stays on the
--                      existing job_types / job_templates write policies.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Idempotent per-org seed of the six add-ons in order (3PL Operations,
--    Manufacturing, Co-Pack and Ecom, KitForce, KitCost, WMS). Mirrors the
--    seed_org_* helper shape (0064) that provision_organization already calls.
--    ON CONFLICT on the (org_id, code) unique key keeps it non-destructive: an
--    org that already authored a job type with one of these codes is untouched.
-- ---------------------------------------------------------------------------

create or replace function public.seed_org_default_job_types(p_org_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.job_types (org_id, code, name, sort_order)
  values
    (p_org_id, '3PL',      '3PL Operations',   0),
    (p_org_id, 'MFG',      'Manufacturing',    1),
    (p_org_id, 'COPACK',   'Co-Pack and Ecom', 2),
    (p_org_id, 'KITFORCE', 'KitForce',         3),
    (p_org_id, 'KITCOST',  'KitCost',          4),
    (p_org_id, 'WMS',      'WMS',              5)
  on conflict (org_id, code) do nothing;
end;
$$;

revoke execute on function public.seed_org_default_job_types(uuid)
  from public, anon;
grant execute on function public.seed_org_default_job_types(uuid)
  to service_role;

comment on function public.seed_org_default_job_types(uuid) is
  'Idempotent per-org seed of the six default job types (the spine add-ons in order). Called by provision_organization for new orgs and by the 0130 backfill for existing ones. ON CONFLICT (org_id, code) DO NOTHING so it never overwrites an operator-authored job type.';

-- ---------------------------------------------------------------------------
-- 2) Redefine provision_organization (last defined in 0072) to also seed the
--    default job types for a new org. The body is the 0072 body verbatim except
--    for the single added perform call in the 0064 seed block.
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
  -- 0130 addition: seed the six default job types so the quote Job Type
  -- dropdown and the Job Builder are populated on day one.
  perform public.seed_org_default_job_types(v_org_id);

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
  'Atomic org provisioning. Seeds org row, owner profile (display_name NULL; the owner sets their personal display name from /admin/profile), owner membership, branding, feature flags, numbering sequences, chart of accounts, default warehouse, default job types, AND stamps kitstak_org_id + kitstak_org_role onto the owner''s auth.users.raw_app_meta_data so the next-minted JWT carries the org claim. Idempotent via slug short-circuit. service_role only.';

-- ---------------------------------------------------------------------------
-- 3) Backfill: seed the six default job types for every existing org. The seed
--    is idempotent (ON CONFLICT (org_id, code) DO NOTHING), so orgs that
--    already authored a job type with one of these codes keep theirs and only
--    receive the missing ones.
-- ---------------------------------------------------------------------------

do $$
declare
  r record;
  v_count integer := 0;
begin
  for r in select id from public.organizations loop
    perform public.seed_org_default_job_types(r.id);
    v_count := v_count + 1;
  end loop;
  raise notice '0130 backfill: ensured the six default job types on % org(s)', v_count;
end$$;
