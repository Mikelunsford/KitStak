# 00-canon / 01-architecture.md

The architectural lock-ins. This file is the single source of truth for "what runs on what." Changes require an ADR and operator approval.

## Product shape: spine plus add-ons

Kitstak is one spine plus composable add-ons (white paper V2, 2026-06-03; ADR 0002, 2026-06-04). The spine is always on: the business backbone plus the shared building blocks (orders, catalog, kits and BOMs, inventory and stock, warehouses, job types, production, pricing, value-added services, materials). Each add-on adds one clean slice and reads the spine instead of copying it.

Add-ons gate at the bundle level (404 when off) and at the SPA route level (NotFoundPage when off), inferred from the URL prefix in `routes.ts` `inferPluginForPath`. The add-on flags: `plugins.three_pl`, `plugins.manufacturing`, `plugins.copack_ecom`, `plugins.kitforce`, `plugins.kitcost`, and `plugins.wms` (warehouse execution, the sixth add-on, defaults off).

WMS deepens, it never replaces. WMS adds bin-level execution on top of the spine's warehouse-level stock. The contract: the spine `stock_levels` (generated `quantity_available`, derived from the `stock_movements` ledger) stays the warehouse-grain truth; WMS adds a nullable `location_id` dimension to the same ledger and derives a bin-level rollup, so the sum of bin quantities equals the warehouse `quantity_on_hand` by construction. Turn WMS off and `location_id` stays null, exactly as every pre-WMS row already is, and the warehouse totals are untouched. Detail and phasing in `03-workspace/specs/2026-06-04-3pl-commercial-pivot-and-wms-pillar-plan.md`.

## Stack lock-ins

| Layer | Kitstak uses | Kitstak refuses |
|---|---|---|
| Build tool | Vite | Webpack, CRA, Next.js |
| Framework | React 18 (SPA only) | Next.js, Remix, SSR |
| Language | TypeScript strict | Loose TS, JavaScript |
| Routing | react-router-dom v6 with flat ROUTES table and lazy code splits | TanStack Router, Next routing, nested Route JSX |
| Styling | Tailwind plus hand-rolled primitives plus CSS-variable design tokens | shadcn, Radix, AntD, MUI |
| Icons | lucide-react | @ant-design/icons, font icons |
| Server state | TanStack Query | SWR, Redux Toolkit Query |
| Client state | React Context plus useState | Redux, Zustand, Jotai, Recoil |
| Form state | Native useState plus Zod safeParse | react-hook-form, Formik |
| HTTP client | Custom apiClient.ts fetch wrapper | axios |
| Dates | Native Intl APIs | dayjs, date-fns, moment |
| Utilities | Native ES2022 | lodash |
| Toasts | sonner | react-hot-toast, AntD message |
| UUIDs | crypto.randomUUID() | uuid package |
| Backend | Supabase Postgres plus Edge Functions (Deno) | Node API, Express, tRPC |
| Auth | Supabase Auth (JWT plus TOTP MFA, SSO/SAML for Enterprise) | NextAuth, Clerk, Auth0 |
| Package manager | pnpm 9.x workspaces | npm, yarn |
| Runtime | Node 20 LTS | Older Node, Bun |
| Hosting | Vercel (us-west-1) | Netlify, Cloudflare Pages |
| Testing | Vitest plus Playwright plus @axe-core/playwright | Jest, Cypress |
| Bundle gate | size-limit (40 kB gzip on the index chunk) | bundlewatch, manual |
| PDF rendering (worker-side only) | jspdf (Apache-2.0 / MIT-permissive; operator approved at F-Wave2-CO-01 close) | client-side PDF libs in the SPA bundle |
| Drag-and-drop (lazy-loaded route surfaces) | @dnd-kit/core + @dnd-kit/sortable + @dnd-kit/utilities (MIT; operator approved at F-Wave2-DNDKIT-01) | react-dnd, react-beautiful-dnd, sortable.js |
| Product analytics (SPA, lazy-loaded) | posthog-js (MIT; operator approved at F-Wave5-CO-02; activated 2026-05-20 against PostHog US Cloud project 433097) | Segment, Mixpanel, Amplitude |
| Error + perf capture (SPA, lazy-loaded) | @sentry/react (MIT; operator approved at F-Wave5-CO-01 SPA close; activated 2026-05-20 against Sentry SaaS US region project 4511423235751936) | bare browser onerror, LogRocket, Rollbar |

Banned dependencies enforced at ESLint via `no-restricted-imports`:

