# Kitstak

**Built to Ship.**

The operating system for small-to-medium operators in 3PL, manufacturing, co-pack, and ecommerce fulfillment.

## What this repo is

The Kitstak product codebase. One spine (the always-on business backbone plus shared building blocks) plus six composable add-ons (3PL Operations, Manufacturing, Co-Pack and Ecom, KitForce, KitCost, and WMS for warehouse execution) on a single multi-tenant chassis. Feature flags decide what is lit per customer. Whitelabel is a product, not a feature. See `docs/adr/0002-spine-plus-addons-and-wms-sixth-addon.md`.

## Quick start

```bash
pnpm install
cp apps/web/.env.example apps/web/.env.local
# edit apps/web/.env.local with your Supabase project URL and anon key
pnpm --filter web dev
```

The SPA serves at `http://localhost:5173`.

### Local database

The migrations and edge functions run against a local Supabase stack.

```bash
supabase start          # boot the local Postgres plus edge runtime
supabase db reset       # apply every migration forward-only on a fresh DB
```

`supabase db reset` is the canonical way to verify the migration chain: it
drops the local DB and replays `supabase/migrations/*.sql` in order, so a
clean reset is the same gate CI enforces. Migrations are forward-only. Never
edit a numbered file after it has applied.

Edge functions read their secrets from `supabase/functions/.env.example`. Copy
it, fill in the values for the bundles you are exercising locally, and pass the
file when you serve a function:

```bash
cp supabase/functions/.env.example supabase/functions/.env
supabase functions serve <bundle> --env-file supabase/functions/.env
```

## Stack

| Layer | Choice |
|---|---|
| Build | Vite |
| Framework | React 18 SPA |
| Language | TypeScript strict |
| Routing | react-router-dom v6 with a flat ROUTES table |
| Styling | Tailwind plus hand-rolled primitives |
| Icons | lucide-react |
| Server state | TanStack Query |
| Client state | React Context plus useState |
| Forms | useState plus Zod safeParse |
| HTTP | lib/apiClient.ts |
| Dates | native Intl |
| Backend | Supabase Postgres plus Edge Functions (Deno) |
| Auth | Supabase Auth |
| Package manager | pnpm 9.x workspaces |
| Runtime | Node 20 LTS |
| Hosting | Vercel |
| Testing | Vitest plus Playwright |
| Bundle gate | size-limit (40 kB gzip on the index chunk) |

Banned by lint: antd, radix-ui, shadcn, redux, zustand, react-hook-form, formik, dayjs, date-fns, moment, lodash, axios, uuid, next, remix, gatsby.

## Folder structure

```
kitstak/
  apps/web/                 # Vite SPA
  supabase/                 # Postgres migrations and Edge Functions
  .github/workflows/        # CI, deploy, migrate
  docs/                     # ADRs, API contracts, user docs
  03-workspace/journal/     # Wave closeout journals
  00-canon/                 # Architectural canon
  scripts/                  # codegen, seed, qa
  test/                     # Contract and parity tests
```

## Development workflow

- One forward-only migration per change. File name `NNNN_snake_case.sql`. Never edit a numbered file post-apply.
- Every state-changing endpoint requires an `Idempotency-Key` header. The SPA `apiClient` injects it automatically.
- Every tenant-scoped table ships with row-level security from the migration that creates it.
- Money is BIGINT cents end-to-end. No floating point.
- Bundle budget is enforced in CI. Adding a banned dependency is a lint failure.

## Deployment

- Push to `main` with changes under `supabase/migrations/**` triggers `migrate.yml`. The job runs against prod through the IPv4 pooler at `aws-1-us-west-1.pooler.supabase.com` and is gated by the `production-db` GitHub environment.
- `deploy-functions.yml` fires on `workflow_run` after `migrate.yml` succeeds, pinning `head_sha` so function code deploys at the same SHA the schema was applied at. Closes the R-W2-01 deploy-ordering lesson.
- Push to `main` with changes under `apps/web/**` triggers `deploy-prod.yml` (Vercel). Production runs at `https://www.kitstak.com`.
- Pull requests get a Vercel preview.
- Nightly: `audit-chain-verify.yml`, `idempotency-gc.yml`, `nightly-rls-probe.yml` (48 cross-tenant probes against the staging Supabase preview branch; skip-with-clear-message when secrets absent).

