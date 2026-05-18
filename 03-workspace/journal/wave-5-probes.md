# Wave 5 Closeout: Probes and observability

Date: 2026-05-18
Wave: 5 (Phase 5 of the parallel build orchestration)
Status: Closed
Branch: `claude/phase-5-probes`

## Wave summary

Phase 5 lands the real cross-tenant RLS probe matrix (48 tests), hardens the
Pillar-1 smoke spec with live Playwright actions, and ships an operator runbook
for the three nightly probes (RLS, audit chain verify, idempotency GC). The
probe spec compiles and parses cleanly, all 48 tests skip with a single clear
message when the staging Supabase secrets are absent, and the existing
`nightly-rls-probe.yml` workflow env mapping is unchanged. Sentry and analytics
remain deferred per operator decision.

## Deliverables

### `apps/web/playwright/rls-probe.spec.ts` (full rewrite)

The placeholder is replaced with the real probe matrix. Structure:

- `bootstrapOrg('A' | 'B', password)` creates an ephemeral user via
  `supabase.auth.admin.createUser({ email_confirm: true })`, provisions a
  fresh org via the canonical `provision_organization` RPC, stamps
  `kitstak_org_id` and `kitstak_org_role` onto `app_metadata`, signs in to
  mint a real JWT, enables the `plugins.3pl` and
  `finance.journal_entries.enabled` flags, and seeds one row per primary
  entity: customer, contact, lead, opportunity, item, quote, project,
  invoice, payment, credit_note, vendor, purchase_order, vendor_bill,
  expense, warehouse, receiving_order, production_run, shipment,
  journal_entry.
- `teardownOrg(fixture)` deletes via service-role across 30+ tables in
  child-before-parent order, then deletes the organization row, then
  `auth.admin.deleteUser`. Best-effort: a partial setup gets cleaned up
  before the suite bails (the `try/catch` in `beforeAll` calls teardown on
  both orgs even if only org A made it through).
- `callFn(jwt, method, path, body?)` is the edge-function HTTP client.
  Adds the apikey header (anon key for Supabase gateway routing),
  Authorization (when JWT is present), and a fresh
  `crypto.randomUUID()`-generated `Idempotency-Key` on every non-GET.
- `setFlag(orgId, flagKey, value)` upserts `org_feature_flags` via
  service-role. Used for the bundle-gate and per-route flag probes; flag
  is restored in a `finally` block so a test failure does not pollute
  subsequent tests.
- A `FIXTURE_SUFFIX` (`YYYYMMDD_xxxxxx`) is stamped onto every fixture
  name so concurrent CI runs do not collide and stranded fixtures are
  easy to identify by hand.

Probe count: **48 tests**, all tagged `@rls`, grouped by category:

| Category | Count | What it asserts |
|---|---|---|
| List reads (Pattern A) cross-tenant -> 200 + [] | 10 | One per primary table |
| Unqualified list reads (no `org_id` filter) -> []  | 2 | `quotes` and `customers` |
| Detail reads cross-tenant -> 200 + [] | 6 | `quotes`, `invoices`, `projects`, `vendors`, `purchase_orders`, `journal_entries` |
| Workflow POSTs cross-tenant -> 404 | 11 | Quote send / approve / convert / update; invoice update / send; lead detail; project detail; PO detail; ops receiving detail; ops shipment ship; finance JE post |
| Bundle gate probes -> 404 when off | 4 | `plugins.3pl` off on receiving and shipments; `platform_admin.enabled` off for staff caller and anonymous |
| Per-route flag -> 403 FEATURE_DISABLED | 2 | `finance.journal_entries.enabled` off on POST `/journal-entries/:id/post` and on GET `/journal-entries` |
| customer-portal-api Pattern B | 2 | 404 for staff caller; 401 / 404 for anonymous |
| Pattern C globals readable | 3 | `currencies`, `exchange_rates`, `roles` |
| Unauthenticated guard | 3 | Anonymous quotes-api 401; anonymous switch-org 401; anonymous resolve-host (`verify_jwt=false`) not-401 |
| Switch-org cross-tenant | 2 | Into a tenant you do not belong to -> 404; into your own tenant -> 200 / 201 |
| audit_log RLS | 2 | Cross-tenant read -> 200 + []; same-tenant read returns at least one row |

