# 00-canon / 01-architecture.md

The architectural lock-ins. This file is the single source of truth for "what runs on what." Changes require an ADR and operator approval.

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

- SPA index chunk: 40 kB gzip max.
- Asset cache: `/assets/*` served `max-age=31536000, immutable`.
- Security headers via `vercel.json`.
- Lighthouse: LCP under 2.5s, CLS under 0.1, TBT under 200ms.
