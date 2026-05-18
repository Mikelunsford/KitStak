# Kitstak Status

Last updated: 2026-05-18

## Current state

**Wave 2 domain ports shipped (PR #4 merged · commit `e1dd9ba`).** Pillar 1 (3PL Operations) is lit at the schema, API, and SPA layers. Pillars 2-3 (Manufacturing, Co-Pack and Ecom) are plumbed (schemas plus edge function bundles, feature-flag-gated off). All 37 forward-only migrations are applied at the remote (Postgres 17.6.1.121, GA channel, region `us-west-1`).

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

### Wave 2 CI hotfix (this branch)

Two GitHub Actions failures after PR #4 merge required a hotfix:

- `migrate.yml` used `aws-1-us-west-2.pooler.supabase.com`; the project's region is `us-west-1` and the canonical pooler hostname is `aws-0-us-west-1.pooler.supabase.com`. ENOTFOUND on the DNS lookup.
- `deploy-functions.yml` pinned the Supabase CLI at `1.180.0`, which predates Postgres 17 GA support and rejects `db.major_version = 17` in `config.toml`. The remote project IS on Postgres 17.x, so the correct fix is bumping the CLI, not lowering the config.

Both workflows now pin `supabase/setup-cli@v1` with `version: latest`. `deploy-functions.yml` BUNDLES array extended to all 23 functions (Wave 1's 2 plus Wave 2's 21). `config.toml` adds `[functions.tenants-api] verify_jwt = false` so the public host-resolver route serves pre-auth (closes `F-Wave2-AGENT-A-06`).

## Wave 3 scope

Integration. Wire BrandingProvider to load from `/tenants-api/branding` at app boot. Wire AppShell layout. Wire AuditTimeline into every detail page that has state transitions. Wire global error boundary, 404 page, FeatureUnavailable page. Optional Sentry SPA init if DSN present. Drop `apps/web/playwright.config.ts` and the smoke spec, then run the full E2E flow (signup, signin, switch org, create customer, create quote, send, accept, convert to project, send invoice, post payment, run receiving order, ship shipment, view audit log).

## Open risks

None open at Wave 2 close. The 10 Wave 2 follow-ups (`F-Wave2-*`) are tracked in `03-workspace/journal/wave-2-domain-ports.md`. The two operator-gated decisions are:

- `F-Wave2-CO-01`: pdf-worker render endpoint needs an operator-approved JS PDF dep (`pdfkit` or `jsPDF`, both BSD).
- `F-Wave2-DNDKIT-01`: `dnd-kit` is referenced by `00-canon/01-architecture.md` but is not in `apps/web/package.json`. Phase reorder shipped as up / down buttons.
