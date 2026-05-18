# Wave 1 Closeout: Foundation Completion

Date: 2026-05-18
Wave: 1 (Phase 1 of the parallel build orchestration)
Status: Closed
Branch: `claude/thirsty-black-e5cb8c`

## Wave summary

This wave closes the Wave 0 chassis gap and seats every cross-cutting helper the domain ports will consume in Wave 2 and after. Three parallel agents (Substrate, SPA Chassis, CI + Config) ran end-to-end without mid-phase pauses. Every Phase 1 gate is green. SPA index chunk holds at 21.62 kB gzip against the 40 kB budget. Phase 0 hygiene (gitignore tightening, an em-dash fix in the prior journal) is bundled into this PR per operator direction.

## Deliverables

### `_shared` substrate (Track A)
- `supabase/functions/_shared/tenant.ts`. `requireCaller(req)` decodes the JWT and returns `{ userId, orgId, role }` from `app_metadata.kitstak_org_id` and `kitstak_org_role`. Throws `UNAUTHORIZED` 401 with no bearer, `NO_ACTIVE_ORG` 401 when the claim is absent.
- `supabase/functions/_shared/cors.ts`. `corsHeaders()` and `handlePreflight(req)` returning a 204 on OPTIONS.
- `supabase/functions/_shared/handler-helpers.ts`. `respondWithIdempotency`, `paginate`, `parseLimit`, `parseExpand`, `encodeCursor` / `decodeCursor`, `created(data)` 201 helper, `admin()` service-role client factory, and the `requireCap(caller, cap)` helper (placed here rather than `capabilities.ts` so the byte-mirror with the SPA stays intact).
- `supabase/functions/_shared/audit.ts`. Non-state-change `writeAudit` helper. Doc comments document DB triggers as the primary audit path; this helper is the narrow handler-side surface for non-state-change actions.
- `supabase/functions/_shared/feature-flags.ts`. 5-minute in-memory cache keyed by `(orgId, flagKey)`, fail-closed on miss. `invalidateFlagCache(orgId?)` for tests.
- `supabase/functions/_shared/feature-defaults.ts`. `DEFAULT_FLAGS_BY_TIER` for starter / professional / enterprise per the PRD pricing matrix.
- `supabase/functions/_shared/requireFlag.ts`. Per-route 403 FEATURE_DISABLED with `details.flag`.
- `supabase/functions/_shared/withFlag.ts`. HOF wrapping a handler with a per-route flag gate.
- `supabase/functions/_shared/mfa.ts`. `requireMfaVerified(caller)` calling `public.has_verified_totp` with per-request WeakMap memoisation.
- `supabase/functions/_shared/numbering.ts`. `nextDocNumber(orgId, docType)` client wrapper for the advisory-locked RPC.
- `supabase/functions/_shared/route.ts`. Route dispatcher with configurable prefix strip (kills the dual-registration pattern from TS1). Echoes or mints `x-request-id`; routes `ApiError` through `fromApiError`; 500s emit the `INTERNAL_ERROR` envelope.
- `supabase/functions/_shared/idempotency.ts`. Rewritten: strict UUID v4 validation (`IDEMPOTENCY_KEY_REQUIRED` 400, `IDEMPOTENCY_INVALID_KEY` 400), 24h replay window, `Idempotent-Replay: true` header on cached replay, replay routed through `ok()` / `fromApiError()` for uniform CORS and `x-request-id`. PK shape `(key, user_id, org_id, route_hash)` per D-010 and migration 0001.

