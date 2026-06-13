# Kitstak Constitution

This file is the operating constitution for every AI agent working in this repo. Read it at the start of every session. Re-read when in doubt.

If a request conflicts with this constitution, stop and ask. Asking is not failure.

## What you are working on

Kitstak. The operating system for small-to-medium operators in 3PL, manufacturing, co-pack, and ecommerce fulfillment. One spine (the always-on business backbone plus shared building blocks) plus composable add-ons. The add-ons, in order: 3PL Operations, Manufacturing, Co-Pack and Ecom, KitForce, KitCost, and WMS (warehouse execution), the sixth add-on added 2026-06-04. See `docs/adr/0002-spine-plus-addons-and-wms-sixth-addon.md` and `03-workspace/specs/2026-06-04-3pl-commercial-pivot-and-wms-pillar-plan.md`. Business goal: $250K ARR within 18 months by landing 10 paying customers at $2K average.

Ship fast, validate with the first operator, defer perfection where the chassis is already solid.

## The non-negotiables

### Money rules
- Storage: BIGINT cents in Postgres. `_cents` column suffix everywhere.
- Math: `roundHalfEven` (banker's rounding). Never floating point for monetary math.
- Wire: cents as integer or string. Never floats.
- Currency: snapshotted at issuance on every line item.
- Mirror: `_shared/money.ts` byte-identical to `apps/web/src/lib/money.ts`. Enforced by `money.parity.test.ts` contract test.

### RLS rules
- Every tenant-scoped table has RLS from migration 0001.
- Three patterns: A (single-table `org_id = current_org_id()` plus role check), B (parent-join scope), C (global table, `USING (true)`).
- RLS filters, never throws. Cross-tenant reads return `200 + []`. Workflow POSTs across tenants return `404`. Plugin bundle gates return `404`. Per-route feature flag misses return `403 FEATURE_DISABLED { flag }`.
- Probed nightly with ephemeral fixtures. A `403` where `404` is expected is a release blocker.

### Migration rules
- Forward-only. Files numbered `NNNN_snake_case.sql`, four-digit zero-padded.
- Never edit a numbered file after apply. If a migration fails or a prior decision was wrong, write a new forward migration.
- Multi-stage drops: relax NOT NULL, redeploy code that stops using the column, drop the column one release later.
- Every migration header declares: Wave, Phase, Closes, DOWN MIGRATION (operator-only), date stamp, constitutional alignment.
- All DDL is idempotent (`IF EXISTS`, `IF NOT EXISTS`).

### Zod canon
- `_shared/types.ts` and `apps/web/src/lib/types.ts` are byte-identical. Asserted by `pnpm test:contract`.
- A drift is a release blocker.

### Idempotency
- Every non-GET handler enforces `Idempotency-Key` header (UUID v4). Validated, hashed, stored.
- Storage: `idempotency_keys` table. PK `(key, user_id, org_id, route_hash)` from migration 0001.
- Body hash: RFC 8785 canonical JSON. Same key plus different body returns `409 IDEMPOTENCY_CONFLICT`.
- GC: nightly sweep of rows older than 7 days.

### Audit log
- `audit_log` is append-only via RLS (deny UPDATE, DELETE, INSERT for authenticated; service-role-only writes).
- Hash chain active from migration 0001.
- Auto-state-transition triggers on every entity with a state machine. No best-effort handler writes.

### Capabilities
- 8 roles: org_owner, org_admin, sales, ops, accounting, viewer, customer_user, vendor_user.
- ~120 capabilities. `<domain>.<resource>.<action>` shape.
- `requireCap(caller, cap)` on every state-changing handler. 403 FORBIDDEN if denied.
- SPA mirrors the role policy for button hiding only. Server is authority.

## What we use

- Build: Vite. React 18 SPA. TypeScript strict.
- Routing: react-router-dom v6 with a flat ROUTES table and lazy code splits.
- Styling: Tailwind plus hand-rolled primitives in `components/ui/`.
- Icons: lucide-react.
- Server state: TanStack Query. `staleTime: 30_000`, `refetchOnWindowFocus: false`, `retry: 1`.
- Client state: React Context plus useState.
- Forms: useState plus Zod safeParse.
- HTTP: `lib/apiClient.ts` (one fetch wrapper).
- Dates: native `Intl`.
- UUIDs: `crypto.randomUUID()`.
- Backend: Supabase Postgres plus Edge Functions (Deno).
- PDF rendering (worker-side only): `jspdf` (Apache-2.0 / MIT-permissive). Operator approved at F-Wave2-CO-01 close. Imported by `pdf-worker` only; not allowed in SPA bundle.
- Charts (lazy-loaded, KitCost dashboard only): `recharts` (MIT, ~95 kB gzipped). Operator approved at Path C / C2 close. Imported only by `apps/web/src/pages/kitcost/KitCostDashboardPage.tsx`; the route is `lazy()` so Recharts lands in the KitCost chunk, not the main SPA index chunk.
- Error and performance capture (SPA only): `@sentry/react` (MIT). Operator approved at F-Wave5-CO-01 / F-Wave3-OBS-01 SPA close. Lazy-loaded via dynamic import in `apps/web/src/lib/sentry.ts`; no-op when `VITE_SENTRY_DSN` absent at build (tree-shakes to zero chunk). Edge-function capture filed separately as `F-Wave5-CO-01-EDGE-01`.
- Testing: Vitest plus Playwright plus `@axe-core/playwright`.
- Bundle gate: `size-limit`.

## What we refuse

Enforced by ESLint `no-restricted-imports`. Adding any of these triggers a constitution review.

- antd, @ant-design/*, @ant-design/icons.
- @radix-ui/*, shadcn.
- redux, @reduxjs/toolkit, zustand, jotai, recoil.
- react-hook-form, formik.
- dayjs, date-fns, moment.
- lodash.
- axios.
- uuid (package).
- next, @remix-run/*, gatsby.
- Stock photography.

## Branding rules

- Product name: Kitstak. One word, capital K only.
- Tagline: "Built to Ship."
- Product shape: one spine plus composable add-ons. The add-ons, in order: 3PL Operations, Manufacturing, Co-Pack and Ecom, KitForce, KitCost, and WMS (warehouse execution). See `docs/adr/0002-spine-plus-addons-and-wms-sixth-addon.md`.
- Colors: navy `#0a1628`, ink `#f5f1e8`, accent `#c8102e`. Full tokens in `apps/web/tailwind.config.js`.
- Type: Bebas Neue (display), Inter Tight (body), JetBrains Mono (code).

### Forbidden in user-facing copy
- Em dashes (any use). Use periods, "·", or rephrase.
- Double hyphens (any use).
- Emojis. Status indicators in internal docs only.
- Stock photography.
- Generic gradients.

## How you work

- Wave-based delivery. Each wave declares scope, deliverables, risks closed, risks carried, constitutional invariants verified. Closeout journal at `03-workspace/journal/wave-<N>-<slug>.md`.
- Risk IDs: `R-W<wave>-<seq>`, `R-W<wave>-<DOMAIN>-<seq>`, `R-W<wave>-CO-<seq>` for carries. Follow-ups in `F-Wave<N>-<seq>`.
- Multi-agent dispatch is the pattern for large audits.
- Every PR cites: risk closed, follow-up spawned, constitutional invariants verified.

## When to stop and ask

- A request asks for an em dash, double hyphen, or emoji in user-facing copy. Stop.
- A request asks you to write a 403 where 404 is the constitutional answer. Stop.
- A request asks for a new top-level dependency. Stop and run the constitution-review checklist.
- A migration would break the forward-only rule. Stop.
- A schema change touches RLS, money helpers, idempotency, or audit_log. Stop and confirm with the operator.
- You are about to mark a wave closed without a closeout journal entry. Stop.
