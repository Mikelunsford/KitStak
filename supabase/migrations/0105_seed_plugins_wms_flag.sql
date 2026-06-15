-- ============================================================================
-- Migration: 0105_seed_plugins_wms_flag.sql
-- Wave: 12
-- Phase: B0 (WMS chassis)
-- Closes: F-Wave12-WMS-B0-01 (per 03-workspace/specs/2026-06-14-wms-bodyb-phase1-handoff.md
--         section "B0. WMS chassis", item 8)
-- Date: 2026-06-15
--
-- DOWN MIGRATION (operator-only; not auto-run):
--   -- 1) Restore the 0064 body of seed_org_settings (the 10-flag version
--   --    WITHOUT 'plugins.wms' in the v_flags array). Operator copies the
--   --    body from migration 0064 verbatim.
--   -- 2) delete from public.org_feature_flags where flag_key = 'plugins.wms';
--   -- The backfill loop has no automatic down-migration: the rows it created
--   -- are idempotent ON CONFLICT DO NOTHING inserts, so the manual delete in
--   -- step 2 is the rollback.
--
-- Constitutional alignment:
--   Money rules        Untouched. No _cents column added.
--   RLS rules          Untouched. seed_org_settings is SECURITY DEFINER and
--                      grant-controlled to service_role only. The seeded
--                      plugins.wms row inherits Pattern A from its parent
--                      table (org_feature_flags), exactly like the other ten
--                      canonical flags.
--   Audit rules        Untouched. No audit_log DDL. seed_org_settings writes
--                      metadata rows that do not have audit triggers installed
--                      (same posture as the other flag seeds).
--   Idempotency        Untouched. CREATE OR REPLACE FUNCTION is idempotent.
--                      The flag insert uses ON CONFLICT (org_id, flag_key) DO
--                      NOTHING, and the backfill DO block re-runs seed_org_settings
--                      per org, so re-applying produces no duplicate rows.
--   Migration rules    Forward-only. CREATE OR REPLACE FUNCTION is idempotent.
--                      The backfill DO block is idempotent via the seed
--                      function's ON CONFLICT DO NOTHING insert.
--
-- Purpose: WMS is add-on number six (ADR 0002). Its bundle gate, SPA route
-- guard, and sidebar section read the plugins.wms feature flag. This migration
-- adds 'plugins.wms' to the canonical flag set that seed_org_settings seeds at
-- provisioning time, so every newly provisioned org gets a plugins.wms row
-- seeded DISABLED (is_enabled = false; WMS is a paid add-on, off until an
-- operator flips it on via /admin/flags). A backfill loop brings every
-- existing org to parity.
--
-- provision_organization (latest definition 0072) delegates to
-- seed_org_settings and needs no change. seed_org_settings is the latest
-- redefinition as of 0064 (confirmed 2026-06-15: no migration between 0065 and
-- 0104 redefines it). This migration restates the WHOLE 0064 body with only
-- 'plugins.wms' appended to the v_flags array; no other flag is dropped or
-- reordered. The flag-string canon lives in TS at
-- supabase/functions/_shared/constants.ts and apps/web/src/lib/constants.ts
-- (FEATURE_FLAGS.PLUGINS_WMS = 'plugins.wms'); SQL cannot import from TS, so
-- this inline string is the SQL-side mirror.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Extend seed_org_settings: append 'plugins.wms' to the canonical flag set.
--
--    The body is the 0064 version verbatim with one new entry appended to the
--    v_flags array. The loop inserts each flag is_enabled = false ON CONFLICT
--    (org_id, flag_key) DO NOTHING, so plugins.wms seeds OFF and re-running is
--    a no-op for orgs that already carry the row.
-- ---------------------------------------------------------------------------

create or replace function public.seed_org_settings(p_org_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inserted integer := 0;
  v_flag text;
  v_flags text[] := array[
    'plugins.three_pl',
    'plugins.manufacturing',
    'plugins.copack_ecom',
    'plugins.kitforce',
    'plugins.kitcost',
    'plugins.wms',
    'feature.collaboration',
    'feature.global_search',
    'feature.imports',
    'feature.exports',
    'feature.customer_portal'
  ];
begin
  if p_org_id is null then
    raise exception 'VALIDATION_ERROR: p_org_id is required' using errcode = '22023';
  end if;

  foreach v_flag in array v_flags loop
    insert into public.org_feature_flags (org_id, flag_key, is_enabled, config)
    values (p_org_id, v_flag, false, '{}'::jsonb)
    on conflict (org_id, flag_key) do nothing;
    if found then
      v_inserted := v_inserted + 1;
    end if;
  end loop;

  -- Note: the prior body in 0040 attempted to insert into org_settings here,
  -- but the table's (org_id, group_key, setting_key) PK with NOT NULL on all
  -- three columns made the insert fail. The error was swallowed by a
  -- `when others then null` block. Removed in 0064 because the branch was
  -- dead code. A future seed_org_settings_keys(p_org_id) function can ship
  -- the canonical (group_key, setting_key, value) defaults when the product
  -- needs them; today no consumer reads org_settings on a virgin org.

  return v_inserted;
end;
$$;

revoke execute on function public.seed_org_settings(uuid)
  from public, anon, authenticated;
grant execute on function public.seed_org_settings(uuid)
  to service_role;

comment on function public.seed_org_settings(uuid) is
  'Seeds default org_feature_flags (11 canonical flags, all disabled). Idempotent. Called by provision_organization.';

-- ---------------------------------------------------------------------------
-- 2) Backfill: for every existing organization, re-run seed_org_settings so
--    each org gets the new plugins.wms = false row. Idempotent via the seed
--    function's ON CONFLICT DO NOTHING insert; orgs that already carry the
--    other ten flags are unaffected and only the new plugins.wms row is added.
-- ---------------------------------------------------------------------------

do $$
declare
  v_org_id uuid;
begin
  for v_org_id in
    select id from public.organizations
  loop
    perform public.seed_org_settings(v_org_id);
  end loop;
end$$;