### SPA chassis (Track B)
- `apps/web/src/auth/AuthContext.tsx`, `ProtectedRoute.tsx`, `AdminProtectedRoute.tsx`, `PortalRoute.tsx`. Canonical AuthContext discriminated union (`loading | authenticated | unauthenticated`) and the three-gate route taxonomy. `useAuth()` and `useAuthOptional()` exports.
- `apps/web/src/whitelabel/BrandingProvider.tsx`. Moved from `lib/branding.tsx`. Default app-name fallback is `Kitstak`. Strips style overrides on logout.
- `apps/web/src/components/shell/AppShell.tsx`, `Sidebar.tsx`, `Topbar.tsx`, `RequireFlag.tsx`, `AuditTimeline.tsx`. Five-pillar Sidebar in canonical order; Topbar org switcher reads `useMe()` and posts via `useSwitchOrg` (TODO marker for the Wave 2 auth-api endpoint).
- `apps/web/src/lib/queryKeys/`, `services/`, `hooks/`. `meKeys`, `brandingKeys`, `meService`, `brandingService`, `useMe`, `useBranding`, `useCapabilities`, `useSwitchOrg`. Hooks default to `enabled: false` until Wave 2 lights up the endpoints.
- `apps/web/src/pages/FeatureUnavailablePage.tsx`. Reads `?flag=` from URL.
- `apps/web/src/pages/NotFoundPage.tsx`.
- `apps/web/src/routes.ts`. Rebuilt as a flat `RouteSpec[]` table: `{ path, element: LazyExoticComponent, guard, layout }`. No JSX `<Route>` nesting anywhere in the codebase.
- `apps/web/src/App.tsx`. Consumes the flat ROUTES table; maps `RouteSpec.guard` to the leaf wrapper via `wrapWithGuard()`.
- `apps/web/src/lib/auth.tsx`. Reduced to a thin re-export shim of `@/auth/AuthContext`.
- `apps/web/src/lib/branding.tsx`. Deleted; canonical home is `whitelabel/BrandingProvider.tsx`.
- `apps/web/src/components/shell/RequireAuth.tsx`. Deleted; superseded by the three-gate set.
- `apps/web/src/styles.css`. Full design-token block as rgb triplets; `@font-face` declarations for Bebas Neue, Inter Tight, JetBrains Mono with `font-display: swap`.
- `apps/web/public/fonts/README.txt`. Licensing and procurement notes; flags `F-Wave1-FONTS-01` to drop the woff2 files.
- `apps/web/src/pages/SignInPage.tsx` and `DashboardPage.tsx`. Updated to consume canonical AuthContext and render via AppShell.

### CI and config (Track C)
- `.github/workflows/deploy-functions.yml`. `workflow_run` gated on `migrate.yml` success with `head_sha` pin. Closes the TS1 R-W2-01 deploy-ordering race lesson.
- `.github/workflows/nightly-rls-probe.yml`. 09:00 UTC daily cron against the staging preview branch. Skips with a clear `::notice::` when `STAGING_SUPABASE_URL` or `STAGING_SUPABASE_SERVICE_ROLE_KEY` is unset; never falls back to prod.
- `.github/workflows/lighthouse.yml` plus `apps/web/.lighthouserc.cjs`. Thresholds: LCP < 2500 ms, CLS < 0.1, TBT < 200 ms. Workflow fails on breach.
- `.github/workflows/migrate.yml`. Rewritten. Was reverse-gated on `deploy-prod`; now fires on push to `main` for `supabase/migrations/**`, runs `supabase db push` via the IPv4 pooler, gated by the `production-db` GitHub environment for manual approval. Drops the broken `supabase link` step.
- `.github/workflows/ci.yml`. Added `pnpm --filter web bundle-budget` as the final step.
- `apps/web/vitest.contract.config.ts`. Rewrites Deno URL imports to bare `zod` at load time so the two parity tests run under Vitest.
- `apps/web/.size-limit.cjs`. 40 kB gzip budget on the SPA index chunk. Unchanged (already correct).
- `apps/web/eslint.config.js`. Already enforces the full ban list; no patch needed.
- `vercel.json`. Already carries the canon security headers and asset cache. No patch needed.
- `package.json` (root) and `apps/web/package.json`. New scripts: `test:rls`, `test:e2e`, `bundle-budget`, `gen:types`, `test:contract`. New devDeps: `@playwright/test`, `playwright`, `@axe-core/playwright`, `size-limit`, `@size-limit/preset-app`. Lockfile regenerated.

### Phase 0 hygiene bundled into this PR
- `.gitignore`. Tightened `.env*` (with `!.env.example` allowlist); added `*.pem`, `*.key`, `*.crt`, `*.p12`.
- `03-workspace/journal/wave-1-identity-branding.md`. Em dash on line 98 replaced with a semicolon.

## Gates verified

