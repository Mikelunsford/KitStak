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

Phase 6 F-Wave6-FLOW-01 quote-to-cash gate has been walked end-to-end on prod (baseline `0d190e3`). The operator walked customer create through invoice send and payment receive; six hotfix PRs (#24 through #29) landed during the walkthrough itself, each closing a chassis-drift bug surfaced by the operator at a specific step. 48 forward-only migrations applied at the remote (latest: 0047 hardens the project_line_items audit trigger, 0048 hardens the emit_movements triggers). Byte-mirror parity intact across 22 pairs (`pnpm test:contract` 25/25).

Phase 6 is now substantially closed. Residual UX clunkiness is tracked under "Phase 6 polish carryover" in STATUS.md and folded into Phase 7. Phase 7 (Stabilization) is the active scope.

See `STATUS.md` for the full breakdown, the Outstanding Work and Drift Register sections for what is in flight, `CHANGELOG.md` for release history, and `03-workspace/journal/` for per-wave closeouts.

## License

Proprietary. See LICENSE.
