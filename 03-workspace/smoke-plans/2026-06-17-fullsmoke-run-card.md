# Full-app E2E smoke, run card. 2026-06-17

Companion to the plan: [2026-06-17-full-app-e2e-smoke.md](./2026-06-17-full-app-e2e-smoke.md). This card holds the live run-specific setup. The plan is the reusable template; this is the disposable run state.

**Status**: Pre-flight GREEN. Ready for Cowork to drive.
**Run target**: `https://www.kitstak.com` (prod frontend wired to prod Supabase `zmnvwhqjahwidprnjxrq`).
**Why prod and not staging**: staging has full DB parity (migration 0119) and the complete edge-function fleet deployed, but no frontend is wired to it, so the in-browser UI/UX walkthrough has to run against the prod app. The test org below is fully isolated from the operator's live org `4e234c7d-4a1e-4764-9a4e-c275586c803e` and is cascade-deleted at teardown.

---

## Primary test org (PROD, drive this)

| Field | Value |
|---|---|
| Org id | `b5645913-f9fa-46cc-af62-932c38d619dc` |
| Org name | Full Smoke Co (Prod Test) |
| Slug | `fullsmoke_prod_20260617` |
| Owner login email | `fullsmoke+prod20260617@kitstak.test` |
| Owner password | `SmokeTest2026Kitstak!` |
| Owner user id | `3f0e53f8-2cc7-4b91-b703-9058a5a987cb` |
| Owner role | org_owner |

Disposable credential for a throwaway test org. Rotate or tear down after the run.

### Pre-flight verified on this org
- Owner JWT carries `kitstak_org_id` and `kitstak_org_role=org_owner` (live sign-in confirmed against GoTrue, token minted, claim present).
- Org status active. Owner membership role org_owner.
- Default warehouse present (1, flagged default). Chart of accounts seeded (13 rows). Numbering sequences seeded (23 doc types).
- All 12 flags enabled: the six pillar plugins (`plugins.three_pl`, `plugins.manufacturing`, `plugins.copack_ecom`, `plugins.kitforce`, `plugins.kitcost`, `plugins.wms`) plus `feature.collaboration`, `feature.global_search`, `feature.imports`, `feature.exports`, `feature.customer_portal`, `finance.journal_entries.enabled`.

Note on the gate landmine: this org has every plugin ON so the whole surface is reachable. To run the plugin-gate negative test (Phase 1.1, a gated route must 404 when its plugin is off), Cowork should temporarily disable one flag, confirm the 404, then re-enable. SQL is in the plan. `plugins.wms` and `feature.customer_portal` were UPSERTed because the seed function does not create those rows on a fresh org.

### First steps for the executor
1. Go to `https://www.kitstak.com`, sign in with the owner credentials above. Expect the dashboard, not the NO_ACTIVE_ORG surface.
2. The org is empty (only seed rows). Walk the plan phases in order; Phase 0.1 (NO_ACTIVE_ORG) and parts of Phase 0.4 (invite) need a second fresh user, mint per the plan.
3. For the cross-tenant probes (Phase 16) and the customer portal (Phase 15), provision a second test org and a `customer_user` per the plan pre-flight.

---

## Parked test org (STAGING, API-level only)

Built during pre-flight before the no-frontend constraint was confirmed. Kept available for a headless API or SQL smoke against `dnkgaufydcnedgkuoyml`. Not browser-drivable.

| Field | Value |
|---|---|
| Org id | `a3ef1a66-66d2-4b78-aa01-d30f5180151e` |
| Slug | `fullsmoke_20260617` |
| Owner login email | `fullsmoke+20260617@kitstak.test` |
| Owner password | `SmokeTest2026Staging!` |
| Owner user id | `9f0735e8-3eca-4491-ad59-efbd7daf36f4` |

Same flag and seed state as the prod org (12 flags on, default warehouse, 13 COA, 23 numbering sequences, claim stamped).

---

## Dashboards to keep open

| Purpose | URL |
|---|---|
| Supabase prod SQL editor | https://supabase.com/dashboard/project/zmnvwhqjahwidprnjxrq/sql/new |
| Supabase prod Edge logs | https://supabase.com/dashboard/project/zmnvwhqjahwidprnjxrq/logs/edge-functions |
| Vercel runtime logs | https://vercel.com/mikes-projects-5e3ecc74/kitstak/logs |
| Sentry issues | https://kitstak.sentry.io/issues/?project=4511423235751936 |

---

## Teardown (run after the smoke completes)

```sql
-- PROD (zmnvwhqjahwidprnjxrq)
delete from public.organizations where id = 'b5645913-f9fa-46cc-af62-932c38d619dc';
delete from auth.users where id = '3f0e53f8-2cc7-4b91-b703-9058a5a987cb';
-- plus any second org / customer_user minted during the run.

-- STAGING (dnkgaufydcnedgkuoyml), if not used
delete from public.organizations where id = 'a3ef1a66-66d2-4b78-aa01-d30f5180151e';
delete from auth.users where id = '9f0735e8-3eca-4491-ad59-efbd7daf36f4';
```

Leave an org in place only if a finding needs inspection; record the ids in the findings doc if so.
