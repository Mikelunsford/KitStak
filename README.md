# Kitstak

**Built to Ship.**

The operating system for small-to-medium operators in 3PL, manufacturing, co-pack, and ecommerce fulfillment.

## What this repo is

The Kitstak product codebase. Five product pillars (3PL Operations, Manufacturing, Co-Pack and Ecom, KitForce, KitCost) on a single multi-tenant chassis. Feature flags decide what is lit per customer. Whitelabel is a product, not a feature.

## Quick start

```bash
pnpm install
cp .env.example .env.local
# edit .env.local with your Supabase project URL and anon key
pnpm --filter web dev
```

The SPA serves at `http://localhost:5173`.

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
- `deploy-functions.yml` fires on `workflow_run` after `migrate.yml` succeeds, pinning `head_sha` so function code deploys at the same SHA the schema was applied at. Closes the TS1 R-W2-01 deploy-ordering lesson.
- Push to `main` with changes under `apps/web/**` triggers `deploy-prod.yml` (Vercel). Production runs at `https://www.kitstak.com`.
- Pull requests get a Vercel preview.
- Nightly: `audit-chain-verify.yml`, `idempotency-gc.yml`, `nightly-rls-probe.yml` (48 cross-tenant probes against the staging Supabase preview branch; skip-with-clear-message when secrets absent).

## Current status

Phase 7 (Stabilization) is now closed (baseline `9846f1e`). All fourteen stabilization follow-ups closed across twelve PRs (#37 through #48) in three parallel cycles: low-coupling cleanups, boundary canon work, and schema normalisation. 50 forward-only migrations applied at the remote (latest: 0049 adds `customers.default_payment_terms_days`, 0050 normalises receiving / shipment line items into dedicated tables with Pattern A RLS). Byte-mirror parity intact across 26 pairs (`pnpm test:contract` 26/26; `constants` pair added this phase). Bundle 29.73 / 40 kB.

Phase 6 quote-to-cash gate also remains closed (baseline `347062f`). Six hotfix PRs (#24 through #29) landed during the operator walkthrough; five polish PRs (#31 through #35) cleared the carryover bucket the morning after.

The Phase 7 close-out journal at `03-workspace/journal/phase-7-stabilization-closeout.md` covers the twelve PRs and the three reframes (CRM-SCHEMA-01 refusal as a pattern win, parallel migration-number collision codified, Agent Router cycles validated for stabilization scope).

See `STATUS.md` for the full breakdown, the Outstanding Work and Drift Register sections for what is in flight, `CHANGELOG.md` for release history, and `03-workspace/journal/` for per-wave closeouts.

## License

Proprietary. See LICENSE.