- `pnpm install` succeeds; lockfile regenerated for five new devDeps.
- `pnpm --filter web typecheck` zero errors.
- `pnpm --filter web lint` zero errors, zero warnings (after removing three unused `react-refresh/only-export-components` disable directives and one unnecessary `\-` regex escape).
- `pnpm --filter web test` 5 / 5 pass.
- `pnpm --filter web test:contract` 7 / 7 pass (`money.parity.test.ts`, `parity.test.ts`).
- `pnpm --filter web build` succeeds. SPA index chunk: 21.62 kB gzip.
- `pnpm --filter web bundle-budget` green: 21.62 kB against the 40 kB limit.
- Brand validation greps: zero violations. Two acceptable internal-context hits (`pnpm-lock.yaml` integrity hash false positive; one `deploy-functions.yml` comment citing R-W2-01 in TS1).
- TS1 read-only zone untouched.

## Risks closed

- R-W1-CHASSIS-01. Substrate completion. Closed by Track A.
- R-W1-CHASSIS-02. Three-gate auth taxonomy. Closed by Track B.
- R-W1-CI-01. `migrate.yml` reverse-gating. Closed by Track C.
- R-W1-CI-02. `head_sha` pin on functions deploy. Closed by Track C.
- R-W1-CI-03. Bundle budget gate. Closed by Track C (already correct; verified).
- R-W1-COPY-01. Em dash in Wave 1 journal. Closed by Phase 0 hygiene fix.

## Follow-ups (Wave 2 and beyond)

- F-Wave1-FONTS-01. Drop the self-hosted woff2 files into `apps/web/public/fonts/`. Source per the README placeholder.
- F-Wave2-API-01. Wire `/auth-api/me` (Wave 2 Agent A) so `useMe` and `Topbar` org switcher activate.
- F-Wave2-API-02. Wire `/tenants-api/branding` so `useBranding` and `BrandingProvider` light up.
- F-Wave2-API-03. Replace the `useOrgFlagsStub()` in `Sidebar.tsx` with a real `useOrgFlags()` against `org_feature_flags`.
- F-Wave2-INFRA-01. Source `STAGING_SUPABASE_URL`, `STAGING_SUPABASE_ANON_KEY`, `STAGING_SUPABASE_SERVICE_ROLE_KEY` from `supabase branches get staging` and set as GitHub Actions secrets before Phase 6.
- F-Wave2-CANON-01. Operator-gated reconciliation: update `Cowork Output/CLAUDE.md` "Idempotency" bullet and `AUDIT.md` Section 2 "Idempotency PK" row to read `(key, user_id, org_id, route_hash)` per D-010.
- F-Wave2-LINT-01. Decide whether to install `eslint-plugin-react-refresh`. Three disable directives were removed this wave; reinstall the plugin if Fast Refresh boundary discipline is wanted.
- F-Wave2-API-04. Add `IDEMPOTENCY_KEY_REQUIRED` and `IDEMPOTENCY_INVALID_KEY` to the `ApiErrorCode` literal union in `responses.ts` for first-class typing.
- F-Wave2-API-05. `responses.ts` `ok()` mints a fresh `x-request-id` rather than echoing the caller's. Decide on a `route.ts`-level request_id authority.
- F-Wave3-TEST-01. Drop `apps/web/playwright.config.ts` and the RLS probe spec so `test:rls` and `test:e2e` can actually run.
- F-Wave2-BUILD-01. `pages/NotFoundPage.tsx` is both statically and dynamically imported (`App.tsx` static, `routes.ts` lazy). Pick one and update the other.

## Constitutional invariants verified

- Money is integer cents end-to-end. Parity tests green.
- RLS rules unchanged (no migrations this wave).
- Idempotency: PK shape per D-010; Idempotent-Replay header emitted; UUID v4 strictly validated.
- Audit log: hash chain still active; this wave adds a non-state-change `writeAudit` helper with explicit doc comments that DB triggers remain primary.
- Migrations: zero new migrations; forward-only rule preserved.
- Zod canon: byte-mirror intact; `_shared/types.ts` and `apps/web/src/lib/types.ts` unchanged.
- Workflow parity: byte-mirror intact.
- Capabilities: matrix unchanged; `requireCap` helper added to `handler-helpers.ts`.
- Bundle budget: 21.62 kB / 40 kB.
- No banned dependencies introduced.
- No em dashes, double hyphens, or emojis in user-facing copy.
- No "Built to Deliver", "Team 1", or "TS1" in product copy.
- JWT claim shape: `kitstak_org_id`, `kitstak_org_role`.
