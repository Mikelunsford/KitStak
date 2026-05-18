-- ============================================================================
-- Migration: 0042_backfill_org_settings.sql
-- Wave: 6
-- Phase: 6.5 (workflow integration remediation, Option A from
--        phase-7-prep-seed-backfill-proposal.md)
-- Closes: F-Wave6-DATA-01
-- Date: 2026-05-18
-- DOWN MIGRATION: operator-only. Not auto-run. The seeded rows are idempotent
--   defaults; removing them would re-introduce the empty-flag-table symptom
--   this migration closes (Wave 6 chassis "No workspace"). Operator may
--   UPDATE individual flags to re-disable them via the SPA admin surface.
--
-- Constitutional alignment:
--   Migration rules  Forward-only. Idempotent: seed_org_settings itself uses
--                    ON CONFLICT DO NOTHING per flag_key, and the WHERE clause
--                    here excludes already-seeded orgs so re-applying the
--                    migration is a no-op.
--   RLS rules        Untouched. Migration runs as service role at apply time.
--                    seed_org_settings is SECURITY DEFINER (0040).
--   Audit rules      Untouched. org_feature_flags inserts are not audited
--                    today; if they ever are, the trigger handles it.
--   Money rules      Untouched.
--
-- Closes the gap left by orgs provisioned before migration 0040 shipped
-- seed_org_settings. Operator approved Option A plus the Option B follow-up
-- (migration 0043 patches provision_organization to call seed_org_settings
-- so future provisioning is self-healing).
-- ============================================================================

do $$
declare
  v_org record;
  v_count integer := 0;
begin
  for v_org in
    select id from public.organizations
     where id not in (select distinct org_id from public.org_feature_flags)
  loop
    perform public.seed_org_settings(v_org.id);
    v_count := v_count + 1;
  end loop;
  raise notice 'seed_org_settings backfill seeded % organizations', v_count;
end$$;
