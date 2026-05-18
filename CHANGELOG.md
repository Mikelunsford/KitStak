# Kitstak Changelog

All notable changes to Kitstak are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.5.1] · Wave 5 Hotfix 5: migrate.yml pooler hostname (F-Wave5-INFRA-01)

### Fixed
- `.github/workflows/migrate.yml` pooler hostname corrected from `aws-0-us-west-1.pooler.supabase.com` to `aws-1-us-west-1.pooler.supabase.com`. Wave 2 hotfix 1 (PR #5) fixed the region tail (`us-west-2` -> `us-west-1`) but the prefix change to `aws-0` was based on Supabase docs at the time. The authoritative pooler host per the Supabase Management API (`GET /v1/projects/<ref>/config/database/pooler`) is `aws-1-us-west-1.pooler.supabase.com`. The `aws-0` prefix DNS-resolves but routes to a different tenant pool, returning `FATAL: Tenant or user not found (SQLSTATE XX000)` on every connection attempt.
- The Supabase GitHub integration's auto-apply path (used by Preview branches) bypasses the pooler and uses the Management API, so this bug was masked through Phase 4 and only surfaced when Phase 5's probe matrix triggered the formal `migrate.yml` path on prod.
- Verified post-fix via `workflow_dispatch` (run 26057079796): `Connecting to remote database... Remote database is up to date. ✓`

### Status
- Migration count holds at 41 applied (slots 0001 - 0041; 0005 / 0006 intentionally empty). No migration changes.

## [0.5.0] · Wave 5 Probes and Observability

### Added
- `apps/web/playwright/rls-probe.spec.ts` (895+ lines, 48 `@rls`-tagged tests). Bootstraps two ephemeral orgs plus one user per org via `supabase.auth.admin.createUser` and `auth.admin.updateUserById` (stamps `kitstak_org_id` / `kitstak_org_role` onto `app_metadata`), then signs in to mint a real JWT. `test.afterAll` tears down via service-role, best-effort and idempotent. Skips at module level when any of `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` is absent.
  - Categories: list reads (10) and unqualified reads (2) cross-tenant return 200 + []; detail reads (6) cross-tenant return 200 + []; workflow POSTs (11) return 404 (never 403); bundle gates `plugins.three_pl` and `platform_admin.enabled` (4) return 404 when off; per-route flag `finance.journal_entries.enabled` (2) returns 403 FEATURE_DISABLED with `details.flag`; customer-portal-api Pattern B (2) rejects non-customer_user; Pattern C globals (3) stay readable; unauthenticated guard (3) returns 401; switch-org cross-tenant (2) returns 404 / 201; audit_log RLS (2).
- `apps/web/playwright/smoke.spec.ts`: hardened from URL placeholders to real `page.fill` / `page.click` / `expect(page).toHaveURL` sequences for the full Pillar-1 quote-to-cash flow plus AuditTimeline verification.
- `docs/operations/probes.md`: operator-facing runbook covering the three nightly workflows (RLS probe, audit chain verify, idempotency GC), failure triage, manual re-run via `workflow_dispatch`, and the staging secret contract per D-009.
- `supabase/functions/quotes-api/_helpers.ts` and `supabase/functions/projects-api/_helpers.ts`: per-bundle `requireSalesCap` shims wrapping the side-car `SALES_CAPABILITIES_BY_ROLE`. Matches the established invoicing-api `_helpers.ts` pattern. The singular byte-mirrored `_shared/capabilities.ts` is unchanged.

### Fixed (constitutional violations surfaced by the probe matrix on first run)
- **F-Wave5-API-01** (quotes-api): every transition handler (send / approve / convert / update) returned 403 cross-tenant because it imported `requireCap` from the singular handler-helpers, which only knows the 14 `org.*` capabilities. Fix: switch to the new per-bundle `requireSalesCap` shim.
- **F-Wave5-API-02** (projects-api): same pattern, same fix.
- **F-Wave5-API-03** (admin-console-api): anonymous callers got 401 from the platform gateway before the handler's 404 could fire. Fix: `[functions.admin-console-api] verify_jwt = false` in `supabase/config.toml`, matching the tenants-api pattern. The handler's existing `assertBundleEnabled` already returns 404 for anonymous.
- **F-Wave5-API-04** (`convert_quote_to_project` RPC): the cross-tenant guard used `public.current_org_id()` which returns NULL under the service-role client, so the check `v_org_id <> NULL` evaluated to NULL in three-valued SQL logic and the guard silently no-opped. The next check (`state != 'approved'`) won and the caller saw 409 STATE_CONFLICT for a quote in another tenant.

### Migration
- `0041_fix_convert_quote_to_project_cross_tenant.sql`: drops the 3-arg form of `convert_quote_to_project`; recreates as a 4-arg form taking `p_caller_org_id uuid` explicitly. Merges the missing-quote and cross-tenant branches into one `NOT_FOUND` raise. Forward-only, idempotent.

### Workflow hotfix
- `.github/workflows/nightly-rls-probe.yml`: `actions/setup-node` bumped to Node 22. `@supabase/realtime-js@2.105+` requires native WebSocket support, which Node 22 ships but Node 20 lacks. Other workflows stay on Node 20 because they do not use the supabase-js client at runtime.

### Not changed
- 22 byte-identical canon pairs intact (`pnpm test:contract` 25 / 25).
- 14 state machines, 8 roles, ~120 capabilities, money cents end-to-end, audit hash chain, JWT claim shape all unchanged.
- Bundle size: 25.94 kB gzip against the 40 kB cap.

### Final state
- RLS probe matrix: 48 / 48 passed in 31s on staging post-PR-10.
- Three nightly workflows wired: `nightly-rls-probe` (09:00 UTC), `audit-chain-verify`, `idempotency-gc`.
- `staging` GitHub Actions environment configured with `STAGING_SUPABASE_URL`, `STAGING_SUPABASE_ANON_KEY`, `STAGING_SUPABASE_SERVICE_ROLE_KEY` (sourced from the Supabase preview branch named `staging` per D-009).

## [0.3.0] · Wave 3 Integration

### Added
- `apps/web/src/lib/hooks/useOrgFlags.ts`: wraps `useFlags()` and reduces `OrgFeatureFlag[]` to `Record<string, boolean>` keyed by `flag_key`. Sidebar now reads live org feature flags. Closes `F-Wave2-API-03` (Sidebar `useOrgFlagsStub` removed).
- `apps/web/src/components/shell/ErrorBoundary.tsx`: global render-time error catcher mounted in `main.tsx` between `AuthProvider` and `<App />`. Brand-clean fallback (`SOMETHING WENT WRONG / Refresh to try again. / RELOAD`).
- `apps/web/playwright.config.ts`: Chromium-only Playwright config; testDir `./playwright`; baseURL from `process.env.PLAYWRIGHT_BASE_URL`; `webServer` runs `pnpm dev` locally and is undefined in CI.
- `apps/web/playwright/smoke.spec.ts` and `apps/web/playwright/rls-probe.spec.ts`: scaffolds for the Phase-5 specs; `test.skip` until staging secrets are wired.

### Changed
- `apps/web/src/App.tsx`: wildcard `*` route now `Navigate to="/404"` so `NotFoundPage` stays a single lazy chunk. Closes `F-Wave2-BUILD-01` (Vite static-plus-dynamic chunk warning).
- AuditTimeline mounted on the ten remaining state-having detail pages (quotes, projects, purchase orders, vendor bills, expenses, receiving orders, production runs, shipments, leads, opportunities). All thirteen state-having detail pages now share the same heading style (`text-2xl font-display tracking-wide text-ink mb-3`).

### Not changed
- `BrandingProvider` and `Topbar.useMe` were already gated on `isAuthed` from Wave 2; no rewire needed.
- 22 byte-identical canon pairs intact.

### Status
- Bundle size: 25.94 kB gzip / 40 kB cap (up from 25.55 kB; AuditTimeline mount + ErrorBoundary + hooks reorganization).
- All six gates green: typecheck, lint, test, test:contract (25 / 25), build (no dual-import warning), bundle-budget.

## [0.2.2] · Wave 2 Hotfix: Deno workspace import map for zod

### Fixed
- Deno bundling failure on every edge function bundle that imports a side-car (`_shared/types/<domain>.ts`). All six side-car type files use the bare specifier `from 'zod'`. The SPA resolves it via `node_modules`; Deno requires `npm:zod` or an import map. The bare import worked for Wave 0 / Wave 1 because the only deployed functions (`audit-chain-verify`, `idempotency-gc`) never imported `_shared/types.ts`. Wave 2 added 21 bundles that import their domain side-car, exercising the bare specifier for the first time and breaking both `deploy-functions` (run #3) and `Supabase Preview` (failed-to-bundle).

### Added
- `supabase/functions/deno.json`: workspace-level Deno import map with `"imports": { "zod": "npm:zod@3.23.8" }`. Pinned to the same minor as the SPA's `zod ^3.23.0` so the resolver does not drift between SPA tests and the edge runtime.
- `.github/workflows/deploy-functions.yml`: passes `--import-map ./supabase/functions/deno.json` to every `supabase functions deploy` call. Belt-and-suspenders alongside Supabase's own deno.json auto-discovery used by the Preview branch.

### Not changed
- Byte-mirror canon: all 22 pairs still byte-identical (`pnpm test:contract` 25 / 25).
- Side-car type files unchanged on both sides.
- Bundle size unchanged at 25.55 kB / 40 kB.
- No migrations changed.

## [0.2.1] · Wave 2 Hotfix: CI pooler hostname, CLI version, bundle list

### Fixed
- `.github/workflows/migrate.yml` pooler hostname corrected from `aws-1-us-west-2.pooler.supabase.com` to `aws-0-us-west-1.pooler.supabase.com`. The remote KitStak Supabase project lives in region `us-west-1` (confirmed via Management API). The previous hostname resolved to a pooler that does not host this tenant, producing `(ENOTFOUND) tenant/user postgres.*** not found` at the `supabase migration list` step.
- `.github/workflows/migrate.yml` and `.github/workflows/deploy-functions.yml` Supabase CLI version bumped from `1.180.0` to `latest`. CLI 1.180.0 predates Postgres 17 GA and rejected `db.major_version = 17` in `supabase/config.toml` at startup. The remote project runs Postgres 17.6.1.121 on the GA channel, so the correct fix is bumping the CLI, not lowering the config.
- `.github/workflows/deploy-functions.yml` BUNDLES array extended from Wave 1's two functions (`audit-chain-verify`, `idempotency-gc`) to all 23 functions covering Wave 1 plus Wave 2's 21 new bundles.

### Added
- `supabase/config.toml` `[functions.tenants-api]` with `verify_jwt = false`. The public `resolve-host` route must serve pre-auth so the SPA can resolve a custom hostname to an org before sign-in. The bundle dispatcher gates authenticated routes (e.g. `/branding`) with `requireCaller()` at the handler level. Closes `F-Wave2-AGENT-A-06`.

## [0.2.0] · Wave 2 Domain Ports

### Added
- 37 forward-only migrations (slots `0004` through `0040`, with `0005` and `0006` intentionally empty).
  - Identity: `org_settings`, `org_domains`, `numbering_sequences`, `next_doc_number` advisory-locked RPC, `identity_providers` per D-007.
  - CRM: customers, contacts, activities, leads (5-state), opportunities (6-stage), `convert_lead` atomic RPC, audit state-change triggers.
  - Sales: currencies, exchange_rates (Pattern C), taxes, payment_methods, pricing_tiers, items, units, item_categories, value_added_services, job_types, quotes (6-state), quote_line_items (Pattern B), quote_versions (SECURITY DEFINER snapshot), quote_approvals, quote_templates, projects (6-state), project_phases (4-state), `convert_quote_to_project` RPC, `recompute_quote_totals` trigger, `set_default_tax` and `set_default_payment_method` atomic-flip RPCs.
  - Invoicing and finance: invoices (9-state, `balance_cents` GENERATED ALWAYS AS — closes AUDIT.md row 72), invoice_line_items, invoice_versions, payments, payment_allocations, credit_notes (4-state), credit_note_allocations, chart_of_accounts + `seed_org_chart_of_accounts`, journal_entries (3-state), `check_journal_balance` invariant, `post_journal_entry` RPC, period_close (text CHECK 4-state, not pg enum), `close_period` and `reopen_period` RPCs, `tg_je_reject_closed_period` raising SQLSTATE P0001 with `period_closed:` prefix, three auto-JE triggers (invoice send, payment create, credit note allocate) all `EXISTS`-guarded and `finance.journal_entries.enabled` flag-gated.
  - Vendors / inventory / ops: vendors, purchase_orders (7-state) + `recompute_purchase_order_totals`, vendor_bills (7-state, `balance_cents` GENERATED) + `recompute_vendor_bill_paid`, expenses (6-state), three more auto-JE triggers (vendor bill approved, vendor bill paid, expense paid), warehouses, stock_levels (`quantity_available` GENERATED) + `seed_org_default_warehouse` + `recompute_stock_level`, stock_movements, bom_items, receiving_orders (4-state), production_runs (4-state), shipments (4-state), three stock-movement-emitter triggers, audit state-change triggers.
  - Cross-cutting: attachments (polymorphic, Storage bucket), comments, saved_views, notifications, `audit_log` entity_type CHECK extended to 30 types, `audit_trigger_coverage_gaps()` verifier (all 14 state machines covered across Agents B / C / D / E plus organization from Wave 1), `seed_org_numbering`, `quote_attachments` VIEW over generic attachments, `seed_org_settings` with 10 default feature-flag rows.
- 21 new edge function bundles (23 total with the two from Wave 1):
  - Identity: `auth-api`, `tenants-api`, `settings-api`, `admin-console-api` (bundle-gated on `platform_admin.enabled`).
  - CRM: `crm-api` (26 routes).
  - Sales: `sales-config-api`, `quotes-api`, `projects-api`.
  - Invoicing and finance: `invoicing-api`, `finance-api`.
  - Vendors / inventory / ops: `vendors-api`, `inventory-api`, `ops-api` (bundle-gated on `plugins.3pl`, returns 404 when off).
  - Cross-cutting: `collaboration-api`, `search-api`, `customer-portal-api` (Pattern B RLS + customer_id row filter), `dashboard-api`, `exports-api`, `imports-api`, `notifications-worker` (X-Worker-Secret), `pdf-worker` (501 stub pending dep approval).
- 18 byte-identical side-car canon pairs at `_shared/{types,workflow,capabilities}/<domain>.ts` mirrored to `apps/web/src/lib/...` for identity, crm, sales, finance, vendors_inventory_ops, cross_cutting. `ALL_STATE_MACHINES` union published from `cross_cutting`.
- 50+ SPA pages across `pages/admin/`, `pages/crm/`, `pages/3pl-operations/<domain>/`, `pages/finance/`, `pages/portal/`, `pages/search/`, `pages/dashboard/`, `pages/imports/`, `pages/exports/`. 67 total route specs in the flat ROUTES table.
- `parity.test.ts` extended from 4 singular pairs to 22 pairs (4 singular plus 18 side-cars). All 25 contract assertions pass.
- `allowImportingTsExtensions = true` in `apps/web/tsconfig.json` so the SPA can byte-mirror the Deno-side `.ts` import suffix used by `_shared/workflow/cross_cutting.ts`.

### Changed
- `invoices.balance_cents` is now GENERATED ALWAYS AS, matching `vendor_bills.balance_cents`. Closes AUDIT.md row 72 asymmetry.

### Status
- Pillar 1 (3PL Operations) lit at the schema, API, and SPA layers.
- Pillars 2-3 (Manufacturing, Co-Pack and Ecom) plumbed (schemas + edge function bundles, feature-flag-gated off).
- Pillars 4-5 (KitForce, KitCost) not in scope this wave.
- Bundle size: 25.55 kB gzip against the 40 kB cap.

## [0.1.0] · Wave 1 Foundation Completion

### Added
- 11 new `_shared` modules: `tenant`, `cors`, `handler-helpers`, `audit`, `feature-flags`, `feature-defaults`, `requireFlag`, `withFlag`, `mfa`, `numbering`, `route`. `requireCap` placed in `handler-helpers.ts` to keep the byte-mirror with the SPA intact.
- Three-gate route taxonomy in `apps/web/src/auth/`: `ProtectedRoute`, `AdminProtectedRoute`, `PortalRoute`. Canonical `AuthContext` discriminated union (`loading | authenticated | unauthenticated`).
- `BrandingProvider` relocated from `lib/branding.tsx` to `whitelabel/BrandingProvider.tsx`. Default app-name fallback is `Kitstak`.
- AppShell + Sidebar (five-pillar IA in canonical order) + Topbar + RequireFlag + AuditTimeline.
- `lib/queryKeys/`, `lib/services/`, `lib/hooks/` with `useMe`, `useBranding`, `useCapabilities`, `useSwitchOrg`.
- FeatureUnavailable and NotFound pages.
- `.github/workflows/deploy-functions.yml` workflow_run-gated on `migrate.yml` with `head_sha` pin. Closes the TS1 R-W2-01 deploy-ordering race lesson.
- `.github/workflows/nightly-rls-probe.yml` 09:00 UTC against the staging Supabase preview branch, skip-with-clear-message when secrets absent.
- `.github/workflows/lighthouse.yml` plus `apps/web/.lighthouserc.cjs` with LCP < 2500ms, CLS < 0.1, TBT < 200ms thresholds.
- `apps/web/vitest.contract.config.ts` with Deno-URL-to-bare-zod rewrite so contract tests run under Vitest.
- New devDeps: `@playwright/test`, `playwright`, `@axe-core/playwright`, `size-limit`, `@size-limit/preset-app`. New scripts: `test:rls`, `test:e2e`, `bundle-budget`, `gen:types`, `test:contract`.

### Changed
- `idempotency.ts` rewritten: strict UUID v4 validation, `Idempotent-Replay: true` header on cached replay, 24h replay window, replay routed through `ok()` and `fromApiError()` for uniform CORS plus `x-request-id`. PK shape `(key, user_id, org_id, route_hash)` per D-010.
- `.github/workflows/migrate.yml` rewritten. Was reverse-gated on `deploy-prod`; now fires on push to `main` for `supabase/migrations/**`, runs `supabase db push` via the IPv4 pooler, gated by the `production-db` GitHub environment.
- `apps/web/src/routes.ts` rebuilt as a flat `RouteSpec[]` table. `App.tsx` consumes it and maps `RouteSpec.guard` to the leaf wrapper.
- AuthContext state union renamed `anonymous` to `unauthenticated`.
- `.gitignore` tightened to `.env*` (with `!.env.example` allowlist); added `*.pem`, `*.key`, `*.crt`, `*.p12`.

### Fixed
- Em dash in `03-workspace/journal/wave-1-identity-branding.md` line 98 replaced with semicolon.

## [0.0.3] · Wave 1 Hotfix: Audit Trigger Search Path

### Fixed
- Migration 0003: `trg_audit_organizations_status` and `verify_audit_chain` were authored with `set search_path = public`, which excluded the `extensions` schema where `pgcrypto.digest()` lives. The trigger raised `ERROR 42883 function digest(text, unknown) does not exist` the first time it fired (during the `provisioning → active` transition inside `provision_organization`). Both functions now fully-qualify the call as `extensions.digest(...)`. Two `CREATE OR REPLACE` statements; no table or policy changes; chain math unchanged.

### Operator state
- Seated operator org `kitstak` (display name `Kitstak`) with `mike@kitstak.com` as `org_owner`. JWT `app_metadata` carries `kitstak_org_id` and `kitstak_org_role` so RLS scope resolves on the first signed-in request.
- Both Edge Functions (`idempotency-gc`, `audit-chain-verify`) deployed via MCP at v1 (`verify_jwt=false`; bearer-secret auth via Edge Function env). Smoke-tested with valid bearer: both return HTTP 200 with the expected envelope.
- All nine GitHub Actions secrets in place (Vercel triplet, Supabase triplet, plus `SUPABASE_FUNCTION_URL`, `GC_TRIGGER_SECRET`, `AUDIT_VERIFY_SECRET`).

## [0.0.2] · Wave 1 Identity, Tenancy, Branding

### Added
- Migration 0002: organizations status FSM (`provisioning, active, suspended, archived`) with auto-state-transition audit trigger writing a per-org hash chain to `audit_log`.
- `provision_organization(slug, display_name, owner_user_id, owner_email)` RPC: atomic tenant seat (organization, profile, membership, branding) culminating in the transition to `active`.
- `verify_audit_chain(org_id)` RPC: returns the first broken row in an org's audit chain or empty if intact.
- `sso_connections` and `saml_configs` tables with RLS (Pattern A and Pattern B). Schema only; provider integration deferred.
- `BrandingProvider` reading `org_branding` and injecting CSS variables on the document root. Tailwind theme tokens (`bg`, `ink`, `accent`) resolve through `rgb(var(--x))`.
- `AuthProvider` plus `RequireAuth` route guard. `SignInPage` now calls `supabase.auth.signInWithPassword` and surfaces server errors inline.
- `idempotency-gc` Edge Function sweeping rows older than 7 days, scheduled nightly via `.github/workflows/idempotency-gc.yml`.
- `audit-chain-verify` Edge Function plus nightly workflow that fails CI if any chain is broken.
- `pnpm test:contract`: byte-parity test for the four canon files (types, workflow, capabilities, money) plus a behaviour parity spec for the money helpers.
- `lib/workflow.ts` and `lib/capabilities.ts` byte-mirrored across SPA and `_shared`.

### Changed
- `organizations.status` check constraint extended to admit `provisioning`.
- Tailwind `bg.DEFAULT`, `ink.DEFAULT`, and `accent.DEFAULT` colors now resolve through CSS variables so runtime branding takes effect without rebuild.
- `styles.css` `:root` declares default CSS variables for the customer-overridable surfaces.
- CI workflow runs `pnpm --filter web test:contract` between `test` and `build`.

## [0.0.1] · Wave 0 Foundation

### Added
- Initial project scaffolding with Vite, React 18, TypeScript strict mode.
- Tailwind CSS configured with the Kitstak design tokens (navy, ink, accent).
- Supabase integration with foundational schema (organizations, roles, org_memberships, profiles, org_branding, org_feature_flags, idempotency_keys, audit_log).
- Row-level security on every tenant-scoped table from migration 0001.
- Idempotency table keyed on `(key, user_id, org_id, route_hash)`.
- Audit log with hash-chain columns from day one.
- Sign in page and authenticated dashboard placeholder.
- Hand-rolled UI primitives: Logo, Button, TextInput.
- Money helpers byte-mirrored across the SPA and the edge runtime, with parity tests scaffolded.
- Shared Zod canon for Org, User, FeatureFlag, AuditEntry, IdempotencyKey, Branding.
- CI/CD workflows for typecheck, lint, build, preview deploys, prod deploys, and migrate.
- Brand bar logo component matching the design system spec.
