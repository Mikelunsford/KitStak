# Kitstak Status

Last updated: 2026-05-18

## Current state

**Wave 5 probes closed at 48 / 48 green on staging (PR #9 + PR #10 merged · commits `32d7acd` and `ebe8f5d`).** Phase 4 (marketing site) skipped at operator direction (built in parallel outside this session). Phase 5 shipped the 48-probe RLS matrix; the matrix's first real run surfaced six constitutional violations which the same phase resolved via four hotfixes: Node 22 in the probe workflow (native WebSocket), staging branch rebase to apply 37 Wave 2 migrations, probe seed schema corrections, and the substantive 403→404 fixes (quotes-api / projects-api side-car capability shims, admin-console-api `verify_jwt = false`, and forward migration `0041` redefining `convert_quote_to_project` to take `p_caller_org_id` explicitly). Final probe run: 48 / 48 in 31s. Sentry and analytics remain deferred per operator.

**Wave 3 integration shipped (PR #8 merged · commit `209c106`).** AuditTimeline mounted on every state-having detail page (13 total); Sidebar live `useOrgFlags()`; global `ErrorBoundary`; NotFoundPage dual-import Vite warning fixed; `apps/web/playwright.config.ts` plus smoke + rls-probe scaffolds.

**Wave 2 domain ports shipped (PR #4 merged · commit `e1dd9ba`).** Pillar 1 (3PL Operations) is lit at the schema, API, and SPA layers. Pillars 2-3 (Manufacturing, Co-Pack and Ecom) are plumbed (schemas plus edge function bundles, feature-flag-gated off). 41 forward-only migrations now applied at the remote (Postgres 17.6.1.121, GA channel, region `us-west-1`).

### Migrations applied (40 slots used, 0005 and 0006 intentionally empty)

`0001_foundation`, `0002_identity_branding_provisioning`, `0003_fix_audit_search_path`, `0004_identity_extensions`, `0007` to `0010` (CRM), `0011` to `0017` (sales chassis, quoting, projects), `0018` to `0024` (invoicing, payments, finance), `0025` to `0033` (vendors, inventory, ops), `0034` to `0040` (cross-cutting, audit trigger coverage, attachments view, org settings seed).

### Edge function bundles deployed and scheduled

- **Wave 1 (scheduled)**: `audit-chain-verify`, `idempotency-gc`.
- **Wave 2 (HTTP API)**: `auth-api`, `tenants-api` (`verify_jwt=false` for the public `resolve-host` route), `settings-api`, `admin-console-api` (bundle-gated on `platform_admin.enabled`), `crm-api`, `sales-config-api`, `quotes-api`, `projects-api`, `invoicing-api`, `finance-api`, `vendors-api`, `inventory-api`, `ops-api` (bundle-gated on `plugins.3pl`), `collaboration-api`, `search-api`, `customer-portal-api`, `dashboard-api`, `exports-api`, `imports-api`, `notifications-worker` (`verify_jwt=false`, X-Worker-Secret), `pdf-worker` (501 stub pending operator-approved JS PDF dep).

### Side-car canon

`_shared/{types,workflow,capabilities}/<domain>.ts` paired with `apps/web/src/lib/{types,workflow,capabilities}/<domain>.ts` for six domains: identity, crm, sales, finance, vendors_inventory_ops, cross_cutting. `parity.test.ts` asserts 22 byte-identical pairs (4 singular plus 18 side-cars). `_shared/workflow/cross_cutting.ts` aggregates all 14 state machines into `ALL_STATE_MACHINES`. The singular byte-mirrored files (`types.ts`, `workflow.ts`, `capabilities.ts`, `money.ts`) carry the foundation only and are unchanged since Wave 1.

### SPA surface

67 routes in the flat `RouteSpec[]` table, marker-bounded per agent. Three-gate auth taxonomy (`ProtectedRoute`, `AdminProtectedRoute`, `PortalRoute`). AppShell + Sidebar (five-pillar IA in canonical order) + Topbar + RequireFlag + AuditTimeline. Pages under `pages/admin/`, `pages/crm/`, `pages/3pl-operations/<domain>/`, `pages/finance/`, `pages/portal/`, `pages/search/`, `pages/dashboard/`, `pages/imports/`, `pages/exports/`. Bundle size: **25.55 kB gzip** against the 40 kB cap.

### Gates verified at Wave 2 close

- `pnpm typecheck` zero errors.
- `pnpm lint` zero errors, zero warnings.
- `pnpm test` 5 of 5.
- `pnpm test:contract` 25 of 25.
- `pnpm build` succeeds.
- `pnpm bundle-budget` 25.55 kB / 40 kB.
- Brand validation greps: zero user-facing violations.
- TS1 read-only zone untouched.

### Wave 2 second hotfix (PR #6, merged · commit `1cfdcf6`)

PR #5's hotfix unblocked the pooler connection and CLI version. The next `deploy-functions` run advanced past those errors and deployed the first two bundles (`audit-chain-verify`, `idempotency-gc`), then failed on `auth-api` with `Relative import path "zod" not prefixed with / or ./ or ../`. The Supabase Preview check on the same SHA failed the same way. Root cause: all 6 side-car type files use bare `from 'zod'`, which the SPA resolves via `node_modules` but Deno cannot resolve without an import map. Fix: `supabase/functions/deno.json` ships a workspace import map (`"zod": "npm:zod@3.23.8"`) and the deploy workflow passes `--import-map` explicitly. No canon files touched; byte-mirror parity intact (`test:contract` 25 / 25).

After this hotfix merged, all 3 post-merge workflows turned green (`ci`, `deploy-functions`, `deploy-prod`). All 23 edge function bundles deployed successfully per the deploy log.

### Wave 2 first hotfix (PR #5, merged · commit `2057391`)

Two GitHub Actions failures after PR #4 merge required a hotfix:

- `migrate.yml` used `aws-1-us-west-2.pooler.supabase.com`; the project's region is `us-west-1` and the canonical pooler hostname is `aws-0-us-west-1.pooler.supabase.com`. ENOTFOUND on the DNS lookup.
- `deploy-functions.yml` pinned the Supabase CLI at `1.180.0`, which predates Postgres 17 GA support and rejects `db.major_version = 17` in `config.toml`. The remote project IS on Postgres 17.x, so the correct fix is bumping the CLI, not lowering the config.

Both workflows now pin `supabase/setup-cli@v1` with `version: latest`. `deploy-functions.yml` BUNDLES array extended to all 23 functions (Wave 1's 2 plus Wave 2's 21). `config.toml` adds `[functions.tenants-api] verify_jwt = false` so the public host-resolver route serves pre-auth (closes `F-Wave2-AGENT-A-06`).

## Wave 3 deliverables (shipped this phase)

- Sidebar pillar gates wired to live `useOrgFlags()` (closes `F-Wave2-API-03`).
- Global `ErrorBoundary` mounted in `main.tsx` below `AuthProvider`.
- NotFoundPage Vite static-plus-dynamic chunk warning eliminated by wildcard `Navigate to="/404"` (closes `F-Wave2-BUILD-01`).
- `AuditTimeline` mounted on every state-having detail page (quotes, projects, purchase orders, vendor bills, expenses, receiving orders, production runs, shipments, leads, opportunities, in addition to the three from Wave 2: invoices, credit notes, journal entries). Heading style normalized across all 13.
- `apps/web/playwright.config.ts` plus `apps/web/playwright/{smoke,rls-probe}.spec.ts` scaffolds land. `test:e2e` and `test:rls` scripts point at the new config. Specs `test.skip` until Phase 5 wires staging Supabase secrets.

`BrandingProvider` and `Topbar.useMe` gating already shipped in Wave 2 (both call their hook with `enabled: isAuthed`); no changes needed this phase. Sentry SPA init deferred (no `VITE_SENTRY_DSN` in the operator's keys file).

## Wave 5 deliverables (shipped this phase)

- `apps/web/playwright/rls-probe.spec.ts`: 48 cross-tenant probes against a Supabase preview branch named `staging`. Bootstraps two ephemeral orgs plus one user per org, seeds one row per primary entity into org A, then probes from user B's JWT. Categories: list reads (10) and unqualified reads (2) cross-tenant return 200 + []; detail reads (6) cross-tenant return 200 + []; workflow POSTs (11) return 404 (never 403); bundle gates `plugins.three_pl` and `platform_admin.enabled` (4) return 404 when off; per-route flag `finance.journal_entries.enabled` (2) returns 403 FEATURE_DISABLED with `details.flag`; customer-portal-api Pattern B (2) rejects non-customer_user roles; Pattern C globals (3) stay readable; unauthenticated guard (3) returns 401; switch-org cross-tenant (2) returns 404 / 201; audit_log RLS (2). Tagged `@rls` so `pnpm test:rls` picks them up. Skips cleanly when staging secrets are absent.
- `apps/web/playwright/smoke.spec.ts`: hardened from URL placeholders to real `page.fill` / `page.click` / `expect(page).toHaveURL` sequences for signin, switch org, customer create, quote send + accept, convert to project, invoice send, payment post, receiving order, shipment, AuditTimeline verification. Tagged `@smoke`. Test-skips when `PLAYWRIGHT_BASE_URL` or smoke credentials are absent.
- `docs/operations/probes.md`: operator-facing runbook covering all three nightly workflows (RLS probe, audit chain verify, idempotency GC), how to read failures, how to re-run on demand, and the staging secret contract.

Sentry SPA + edge-function capture and analytics provider deferred per operator decision. Both remain follow-ups for a later wave.

## Phase 5 close (hotfixes that landed during the phase)

The probe matrix's first real run surfaced six constitutional violations the matrix was designed to catch. All resolved in the same phase, on top of three infrastructure hotfixes to unblock the probe runtime:

1. **Probe workflow on Node 22** (`9a0eaf8`). `@supabase/realtime-js@2.105+` requires native WebSocket; Node 20 lacks it. Bumped just `nightly-rls-probe.yml`'s `actions/setup-node` to Node 22. Other workflows stay on Node 20.
2. **Staging branch rebase** (no code change). The Supabase preview branch `staging` was created at migration 0003 and missed all 37 Wave 2 migrations. Rebased via the Supabase Management API; the rebase also redeploys functions from main onto staging.
3. **Probe seed schema corrections** (`fe913e6`). The probe's fixture bootstrap used several wrong column names (`name` → `display_name` on warehouses; `given_name` / `family_name` → `first_name` / `last_name` on contacts; `state` → `status` on leads / invoices / credit notes / purchase_orders / vendor_bills / expenses / journal_entries; `title` → `display_name` and `state` → `stage` on opportunities; `posted_on` → `entry_date` on journal_entries); missing required document numbers and period_year / period_month on journal entries; `amount_cents 0` on payments (CHECK > 0).
4. **Constitutional 403→404 / 401→404 fixes** (`ae02e8c`). Two patterns:
   - Quotes-api and projects-api imported `requireCap` from the singular handler-helpers, which only knows the 14 `org.*` capabilities. Every `quotes.*` / `projects.*` cap check returned `FORBIDDEN`. Fix: per-bundle `_helpers.ts` with `requireSalesCap` wrapping the side-car `SALES_CAPABILITIES_BY_ROLE`, mirroring the invoicing-api pattern. The singular byte-mirrored `_shared/capabilities.ts` was not touched.
   - Admin-console-api had `verify_jwt = true` so the Supabase gateway returned 401 to anonymous callers before the handler could throw its 404. Fix: `[functions.admin-console-api] verify_jwt = false` in `config.toml` (handler already correctly returns 404 for anonymous).
5. **Forward migration `0041`** (`ebe8f5d`). The probe still saw 409 STATE_CONFLICT cross-tenant on `quotes-api convert-to-project`. Root cause: `convert_quote_to_project` checked `v_org_id <> public.current_org_id()`, but the handler invokes the RPC via the service-role client, which has no JWT claim. `current_org_id()` returned NULL; the comparison evaluated to NULL (treated as false); the cross-tenant guard never fired; the next check (`state != 'approved'`) won. Fix: drop the 3-arg RPC, recreate as 4-arg taking `p_caller_org_id`, surface mismatch as `NOT_FOUND`. Handler passes `caller.orgId`. Forward-only; idempotent.

**Final probe run on commit `ebe8f5d`**: 48 / 48 passed in 31s.

## Phase 5 open follow-ups

- **F-Wave5-TEST-02**: dry-run smoke selectors against live staging once Phase 6 starts exercising the full SPA workflow.
- **F-Wave5-INFRA-01**: `migrate.yml` failed against the production-db pooler with "Tenant or user not found" while applying 0041. The Supabase GH integration's auto-apply unblocked this specific deploy (0041 is in the prod migration table). The pooler connection string in `migrate.yml` and / or the `SUPABASE_DB_PASSWORD` / `SUPABASE_PROJECT_REF` secrets need a check-in before the workflow can be relied on for future schema changes. The orchestrator updated `SUPABASE_DB_PASSWORD` from the keys file's rotated value during the phase; the failure may be a pooler-username format issue (`postgres.<ref>` user encoding).
- **F-Wave3-OBS-01**: Sentry SPA + edge-function capture, blocked on `VITE_SENTRY_DSN`.
- **F-Wave2-AGENT-A-05** (carried): operator-gated merge of domain side-car capabilities into the master byte-mirrored `_shared/capabilities.ts`. The per-bundle shim pattern now lives in invoicing-api, quotes-api, and projects-api as the supported interim.

## Wave 6 scope (next phase, awaiting operator go)

Customer Zero cutover. Operator exercises the full Pillar-1 workflow on prod against the seeded `kitstak` org from Wave 1: create a customer, run a quote-to-cash flow end-to-end, generate the audit chain, verify period close. Surfaces any small gaps (missing copy, missing buttons, capability-gate corrections) for inline fixes.

## Open risks

None open at Wave 2 close. The 10 Wave 2 follow-ups (`F-Wave2-*`) are tracked in `03-workspace/journal/wave-2-domain-ports.md`. The two operator-gated decisions are:

- `F-Wave2-CO-01`: pdf-worker render endpoint needs an operator-approved JS PDF dep (`pdfkit` or `jsPDF`, both BSD).
- `F-Wave2-DNDKIT-01`: `dnd-kit` is referenced by `00-canon/01-architecture.md` but is not in `apps/web/package.json`. Phase reorder shipped as up / down buttons.
