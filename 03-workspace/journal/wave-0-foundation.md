# Wave 0 Closeout: Foundation

Date: 2026-05-17
Wave: 0
Status: Closed

## Wave summary

Wave 0 establishes the Kitstak chassis. Repository scaffolded, foundational Postgres schema authored, sign-in surface rendered, CI/CD pipelines wired. Every constitutional invariant has its first sentinel in place.

## Deliverables

### Application shell
- `apps/web/package.json` plus the strict TypeScript, Vite, Tailwind config. No banned dependencies.
- `apps/web/src/main.tsx`, `App.tsx`, `routes.ts`. Flat ROUTES table.
- `apps/web/src/styles.css` with the design-token CSS variables.
- `apps/web/src/components/ui/Logo.tsx`. Two horizontal accent bars, full opacity above, 70% below, Bebas Neue wordmark.
- `apps/web/src/components/ui/Button.tsx`. Sharp-cornered, accent-on-navy primary, ghost and secondary variants.
- `apps/web/src/components/ui/TextInput.tsx`. Labeled, ink-on-bg-2 input with error slot.
- `apps/web/src/pages/SignInPage.tsx`. Zod-validated form, no react-hook-form.
- `apps/web/src/pages/DashboardPage.tsx`. Three-pillar marketing card grid, sized for the empty-state.
- `apps/web/src/lib/apiClient.ts`. Single fetch wrapper, envelope-parsing, automatic Idempotency-Key on non-GET.
- `apps/web/src/lib/supabase.ts`. Client wrapper guarded on env vars.
- `apps/web/src/lib/money.ts`. `roundHalfEven`, `formatCents`, `bigintReplacer`. Zero-decimal currency set.
- `apps/web/src/lib/money.test.ts`. Vitest spec for the rounding contract.
- `apps/web/src/lib/types.ts`. Zod canon for Org, Role, User, FeatureFlag, AuditEntry, IdempotencyKey, Branding.
- `apps/web/public/brand/favicon.svg`. Navy field with the accent bar pair.

### Backend
- `supabase/config.toml`. Project ref locked. Auth, storage, edge_runtime configured.
- `supabase/migrations/0001_foundation.sql`. organizations, roles, org_memberships, profiles, org_branding, org_feature_flags, idempotency_keys, audit_log. RLS on every tenant-scoped table. Role seed.
- `supabase/functions/_shared/types.ts`. Byte-mirror of the SPA Zod canon.
- `supabase/functions/_shared/money.ts`. Byte-mirror of the SPA money helpers.
- `supabase/functions/_shared/responses.ts`. `ok`, `created`, `noContent`, `fromApiError`, ApiError. CORS plus `x-request-id`.
- `supabase/functions/_shared/idempotency.ts`. `respondWithIdempotency` with canonical-JSON body hash and route hash.

### Tooling and infrastructure
- `.github/workflows/ci.yml`. Typecheck, lint, test, build on every PR and main push.
- `.github/workflows/deploy-preview.yml`. Vercel preview on every PR.
- `.github/workflows/deploy-prod.yml`. Vercel production on push to main.
- `.github/workflows/migrate.yml`. Gated on a successful prod deploy. Applies pending Supabase migrations.
- `vercel.json`. Build command, security headers, asset cache, SPA rewrites.
- `.eslintrc.cjs`. `no-restricted-imports` enforcing the banned dependency list.
- `.size-limit.cjs`. 40 kB gzip budget on the index chunk.

### Documentation
- `README.md`. Product story plus quick start plus stack table.
- `CLAUDE.md`. Constitution for AI agents.
- `CHANGELOG.md`. 0.0.1 entry covering everything above.
- `LICENSE`. Proprietary.
- `STATUS.md`. Current state plus Wave 1 scope.
- `DEFINITION-OF-DONE.md`. PR, wave, and v1 gates.
- `00-canon/01-architecture.md`. Architectural lock-ins.
- `docs/adr/0001-initial-stack.md`. The founding decisions.

## Schema changes

Migration 0001 ships eight tables and two helper functions:

- `current_org_id()` and `current_user_role()` resolve tenant scope from the JWT `app_metadata` claims.
- `organizations` carries the tenant identity with `status` and `region` columns from day one.
- `roles` holds the eight-role static set seeded by the migration.
- `org_memberships` joins users to orgs with one role.
- `profiles` mirrors auth.users with display metadata.
- `org_branding` holds the server-rendered theme.
- `org_feature_flags` stores per-tenant toggles with JSONB config.
- `idempotency_keys` keys on `(key, user_id, org_id, route_hash)` so the same UUID is safe to re-use across orgs and routes.
- `audit_log` is append-only via RLS and carries `prev_hash`, `payload_hash`, and a JSON metadata slot.

Every tenant-scoped table has its policy in the same migration that creates it.

## Risks

None open at Wave 0 closeout. Service-role key and DB password rotation is operator follow-up tracked outside this repo per the infrastructure record.

## Constitutional invariants verified

- Money is BIGINT cents. Helpers are byte-mirrored between SPA and edge. Vitest covers `roundHalfEven` and `formatCents`.
- RLS is on every tenant-scoped table from migration 0001. Pattern A is in use; Patterns B and C are scaffolded for the surfaces that need them in later waves.
- Idempotency infrastructure scaffolded: table, helper, route-hash + body-hash conflict semantics.
- Audit log scaffolded with hash-chain columns. The trigger writer and the verifier RPC arrive with the first state machine in Wave 1.
- Zod canon present in both `_shared` and `apps/web/src/lib`. A contract test enforces byte parity in Wave 1.
- Banned dependencies are absent from every `package.json`. ESLint `no-restricted-imports` is configured to fail fast on a future violation.
- Bundle budget configured at 40 kB gzip. The CI gate will run once the lockfile lands in the first PR.

## What carries to the next wave

- Real Supabase Auth wiring on the sign-in surface.
- `BrandingProvider` reading `org_branding` and injecting CSS variables at runtime.
- `provision_organization` RPC inside a single transaction.
- The first state machine plus its auto-state-transition audit trigger.
- `verify_audit_chain(org_id)` RPC plus the nightly verifier workflow.
- `idempotency-gc` scheduled Edge Function.
- `pnpm test:contract` runner that diff-checks the Zod canon byte-for-byte.

## Operator handoff (next manual steps)

1. Rotate the Supabase service-role key and DB password. Both were transmitted via chat earlier and must be treated as exposed.
2. Push the repo to `https://github.com/Mikelunsford/KitStak.git` on `main`.
3. Configure Vercel project environment variables: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_APP_ENV`, `VITE_APP_URL`. Add GitHub Actions secrets: `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`, `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF`, `SUPABASE_DB_PASSWORD`.
4. Apply migration 0001 to the prod Supabase project (`supabase link --project-ref zmnvwhqjahwidprnjxrq && supabase db push`).
5. Generate types: `supabase gen types typescript --linked > apps/web/src/lib/database.types.ts`.
6. Confirm the production deploy renders the Kitstak shell and the brand bar logo.
