# Wave 1 Closeout: Identity, Tenancy, Branding

Date: 2026-05-17
Wave: 1
Status: Closed

## Wave summary

Wave 1 turns the Wave 0 chassis into a working multi-tenant product. Real auth replaces the placeholder sign-in. Tenants are seated atomically by a single RPC. The branding system reads from the database and repaints the SPA at runtime through CSS variables. The first state machine, the first auto-state-transition audit trigger, and the chain verifier all ship together so the audit invariant is real, not aspirational.

## Deliverables

### Backend (migration 0002)
- `organizations.status` check extended to admit `provisioning`.
- `trg_audit_organizations_status` AFTER UPDATE trigger writing per-transition rows to `audit_log` with a per-org SHA-256 hash chain. Serialised by `pg_advisory_xact_lock` keyed on `org_id`.
- `kitstak_audit_canonical(jsonb) → text` helper used by both the trigger and the verifier so chain math has one definition.
- `verify_audit_chain(p_org_id uuid)` RPC returning the first broken row or empty.
- `provision_organization(slug, display_name, owner_user_id, owner_email)` RPC: atomic insert of organization (in `provisioning`), profile, owner membership, default branding, then transition to `active` (fires the trigger). Re-runs with the same slug return the existing org id, no mutation.
- `sso_connections` (Pattern A RLS) and `saml_configs` (Pattern B RLS). Schema only.
- Every new function is `SECURITY DEFINER`, `SET search_path = public`, with explicit grants. Authenticated cannot invoke `provision_organization`; service-role only.

### Edge Functions
- `supabase/functions/idempotency-gc/index.ts`: nightly DELETE on `idempotency_keys WHERE created_at < now() - 7d`. Auth via shared `GC_TRIGGER_SECRET` bearer.
- `supabase/functions/audit-chain-verify/index.ts`: iterates every non-deleted org, invokes `verify_audit_chain`, returns a JSON envelope with `checked_org_count`, `broken_count`, and the broken rows. Auth via shared `AUDIT_VERIFY_SECRET` bearer.

### SPA
- `apps/web/src/lib/auth.tsx`: `AuthProvider` plus `useAuth`. Wires `supabase.auth.getSession`, `onAuthStateChange`, `signInWithPassword`, and `signOut`. Status surfaces as `loading | authenticated | anonymous`.
- `apps/web/src/lib/branding.tsx`: `BrandingProvider` plus `useBranding`. On auth change, fetches `org_branding`, parses hex colors to space-separated RGB triplets, sets `--bg`, `--brand`, `--accent`, `--ink`, `--font-sans` on `document.documentElement`. Falls back to compiled-in defaults when anonymous.
- `apps/web/src/components/shell/RequireAuth.tsx`: route guard rendering a loading state, redirecting `anonymous` to `/sign-in` with `from` state, and passing `authenticated` through.
- `apps/web/src/pages/SignInPage.tsx`: real submit. Renders server errors inline. Authenticated users redirect away from the surface.
- `apps/web/src/pages/DashboardPage.tsx`: shows `app_name_override` when set; sign-out button calls `signOut`.
- `apps/web/src/App.tsx`: dashboard route now wrapped in `RequireAuth`.
- `apps/web/src/main.tsx`: provider tree extended with `AuthProvider` and `BrandingProvider`.
- `apps/web/tailwind.config.js`: `bg.DEFAULT`, `ink.DEFAULT`, `accent.DEFAULT` resolve through `rgb(var(--x) / <alpha-value>)`. `font-sans` reads from `--font-sans`.
- `apps/web/src/styles.css`: `:root` declares the default CSS variables for the runtime-overridable surfaces.

### Canon
- `apps/web/src/lib/types.ts` and `supabase/functions/_shared/types.ts`: `OrgStatusSchema` adds `provisioning`; `SsoProviderSchema` and `SsoConnectionSchema` added. Byte-mirrored.
- `apps/web/src/lib/workflow.ts` and `supabase/functions/_shared/workflow.ts`: declares `ORGANIZATION_FSM` (states and transitions) plus the `Fsm`, `FsmTransition`, `canTransition` primitives. Byte-mirrored.
- `apps/web/src/lib/capabilities.ts` and `supabase/functions/_shared/capabilities.ts`: 14 capability codes, `CAPABILITIES_BY_ROLE` for all eight roles, `hasCap(role, cap)`. Byte-mirrored.