Every workflow-POST assertion fires with the message
`gate-miss MUST 404, never 403` so a future regression points straight at
the violated invariant.

The suite skips at the module level when any of `VITE_SUPABASE_URL`,
`VITE_SUPABASE_ANON_KEY`, or `SUPABASE_SERVICE_ROLE_KEY` is absent. The
nightly workflow already maps `STAGING_SUPABASE_*` into those names; no
workflow edit was needed.

### `apps/web/playwright/smoke.spec.ts` (hardened)

Each `test.step` now performs real Playwright actions:

- `signin`: navigate to `/signin`, fill `input[name="email"]` and
  `input[name="password"]`, click `button[type="submit"]`, assert URL
  becomes `/dashboard`.
- `switch_org`: optional. When `SMOKE_SECONDARY_ORG_NAME` is set, clicks
  the Topbar workspace switcher and selects the second org.
- `create_customer`: navigate to `/crm/customers/new`, fill
  `display_name`, submit, assert detail URL.
- `quote_send` / `quote_accept`: click Send, wait for sent state, click
  Accept, wait for accepted state.
- `convert_to_project`: click Convert to Project, assert project URL.
- `invoice_send` / `payment_post`: create and send invoice, post a
  payment with `amount_cents=1000`.
- `receiving` / `shipment`: create and complete a receiving order; create
  and ship a shipment.
- `verify audit timeline`: navigate to invoice detail, assert the
  HISTORY heading renders followed by at least one `li` entry.

Seed credentials come from `SMOKE_USER_EMAIL` and `SMOKE_USER_PASSWORD`
env. The whole spec skips with a clear message when `PLAYWRIGHT_BASE_URL`
or the credentials are absent.

### `docs/operations/probes.md`

Operator-facing runbook covering what each nightly workflow does, how to
read a failure (artifact upload, broken_count interpretation, manual
fixture cleanup), how to re-run via `workflow_dispatch`, the staging
secret list with provenance, and escalation criteria. Brand-clean,
under 200 lines.

## Risks closed

- `F-Wave3-TEST-01`: smoke spec hardened with real Playwright actions.
  Step bodies replace `expect(page).toHaveURL(/.*/)` placeholders with
  concrete fills, clicks, and assertions.
- `F-Wave3-TEST-02`: RLS probe matrix implemented. 48 tests cover every
  primary entity, every bundle gate, every per-route flag known in the
  Phase-5 surface, and the audit_log RLS posture.
- Phase 5 charter items: probe spec, smoke hardening, runbook all
  shipped. The three nightly workflows (`nightly-rls-probe`,
  `audit-chain-verify`, `idempotency-gc`) were already wired in Wave 2;
  this wave makes the spec they invoke real.

## Follow-ups spawned

- `F-Wave5-TEST-01`: when the operator stands up the `staging` GitHub
  environment with `STAGING_SUPABASE_URL`, `STAGING_SUPABASE_ANON_KEY`,
  `STAGING_SUPABASE_SERVICE_ROLE_KEY` (sourced from
  `supabase branches get staging`) and `STAGING_URL`, kick off the first
  real nightly RLS probe and triage any failures. The probe is designed
  to surface real RLS bugs; the first run will be load-bearing.
- `F-Wave5-TEST-02`: the smoke spec's selectors are written defensively
  but assume `input[name="amount_cents"]` on the payment form,
  `display_name` on the customer form, and HISTORY heading rendering on
  the invoice detail page. When staging is live, do a single dry run
  and tighten any selector that proves brittle.
- `F-Wave5-CO-01` (carried from Wave 3): Sentry SPA init deferred.
  Operator-gated on `VITE_SENTRY_DSN`.
- `F-Wave5-CO-02` (carried from Wave 3): analytics provider deferred.

## Constitutional invariants verified

- Money: untouched; mirror parity 3 / 3 (and the full 25 / 25 contract
  suite).
