-- ============================================================================
-- Migration: 0142_seed_default_expense_categories.sql
-- Wave: 15 (build-or-delete epic, anti-strand seed)
-- Phase: Expense category seed follow-up
-- Closes: R-W15-EDIT-02 (the Expenses "Category" dropdown is permanently empty
--   on every org because expense_categories has no provisioning seed, so an
--   expense can only ever be saved uncategorized and the create/update authoring
--   hooks were never surfaced). The service + Zod type + edge routes are already
--   live; the only gap is data. This seeds a default category set for every org
--   and wires the same seed into provisioning so new orgs get it too. Mirrors
--   0130_seed_default_job_types.sql, which fixed the identical empty-dropdown
--   symptom for job types.
-- Date: 2026-06-26
--
-- DOWN MIGRATION (operator-only; forward-only repo, do not auto-apply):
--   -- 1) Restore the 0130 body of provision_organization (drop the
--   --    seed_org_default_expense_categories call). Copy the body verbatim from
--   --    0130_seed_default_job_types.sql.
--   -- 2) drop function if exists public.seed_org_default_expense_categories(uuid);
--   -- The seeded expense_categories rows are operator data; removing them is a
--   -- deliberate per-org decision, not a migration rollback step.
--
-- Constitutional alignment:
--   Money rules        Untouched. expense_categories carries no _cents column.
--   RLS rules          expense_categories keeps its 0028 Pattern A policies,
--                      unchanged. seed_org_default_expense_categories is SECURITY
--                      DEFINER with SET search_path = public and writes rows for
--                      the passed org_id only; provision_organization stays
--                      SECURITY DEFINER and service_role-only (REVOKE / GRANT
--                      preserved).
--   Audit rules        Untouched. expense_categories has no audit_log trigger
--                      (reference catalog, same posture as job_types / taxes /
--                      payment_methods), so the seed writes no audit rows.
--   Idempotency        The seed inserts with ON CONFLICT (org_id, code) DO
--                      NOTHING, so re-running (or an org that already authored a
--                      category with one of these codes) is a no-op for the
--                      existing rows and only fills the missing ones. The
--                      backfill loop is therefore safe to re-run.
--   Migration rules    Forward-only. CREATE OR REPLACE FUNCTION is idempotent;
--                      the backfill is idempotent via ON CONFLICT.
--   Capabilities       Untouched. Authoring expense categories stays on the
--                      existing expense_categories write policy.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Idempotent per-org seed of a default expense-category set for a 3PL /
--    manufacturing / fulfillment operator. Mirrors the seed_org_* helper shape
--    (0064 / 0130) that provision_organization already calls. ON CONFLICT on the
--    (org_id, code) unique key keeps it non-destructive: an org that already
--    authored a category with one of these codes is untouched. expense_categories
--    has no sort_order column, so the insert is (org_id, code, display_name) only.
-- ---------------------------------------------------------------------------

create or replace function public.seed_org_default_expense_categories(p_org_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.expense_categories (org_id, code, display_name)
  values
    (p_org_id, 'FREIGHT',            'Freight'),
    (p_org_id, 'PACKAGING',          'Packaging'),
    (p_org_id, 'WAREHOUSE_SUPPLIES', 'Warehouse Supplies'),
    (p_org_id, 'EQUIPMENT',          'Equipment'),
    (p_org_id, 'SOFTWARE',           'Software'),
    (p_org_id, 'UTILITIES',          'Utilities'),
    (p_org_id, 'LABOR',              'Labor'),
    (p_org_id, 'OTHER',              'Other')
  on conflict (org_id, code) do nothing;
end;
$$;

revoke execute on function public.seed_org_default_expense_categories(uuid)
  from public, anon;
grant execute on function public.seed_org_default_expense_categories(uuid)
  to service_role;

comment on function public.seed_org_default_expense_categories(uuid) is
  'Idempotent per-org seed of the default expense categories. Called by provision_organization for new orgs and by the 0142 backfill for existing ones. ON CONFLICT (org_id, code) DO NOTHING so it never overwrites an operator-authored category.';

-- ---------------------------------------------------------------------------
-- 2) Redefine provision_organization (last defined in 0130) to also seed the
--    default expense categories for a new org. The body is the 0130 body verbatim
--    except for the single added perform call in the 0064 seed block.
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
  -- 0142 addition: seed the default expense categories so the Expenses
  -- category dropdown is populated on day one.
  perform public.seed_org_default_expense_categories(v_org_id);

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
  'Atomic org provisioning. Seeds org row, owner profile (display_name NULL; the owner sets their personal display name from /admin/profile), owner membership, branding, feature flags, numbering sequences, chart of accounts, default warehouse, default job types, default expense categories, AND stamps kitstak_org_id + kitstak_org_role onto the owner''s auth.users.raw_app_meta_data so the next-minted JWT carries the org claim. Idempotent via slug short-circuit. service_role only.';

-- ---------------------------------------------------------------------------
-- 3) Backfill: seed the default expense categories for every existing org. The
--    seed is idempotent (ON CONFLICT (org_id, code) DO NOTHING), so orgs that
--    already authored a category with one of these codes keep theirs and only
--    receive the missing ones.
-- ---------------------------------------------------------------------------

do $$
declare
  r record;
  v_count integer := 0;
begin
  for r in select id from public.organizations loop
    perform public.seed_org_default_expense_categories(r.id);
    v_count := v_count + 1;
  end loop;
  raise notice '0142 backfill: ensured the default expense categories on % org(s)', v_count;
end$$;