### Tooling
- `apps/web/test/contract/parity.test.ts`: reads both copies of each canon file and asserts byte equality.
- `apps/web/test/contract/money.parity.test.ts`: imports both `money.ts` modules and asserts behaviour parity for `roundHalfEven`, `formatCents`, and `ZERO_DECIMAL_CURRENCIES`.
- `apps/web/package.json`: adds `test:contract` script (`vitest run test/contract`).
- Root `package.json`: adds `test:contract` forwarding to the workspace.
- `apps/web/tsconfig.json`: include extended to `["src", "test"]`; `@types/node` added so `node:fs` and `node:url` resolve.
- `.github/workflows/ci.yml`: runs `pnpm --filter web test:contract` between `test` and `build`.
- `.github/workflows/idempotency-gc.yml`: daily at 08:30 UTC, posts to the Edge Function with the shared secret.
- `.github/workflows/audit-chain-verify.yml`: daily at 09:00 UTC, fails the run if `broken_count != 0`.

### Documentation
- `STATUS.md` updated to Wave 1 closed, Wave 2 scope drafted.
- `CHANGELOG.md` `0.0.2` entry covering every deliverable.
- This journal.

## Schema changes

Migration 0002 introduces:
- One CHECK relaxation on `organizations.status` (forward-only; drops the old constraint, adds the wider one).
- One immutable helper (`kitstak_audit_canonical`).
- One trigger function plus trigger (`trg_audit_organizations_status`, `audit_organizations_status`).
- One verifier RPC (`verify_audit_chain`).
- One provisioning RPC (`provision_organization`).
- Two new tables with RLS (`sso_connections`, `saml_configs`).

No backfill required. No data loss. Forward-only.

## Risks

| ID                 | Title                                                  | Status   | Notes |
|--------------------|--------------------------------------------------------|----------|-------|
| R-W1-AUTH-01       | Real Supabase Auth wiring                              | Closed   | `AuthProvider` plus `RequireAuth` ship. |
| R-W1-BRAND-01      | Branding runtime injection                             | Closed   | Tailwind tokens resolve through CSS vars; BrandingProvider mutates them on auth change. |
| R-W1-PROVISION-01  | Atomic tenant provisioning                             | Closed   | `provision_organization` in one transaction. |
| R-W1-FSM-01        | First state machine plus audit trigger                 | Closed   | `organizations.status` FSM plus `audit_organizations_status` trigger with per-org hash chain. |
| R-W1-AUDIT-01      | Audit chain verifier (RPC plus nightly workflow)       | Closed   | `verify_audit_chain` plus `audit-chain-verify` Edge Function plus `.github/workflows/audit-chain-verify.yml`. |
| R-W1-IDEMP-01      | Nightly idempotency GC                                 | Closed   | `idempotency-gc` Edge Function plus `.github/workflows/idempotency-gc.yml`. |
| R-W1-SSO-01        | SSO/SAML schema                                        | Closed   | Schema only. Provider integration carried as `R-W2-CO-SSO-01`. |
| R-W1-CONTRACT-01   | `pnpm test:contract` byte-parity runner                | Closed   | Byte-parity plus money behaviour parity tests; wired into CI. |
| R-W1-FSM-02        | Audit trigger raised `42883 digest does not exist`     | Closed   | Surfaced on first `provisioning → active` transition. `set search_path = public` excluded the `extensions` schema where `pgcrypto.digest` lives. Migration `0003_fix_audit_search_path.sql` fully-qualifies the call as `extensions.digest`. |

## Carried to Wave 2

| ID                  | Title                                                  |
|---------------------|--------------------------------------------------------|
| R-W2-CO-SSO-01      | SSO/SAML provider integration (Edge Function plus IdP redirect) |
| R-W2-CO-REQCAP-01   | `requireCap(caller, cap)` helper in `_shared/auth.ts` and first state-changing handler exercising it |
| R-W2-CO-INVITE-01   | `org_invitations` FSM, accept/revoke RPCs              |
| R-W2-CO-RLSPROBE-01 | `pnpm test:rls` cross-tenant probe matrix              |
| R-W2-CO-E2E-01      | Playwright sign-in smoke flow                          |

