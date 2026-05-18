# Phase 7 Prep: seed_org_settings Backfill Proposal

Date: 2026-05-18
Status: Proposal. Operator approval required. Do not ship without decision.
Author: Phase 7 Stabilization Prep agent
Related: pitfall #19 (SESSION-CATALYST.md §10), F-Wave6-CORS-01 sibling work.

## Problem statement

Migration `0040_collab_org_settings_default_seed.sql` (Wave 2, dated 2026-05-18) introduced the `public.seed_org_settings(p_org_id uuid)` SECURITY DEFINER function that inserts the 10 canonical `org_feature_flags` rows (`plugins.three_pl`, `plugins.manufacturing`, `plugins.copack_ecom`, `plugins.kitforce`, `plugins.kitcost`, `feature.collaboration`, `feature.global_search`, `feature.imports`, `feature.exports`, `feature.customer_portal`) plus an `org_settings` row when that table exists.

`provision_organization` (defined in `0002_identity_branding_provisioning.sql`, dated 2026-05-17) does NOT call `seed_org_settings`. There is no forward call site anywhere in the migration tree. The function only runs when invoked by a service-role caller out-of-band.

Result: any organization provisioned before migration 0040 landed (or any organization provisioned after by a path that does not explicitly call `seed_org_settings`) ships with an empty `org_feature_flags` table. Pillar gates, plugin gates, and per-route feature flag gates all rely on that table; an empty table means every gate returns false and the SPA renders nothing.

The `kitstak` org (`ba4622dd-eb46-41b6-b2dd-95c922bf44dd`) is the confirmed case. Wave 6 chassis Phase 6 surfaced the symptom (Topbar "No workspace", empty Sidebar) and the operator was manually walked through a one-off `select public.seed_org_settings('ba4622dd-eb46-41b6-b2dd-95c922bf44dd')` plus the targeted `UPDATE` and `INSERT ON CONFLICT` to enable the production flags (`plugins.three_pl`, `feature.collaboration`, `feature.global_search`, `feature.imports`, `feature.exports`, `finance.journal_entries.enabled`). That fixup is in prod, not in any migration.

Scope of orgs affected today: at minimum the `kitstak` org. Without prod read access from this worktree the agent cannot enumerate other orgs. The operator should query `select id, slug, created_at from public.organizations where id not in (select org_id from public.org_feature_flags)` to confirm the population before choosing an option.

The same gap will recur on every future `provision_organization` call unless the provisioning path is patched.

## Option A: Forward-only backfill migration in slot 0042 (data-only)

Ship a one-shot data backfill that runs `seed_org_settings` for every org that has no `org_feature_flags` rows. Idempotent by virtue of `seed_org_settings`'s own `ON CONFLICT DO NOTHING`.

```sql
-- ============================================================================
-- Migration: 0042_backfill_org_settings.sql
-- Wave: 6
-- Phase: 7 prep (post Phase 6 chassis)
-- Closes: F-Wave6-DATA-01 (proposed name)
-- Date: 2026-05-18
-- DOWN MIGRATION: operator-only. Not auto-run. The seeded rows are idempotent
--   defaults; removing them would re-introduce the symptom this migration
--   fixes. Operator may UPDATE individual rows to re-disable specific flags.
--
-- Constitutional alignment:
--   Migration rules  Forward-only. Idempotent (seed_org_settings is itself
--                    idempotent via ON CONFLICT DO NOTHING).
--   RLS rules        Untouched. Migration runs as service role at apply time.
--   Audit rules      Untouched. org_feature_flags inserts are not audited
--                    today; if they ever are, the trigger handles it.
--   Money rules      Untouched.
--
-- One-shot data backfill. Closes the gap left by orgs provisioned before
-- migration 0040 shipped seed_org_settings. Does not patch provision_organization;
-- a separate forward migration should add a SELECT seed_org_settings(v_org_id)
-- call inside that RPC so future provisioning is self-healing.
-- ============================================================================

do $$
declare
  v_org record;
  v_count integer := 0;
begin
  for v_org in
    select id
      from public.organizations
     where id not in (select distinct org_id from public.org_feature_flags)
  loop
    perform public.seed_org_settings(v_org.id);
    v_count := v_count + 1;
  end loop;
  raise notice 'seed_org_settings backfill: seeded % organizations', v_count;
end$$;
```