- antd, @ant-design/*
- @radix-ui/*, shadcn
- redux, @reduxjs/toolkit, zustand, jotai, recoil
- react-hook-form, formik
- dayjs, date-fns, moment
- lodash
- axios
- uuid
- next, @remix-run/*, gatsby

## Folder structure

```
kitstak/
  apps/web/
    src/
      App.tsx
      main.tsx
      routes.ts
      styles.css
      components/
        ui/          # Hand-rolled primitives
        shell/
      pages/<pillar>/<domain>/
      lib/
        apiClient.ts
        supabase.ts
        types.ts
        money.ts
        workflow.ts
        capabilities.ts
        queryKeys/
        services/
        hooks/
      test/
    public/brand/
    vite.config.ts, tailwind.config.js, tsconfig.json
    .eslintrc.cjs, .size-limit.cjs
    package.json
  supabase/
    config.toml
    migrations/    # NNNN_snake_case.sql forward-only
    functions/
      _shared/     # types.ts, responses.ts, idempotency.ts, money.ts, etc.
        types/         # per-domain Zod side-cars, byte-mirrored
        workflow/      # per-domain FSM side-cars, byte-mirrored
        capabilities/  # per-domain capability tuples, byte-mirrored
      <bundle>-api/
  00-canon/
  docs/
    adr/
    api/
    users/
  03-workspace/journal/   # Wave closeout journals
  .github/workflows/
  scripts/
  test/
```

## Money

- Storage: BIGINT cents. `_cents` suffix.
- Math: `roundHalfEven`.
- Wire: cents as integer or string. Never floats.
- Currency snapshotted at issuance.
- Helpers byte-mirrored across `_shared/money.ts` and `apps/web/src/lib/money.ts`.

## Canon partition pattern

Four canon files are byte-mirrored between `apps/web/src/lib/` and `supabase/functions/_shared/`: `types.ts`, `workflow.ts`, `capabilities.ts`, `money.ts`. Each singular file carries cross-cutting foundation only.

Per-domain extensions live in side-cars under `_shared/types/<domain>.ts`, `_shared/workflow/<domain>.ts`, `_shared/capabilities/<domain>.ts`, each paired with a byte-identical SPA mirror at `apps/web/src/lib/{types,workflow,capabilities}/<domain>.ts`. Domain agents extend their side-car only; the singular foundation files stay stable. `_shared/workflow/cross_cutting.ts` aggregates every domain FSM into `ALL_STATE_MACHINES` so callers can iterate uniformly.

`apps/web/test/contract/parity.test.ts` asserts byte-equality for all singular pairs plus every side-car pair. Drift on either is a release blocker.

`apps/web/tsconfig.json` sets `allowImportingTsExtensions: true` so the SPA mirror can use the explicit `.ts` import suffix that Deno requires on the edge side. This is what lets the SPA copy be byte-identical with the Deno-side file.

## Multi-tenancy (RLS patterns)

### Pattern A: single-table tenant scope
```
USING (
  org_id = public.current_org_id()
  AND public.current_user_role() IN ('org_owner', 'org_admin', ...)
)
```

### Pattern B: parent-join tenant scope
```
USING (
  EXISTS (
    SELECT 1 FROM parent_table p
    WHERE p.id = <this>.parent_id
      AND p.org_id = public.current_org_id()
  )
)
```

### Pattern C: global, no tenant filter
```
TO authenticated
USING (true)
```

### RLS filters, never throws
Cross-tenant reads return `200 + []`. Workflow POSTs across tenants return `404`. Plugin bundle gate misses return `404`. Per-route feature flag misses return `403 FEATURE_DISABLED`.

## API contract

### Wire envelope
- Success: `{ data: T, meta?: object }`
- Error: `{ error: { code, message, details?, request_id } }`
- Headers always include `x-request-id`.

### Idempotency
- Header: `Idempotency-Key` (UUID v4).
- Storage: `idempotency_keys` table with PK `(key, user_id, org_id, route_hash)`.
- Body hash: RFC 8785 canonical JSON.
- 24h replay window.

### Pagination
- Cursor: opaque base64 over `(created_at, id)`.
- `?limit=` default 50, clamped [1, 200].
- Response: `{ items, next_cursor }`.

### HTTP code map
| Code | Use |
|---|---|
| 200 | Success default |
| 201 | Resource creation |
| 204 | CORS preflight |
| 401 | UNAUTHORIZED, NO_ACTIVE_ORG |
| 403 | FORBIDDEN, FEATURE_DISABLED |
| 404 | NOT_FOUND, bundle gate-off |
| 405 | METHOD_NOT_ALLOWED |
| 409 | STATE_CONFLICT, IDEMPOTENCY_CONFLICT |
| 422 | VALIDATION_ERROR |
| 429 | RATE_LIMITED |
| 500 | INTERNAL_ERROR |

## Bundle and performance budgets

- SPA index chunk: 40 kB gzip max. **Enforced** by `.size-limit.cjs`. Current at 29.95 kB (2026-05-20).
- Lazy chunks: no per-chunk gates today. Current sizes for reference (with `VITE_SENTRY_DSN` + `VITE_POSTHOG_KEY` set at build): `sentry-*.js` 120.74 kB gz, `posthog-*.js` 64.72 kB gz, `supabase-*.js` 53.50 kB gz, `react-*.js` 53.74 kB gz, `PhasesSection-*.js` (dnd-kit) 16.56 kB gz, `query-*.js` 12.79 kB gz. Per-route page chunks 0.7-3.4 kB gz each.
- Asset cache: `/assets/*` served `max-age=31536000, immutable`.
- Security headers via `vercel.json`.
- Lighthouse: LCP under 2.5s, CLS under 0.1, TBT under 200ms. **Currently NOT enforced**: the `lighthouse.yml` workflow is gated by the repo variable `LIGHTHOUSE_ENABLED` which is not set to `'true'` because Vercel preview Deployment Protection blocks the Lighthouse runner with 401 redirect loops. Re-enable by either dropping preview Deployment Protection or configuring a Vercel Protection Bypass secret. Tracked as a Phase 9 follow-up to revisit.