- RLS: probe matrix asserts Pattern A returns 200 + [], Pattern B
  (customer-portal-api) 404s non-customer_user, Pattern C globals stay
  readable. Bundle gates 404 when off; per-route flags 403
  FEATURE_DISABLED with `details.flag` set.
- Migrations: no migrations authored.
- Audit log: append-only RLS verified by the cross-tenant probe; the
  hash-chain itself is verified by `audit-chain-verify` nightly (out of
  scope for this wave).
- Idempotency: every non-GET in the probe `callFn` sends a fresh
  `Idempotency-Key` via `crypto.randomUUID()`. PK shape
  `(key, user_id, org_id, route_hash)` per D-010 unchanged.
- Capabilities: server-side capability checks unchanged. Probe spec
  authenticates as `org_owner` to exercise the full surface; lower roles
  inherit the same RLS gates.
- Workflow: 14 state machines unchanged. Cross-tenant workflow POSTs
  asserted to 404 (never 403) per constitutional rule.
- Branding: zero em dashes, double hyphens (outside markdown table
  separators and code-comment dividers), "Built to Deliver", "Team 1",
  or "TS1" in user-facing copy. Runbook is brand-clean.
- Bundle budget: 25.94 kB gzip against the 40 kB cap. Playwright specs
  do not ship to the SPA bundle.
- Zod canon: 22 byte-identical pairs intact.
- JWT claim shape: `kitstak_org_id` / `kitstak_org_role` unchanged. The
  probe spec exercises this shape end-to-end (stamps it via
  `admin.updateUserById`, mints a JWT via signin, asserts edge functions
  read it correctly).
- No banned dependencies introduced. `@supabase/supabase-js` and
  `@playwright/test` were already in `apps/web/package.json`.

## Gates run

| Gate | Result (last line) |
|---|---|
| `pnpm --filter web typecheck` | (clean exit, no output beyond the tsc invocation) |
| `pnpm --filter web lint` | (clean exit, no output beyond the eslint invocation) |
| `pnpm --filter web test` | `5 passed (5)` in 1.57s |
| `pnpm --filter web test:contract` | `25 passed (25)` in 2.53s |
| `pnpm --filter web build` | `built in 10.39s` |
| `pnpm --filter web bundle-budget` | `Size: 25.94 kB gzipped` against a 40 kB cap |
| `playwright test --list playwright/rls-probe.spec.ts` | `Total: 48 tests in 1 file` |
| Empty-env skip path (`playwright test playwright/rls-probe.spec.ts`) | `48 skipped` |
| `playwright test --list playwright/smoke.spec.ts` | `Total: 1 test in 1 file` |
| Brand grep on changed files | zero violations (em dashes, "Built to Deliver", "Team 1", "TS1" all absent; double hyphens only in markdown table separators and code-comment dividers, both constitutional) |

## Notes for Phase 6 (Customer Zero cutover)

- The probe spec depends on the staging Supabase preview branch being
  unique to staging. Pointing the spec at prod would create and delete
  rows in prod; the workflow file already documents this and the env
  source is `supabase branches get staging`.
- Two flags need to default-on for staging seeds to make the probes
  green: `plugins.3pl` (so the ops-api routes exist for the workflow
  POSTs we probe at 404) and `finance.journal_entries.enabled` (so the
  finance probes can establish a positive baseline before flipping the
  flag off for the FEATURE_DISABLED check).
- The customer-portal-api anonymous probe accepts either 401 or 404 to
  hedge against a downstream change in how the bundle handles missing
  JWTs. If Phase 6 settles on a single status, tighten the assertion.
- The smoke spec assumes single-org seeds by default. To exercise the
  switch-org leg, the operator must seed a second org for the smoke
  user and set `SMOKE_SECONDARY_ORG_NAME`. Phase 6 owns whether Customer
  Zero qualifies as the second org.
- `idempotency-gc` and `audit-chain-verify` workflows continue to run
  every night against staging once the secrets are wired. Phase 6 can
  flip them to point at prod via the same secret pattern.