Pros
- Single forward migration. Audit trail is the migration file.
- Idempotent. Safe to re-run (the WHERE clause excludes already-seeded orgs).
- Constitutional. No `IF NOT EXISTS` shortcuts hiding state.
- Covers every org in one shot without operator having to run ad-hoc SQL per row.

Cons
- Data migration only. Does NOT fix the forward path. The next org provisioned after this migration applies still ships with an empty flag table unless `provision_organization` is patched in a follow-up.
- The `do $$ ... $$` block writes user data at migration time. Reviewers should confirm this is acceptable for the operator's migration discipline (Wave 1 migrations are pure DDL; only the seed migrations 0038 and 0040 have data-shaped logic, and they ship functions, not row writes).

Recommended follow-up if Option A is selected: a separate forward migration (slot 0043 or later) updates `provision_organization` to call `seed_org_settings(v_org_id)` after the `update organizations set status = 'active'` step. That patch closes the forward path. Two migrations because the backfill and the provisioning patch close two different risks and benefit from separate revert points.

## Option B: Patch `provision_organization` forward, manual one-time call for the kitstak org

Replace `provision_organization` with a version that calls `seed_org_settings(v_org_id)` after the `update organizations set status = 'active'` step. No data backfill in the migration. Operator runs a one-time `select public.seed_org_settings('ba4622dd-eb46-41b6-b2dd-95c922bf44dd')` plus the production flag UPDATEs by hand (already done during Wave 6, so for the `kitstak` org this is a no-op rerun).

Pros
- Pure DDL. No data writes inside the migration. Matches the Wave 1 / Wave 2 migration discipline.
- Forward path is self-healing for every future org. No future Phase-6-style "empty workspace" surprise.
- The one-time fixup for the `kitstak` org is already in prod from Wave 6 chassis.

Cons
- Any other pre-0040 org that exists today and that the operator has not yet noticed will silently stay broken until someone runs `seed_org_settings` for it. The operator must enumerate `organizations` and run the function per-row, off the migration record.
- Operator runs untracked SQL. Tribal knowledge in the operations runbook, not in a migration.

## Recommendation

**Option A plus the Option-B provisioning patch as a follow-up migration.**

Rationale:
1. The known population today (the `kitstak` org) is small but the operator has not enumerated the full set. A data-shaped backfill closes the entire known and unknown population in one shot without operator effort and without leaving any org in an "empty flag" state.
2. Self-healing forward path matters more than migration style purity. The next provisioned org should not need a runbook entry. The Option-A backfill plus a follow-up Option-B style provisioning patch gives both: every existing org healed now, every future org self-healing.
3. The data write inside the `do $$ ... $$` block is bounded (one `seed_org_settings` call per unseeded org) and idempotent. Operator should review on receipt; it is the most constitutional shape available short of refusing to backfill, which leaves the operator on the hook for ad-hoc SQL.
4. The `kitstak` org is already seeded in prod from Wave 6 chassis. The backfill's WHERE clause excludes it (the org appears in `org_feature_flags`), so re-running the backfill against prod will be a no-op for that row. Safe to land without coordination.

Risk if Option B is chosen alone: an unknown number of pre-0040 orgs (likely zero in the operator's current tenant model, but unverified from this worktree) remain in an empty-flag state until the operator notices and runs `seed_org_settings` per-row.

Risk if neither option is chosen: the next time the operator provisions an org via `provision_organization`, the new org will reproduce the Wave 6 "empty workspace" symptom exactly. Phase 7 stabilization is the natural time to close this.

## Decision pending

Operator picks A, B, or A + Option-B follow-up. Agent does not ship migration 0042 (or any other slot) until the decision lands. Slot 0042 is reserved for this work. If Option B alone is chosen, slot 0042 ships a DDL-only `provision_organization` redefinition and the operator runs the per-org seed manually.

If approved, this proposal closes as risk ID `F-Wave6-DATA-01` (proposed) or whatever Wave 7 risk ID the operator assigns.