## Follow-ups (operator)

| ID            | Status      | Title                                                        |
|---------------|-------------|--------------------------------------------------------------|
| F-Wave1-01    | Partial     | Operator org `kitstak` seated with `mike@kitstak.com` as `org_owner`. App_metadata claims `kitstak_org_id` and `kitstak_org_role` populated. Acme Corp demo org still to be provisioned when a real demo customer is identified. |
| F-Wave1-02    | Done        | `GC_TRIGGER_SECRET`, `AUDIT_VERIFY_SECRET`, `SUPABASE_FUNCTION_URL` set in GitHub Actions secrets (plus Vercel triplet and Supabase triplet — nine total). |
| F-Wave1-03    | Done        | Both Edge Functions deployed via MCP at v1 (`verify_jwt=false`; bearer-secret auth via Edge Function env). Secrets set via Supabase Management API. Smoke-tested with valid bearer: `audit-chain-verify` returns `{checked_org_count: N, broken_count: 0}`; `idempotency-gc` returns `{deleted: 0, cutoff: <iso>}`. |
| F-Wave1-04    | In flight   | Nightly workflows scheduled (08:30 UTC and 09:00 UTC). Manual smoke-test green. Seven-day streak clock starts on the first scheduled run after 2026-05-18. |
| F-Wave1-05    | Done        | `apps/web/src/lib/database.types.ts` regenerated from the live schema (MCP `generate_typescript_types`). Deliberately gitignored per `.gitignore:7`; local artifact only. |
| F-Wave1-06    | Pending     | Rotate credentials that touched chat during Wave 1 deploy: Vercel token, Supabase access token, DB password, `GC_TRIGGER_SECRET`, `AUDIT_VERIFY_SECRET`. One-click each in their respective dashboards, then re-run `gh secret set` (and POST to the Supabase secrets API for the two shared secrets). |
| F-Wave1-07    | Pending     | Secure or delete `C:\Users\Mike Lunsford\Desktop\KitStak\Docs\SUPABASE ENV.MD`. Single plaintext file with every credential for the project is a single point of failure. |

## Constitutional invariants verified

- **Money** untouched. Byte-parity plus behaviour-parity tests pass.
- **RLS**: every new tenant-scoped table (`sso_connections`, `saml_configs`) carries Pattern A or Pattern B from the migration that creates it. No table escaped without a policy. Authenticated cannot INSERT into `audit_log`; service-role / trigger writes only.
- **Idempotency**: scheduled GC ships. Per-tenant cleanup remains operator-free.
- **Audit**: trigger is the sole writer for `organizations.status` transitions. `kitstak_audit_canonical` is shared between trigger and verifier so chain math cannot diverge. Per-org `pg_advisory_xact_lock` serialises concurrent writers within a transaction. Nightly verifier fails CI on a broken chain.
- **Capabilities**: 14 codes seeded across the eight-role policy in byte-mirrored canon. `requireCap` arrives in Wave 2 with the first state-changing handler.
- **Zod canon**: four byte-mirrored files (types, workflow, capabilities, money); drift is a release blocker enforced by `pnpm test:contract` in CI.
- **Migration rules**: `0002_identity_branding_provisioning.sql` and the hotfix `0003_fix_audit_search_path.sql` are forward-only, idempotent, carry the required header (Wave, Phase, Closes, DOWN MIGRATION, date), and align with each constitutional rule. 0003 was authored under the operator's explicit plain-text approval per the "stop and confirm on audit_log changes" rule.
- **Banned dependencies**: untouched. No new top-level dependency. `@types/node` is a devDependency required by the contract test runner (`node:fs`, `node:url`); not in the runtime bundle.
- **Branding**: server-rendered. SPA reads `org_branding` through Supabase under the user's RLS scope. No client-side persistence of branding values.
- **Copy**: no em dashes, double hyphens, or emojis in user-facing copy. Verified.