## Current status

Prod runs through migration `0142`; there are 33 edge-function bundles under `supabase/functions/` (the directory also holds the shared `_shared` library and the `deno.json` / `deno.lock` config, which are not deployable bundles). Wave 13 and the 3PL and WMS add-ons described below are long live; the paragraph after them traces the arc since.

The 3PL commercial layer (Body A) is complete: Accounts, Job Builders, Quote integration, Project conversion with template snapshot, Supply Plans, Job Runs, Billing Review, and Job Profitability, building the loop Job Builder to Quote to Project to Supply Plan to Job Run to invoice (migrations 0089 to 0104, CHANGELOG `0.16.0` and `0.17.0`).

The sixth add-on, WMS (warehouse execution), shipped (Body B, B0 to B4). It deepens the spine's warehouse-level stock to bin level via a nullable `location_id` on the append-only `stock_movements` ledger: the sum of the bins equals the warehouse `quantity_on_hand` by construction, and turning `plugins.wms` off leaves the spine totals untouched. Warehouse locations, the bin-stock rollup, receiving to dock, directed putaway, and lot capture are all in, gated `plugins.wms` (default off) at the `/wms` root behind the `wms-api` bundle (migrations 0105 to 0110, CHANGELOG `0.18.0`). Migration 0111 hardened the FSM action RPC grants (revoked `EXECUTE` from `authenticated`; the Edge service-role call path is unchanged).

Wave 13 remediated the 2026-06-15 product audit and operator simulation: all twenty units shipped across three phases (P0 go-live blockers, P1 high impact, P2 correctness and polish). Highlights: JWT signature verification on the tenants and admin bundles with the one public route split into `tenants-public-api`; paid add-ons gated behind an active subscription; directed putaway now posts its stock move; covering indexes on the 101 unindexed foreign keys; function `search_path` and anon-execute hardening; an item-master deepening (unit of measure, cost, reorder point, barcode); a command-bar global search; TOTP MFA enrollment UI; inline create-with-lines; and an RLS policy consolidation that cleared the 88 multiple-permissive and 7 init-plan advisories with a verified no-widening diff. Migrations 0112 to 0116, CHANGELOG `0.19.0`. Closeout at `03-workspace/journal/wave-13-audit-remediation.md`. The closeout follow-ups then landed: a Retry-After-aware 429 backoff plus transition-cache and forwardRef-test cleanups (CHANGELOG `0.19.1`), and a SECURITY DEFINER grant revoke that cut the authenticated-executable advisor from 117 to 2 (migration 0117). The SSO store-metadata MVP (migration 0118) is built and held for review at PR #298; the live identity-provider handshake and the Lighthouse and edge-Sentry activations remain operator follow-ups.

Since Wave 13, several waves shipped to prod. The spine-plus-add-ons IA re-route moved the always-on backbone off the plugin-gated namespace, followed by a pillar-grouped then task-section navigation redesign with a generic section home, per-section KPI dashboards, and per-user default landing. A list-readability and reference-disclosure pass reworked roughly 90 list and detail surfaces. Native tiered quoting and recurring billing landed (ADRs 0004 and 0005, migrations 0133 to 0139): a quote splits into quantity-break tiers under one number, a line billing_interval flows quote to project to invoice, a pg_cron generator drafts monthly invoices, and created-audit symmetry was extended across the newer pillars. An in-app feedback and support channel shipped for operator beta testing (migrations 0140 and 0141). The 2026-06-26 build-or-delete epic (PRs #397, #398, #400, migration 0142) then built the account, project-header, and payment-detail edit surfaces operators were missing, seeded default expense categories, and swept roughly 1,621 lines of never-wired mutation scaffolding.

Earlier foundations remain closed: observability (Phase 9, Sentry plus PostHog), polish (Phase 8), stabilization (Phase 7), and the Phase 6 quote-to-cash gate walked end to end on prod.

See `STATUS.md` for the full breakdown and the Outstanding Work and Drift Register sections for what is in flight, `CHANGELOG.md` for release history, and `03-workspace/journal/` for per-wave closeouts.

## License

Proprietary. See LICENSE.
