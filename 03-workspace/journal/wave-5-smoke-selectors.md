# Wave 5 smoke selectors dry-run (F-Wave5-TEST-02)

Date: 2026-05-20
Author: Phase 9 follow-up batch
Closes: `F-Wave5-TEST-02`
Spawns: `F-Wave5-TEST-02-CHAIN-01`

## Scope

Static dry-run of every selector in `apps/web/playwright/smoke.spec.ts` against
the actual SPA route table (`apps/web/src/routes.ts`), the actual create-page
DOM (the SPA pages under `apps/web/src/pages/`), and the actual quote FSM
(`apps/web/src/lib/workflow/sales.ts`). No live run against staging executed in
this PR because `PLAYWRIGHT_BASE_URL` / `SMOKE_USER_EMAIL` / `SMOKE_USER_PASSWORD`
were not available to the agent. Operator-side activation instructions captured
below.

## Findings

The original smoke spec (chassis at PR #8, the same PR that landed the
playwright config and the RLS probe) had not been touched since wave 3. Five
months of SPA evolution under it. Every category of selector had drifted.

### 1. Route paths: 5 of 7 wrong

| Spec target | Actual SPA route | Source |
| --- | --- | --- |
| `/quotes/new` | `/3pl-operations/quotes/new` | `routes.ts` |
| `/invoices/new` | `/invoicing/invoices/new` | `routes.ts` |
| `/payments/new` | `/3pl-operations/payments/new` | `routes.ts` |
| `/ops/receiving/new` | `/3pl-operations/receiving/new` | `routes.ts` |
| `/ops/shipments/new` | `/3pl-operations/shipments/new` | `routes.ts` |

Post-create redirects were also wrong: the spec asserted
`/payments/[0-9a-f-]+` but `PaymentCreatePage` navigates to
`/invoicing/invoices/:id` (when an invoice was pre-allocated) or
`/invoicing/payments` (otherwise). No `/payments/:id` route exists at all.

### 2. Form-field name attributes: 2 sites missing

The spec asserts `input[name="display_name"]` on the customer create form and
`input[name="amount_cents"]` on the payment create form. Neither attribute
existed on the underlying SPA inputs (`CustomerCreatePage`'s `<input>` and
`PaymentCreatePage`'s `<TextInput>` neither passed a `name` prop). The
canonical fix here is method (b) from the task brief: add the `name=`
attribute to the SPA element so the spec has a stable selector that survives
text/label refactors.

### 3. Quote FSM sequence wrong

The spec called `getByRole('button', { name: /send/i })` then
`getByRole('button', { name: /accept|approve/i })`. The actual `QUOTE_FSM`
order on `QuoteDetailPage.tsx` is: `draft` (Submit visible) → `submitted`
(Approve visible) → `approved` (Send visible) → `sent` (Convert to project
visible). Sending without first submitting + approving is a no-op (the button
is absent from the DOM). The Convert step then redirects to
`/3pl-operations/projects/:id`, not `/projects/:id`.

### 4. AuditTimeline structure mismatch

The spec used `page.locator('section:has(:text("HISTORY")) li')`. The actual
shape: parent detail pages render `<section><h2>HISTORY</h2><AuditTimeline /></section>`,
and `AuditTimeline` itself renders `<ol class="space-y-2"><li>...</li></ol>`.
The CSS selector `section:has(:text("HISTORY")) li` resolves correctly in
modern Chromium, but only after `query.data` arrives. An empty audit_log
renders `<div>No history yet.</div>` instead of the `<ol>`, so the
"first li visible" assertion would hard-fail on a freshly-created entity even
in the happy path.

Replaced with a stable `data-testid="audit-timeline"` on the `<ol>`, plus a
`Promise.race` that accepts either the timeline OR the "No history yet."
empty state as a successful render.

### 5. Workspace switcher selector mismatch

The spec used `getByRole('button', { name: /workspace/i })`. The actual
Topbar button has accessible name = the active org display name (e.g.
"Acme Logistics"), not "workspace". The original spec's defensive
`isVisible({ timeout: 2_000 }).catch(() => false)` swallowed this so the
leg was non-fatal, but the assertion produced zero coverage.

Added `aria-label="Workspace switcher"` to the button (improves a11y for
screen readers too) and a `data-testid="workspace-switcher"` for the
canonical selector. The dropdown items use `role="menuitemradio"`, not
`menuitem`; spec updated.

### 6. Write-path steps require FK pickers (the unfixable-with-selectors-alone class)

This is the deepest finding and the reason the spec is being narrowed.
Every create page that the original spec drove with a single
`button[type="submit"]` click has at least one required FK field that
must be picked from a typeahead component, not filled into an input by
name. Specifically:

- `QuoteCreatePage` requires `customer_id` via `CustomerPicker`.
- `InvoiceCreatePage` (audited but not deeply read here) requires
  `customer_id` likewise.
- `PaymentCreatePage` requires `customer_id` plus `payment_number` plus
  `amount_cents`.
- `ReceivingOrderCreatePage` requires `warehouse_id` via the warehouses
  list dropdown, plus a JSON payload of line items.
- `ShipmentCreatePage` shape (not deeply audited in this pass) is similar.

A "click empty form, submit" smoke fails Zod validation on every one of
these. The honest paths forward:

1. **Seed staging** with a known fixture set: one customer, one warehouse,
   one item, one vendor, plus the `finance.journal_entries.enabled` flag.
   Document the seed shape in the spec header so a future engineer can
   reproduce it. Drive each picker by clicking the picker, then clicking
   the row whose display_name matches the seed. This requires the
   pickers to expose stable selectors (`data-testid` on
   `CustomerPicker` etc.).
2. **Ephemeral fixtures**: extend the smoke spec with the same
   service-role bootstrap pattern as `rls-probe.spec.ts`. `beforeAll`
   creates customer + warehouse + item via the Supabase admin client;
   `afterAll` tears down. This makes the spec self-sufficient on any
   preview branch but requires `STAGING_SUPABASE_SERVICE_ROLE_KEY` in
   the smoke job env (the rls-probe job already has it).

Both paths are filed as `F-Wave5-TEST-02-CHAIN-01`. The quote-to-cash
chain is preserved in the spec as a `test.skip(...)` block with inline
TODOs documenting every picker that needs to be driven, so when the
operator decides which path to take, the work is staged.

## Changes shipped in this PR

### Spec rewrite (`apps/web/playwright/smoke.spec.ts`)

- Top-level describe stays `test.skip` when `PLAYWRIGHT_BASE_URL` /
  `SMOKE_USER_EMAIL` / `SMOKE_USER_PASSWORD` are absent (unchanged from
  chassis).
- Active test `@smoke pillar-1 sign-in + shell load` walks three steps
  that are exercisable without write-path FK fixtures: sign in, assert
  workspace switcher renders, audit-timeline coverage on a seeded
  invoice URL (gated on new optional `SMOKE_SEEDED_INVOICE_URL` env var).
- Quote-to-cash chain preserved as `test.skip(...)` with corrected
  routes, FSM order, and inline TODOs referencing
  `F-Wave5-TEST-02-CHAIN-01`.
- Header comment documents the four selector contracts the spec
  depends on so future SPA refactors know what not to break.

### SPA selector-contract additions (3 sites, all additive)

- `apps/web/src/components/shell/Topbar.tsx`: workspace switcher button
  gains `data-testid="workspace-switcher"` and `aria-label="Workspace switcher"`.
  Improves a11y baseline alongside enabling the smoke selector.
- `apps/web/src/components/shell/AuditTimeline.tsx`: `<ol>` gains
  `data-testid="audit-timeline"`.
- `apps/web/src/pages/crm/customers/CustomerCreatePage.tsx`: display_name
  `<input>` gains `name="display_name"` (already had `value` / `onChange`
  via controlled state; `name` is purely a selector contract).
- `apps/web/src/pages/3pl-operations/payments/PaymentCreatePage.tsx`:
  amount `<TextInput>` gains `name="amount_cents"`.

## Live dry-run NOT executed in this PR

Per the task brief: "If you can't get a working staging URL OR working
test credentials, do NOT fabricate 'it passes' — produce the report
describing what's blocking." The agent did not have access to a staging
SPA URL or seeded test credentials. The smoke spec is therefore wired
to test.skip in the agent's environment and was not run.

### Operator action to flip from "static-verified" to "live-verified"

1. Confirm the staging Supabase preview branch `dnkgaufydcnedgkuoyml.supabase.co`
   is alive (per D-009, source of truth is `supabase branches get staging`).
2. Confirm a staging SPA URL exists (Vercel preview alias against the
   staging branch, or a `staging.kitstak.com` subdomain). Check
   `STAGING_URL` secret under the GH Actions `staging` environment;
   if absent, provision it.
3. Create a dedicated `smoke@kitstak.com` (or similar) operator user in
   the staging seed org. Capture the password in `1Password` or the
   operator's existing secret manager; set `SMOKE_USER_EMAIL` and
   `SMOKE_USER_PASSWORD` under the GH Actions `staging` environment.
4. (Optional but recommended) capture the canonical URL of one seeded
   invoice with audit_log history and set `SMOKE_SEEDED_INVOICE_URL`,
   so the audit-timeline step gets real coverage rather than skipping.
5. Run locally:
   ```
   PLAYWRIGHT_BASE_URL=https://staging-url \
   SMOKE_USER_EMAIL=smoke@kitstak.com \
   SMOKE_USER_PASSWORD=... \
   pnpm --filter web exec playwright test --grep @smoke
   ```
6. If green: wire a new `nightly-smoke.yml` workflow modelled on
   `nightly-rls-probe.yml` (skip-guard on the secrets, same Node 22 /
   Playwright Chromium baseline). Land it in a separate PR per the
   task brief.

## Constitutional invariants verified

- No new top-level dep.
- No migration.
- No RLS / audit_log / idempotency / capability surface touched.
- No em dashes, double hyphens, or emojis added.
- Forward-only: no edits to numbered migration files.
- Money rules untouched.
- Zod canon untouched.

## Test posture

- `pnpm --filter web typecheck`: green.
- `pnpm --filter web lint`: green.
- `pnpm --filter web test`: 22 passed + 2 skipped (unchanged from
  baseline `7fcf022`).
- `pnpm --filter web test:contract`: not re-run (no canon edits).
- `pnpm --filter web test:e2e`: skips in this environment by design;
  staging credentials required as documented.

## Carryover filed

- `F-Wave5-TEST-02-CHAIN-01`: expand the smoke into a real
  quote-to-cash chain, either via documented staging seed or via
  ephemeral service-role fixtures (preferred). Picker components
  (`CustomerPicker`, `WarehousePicker`, etc.) should grow
  `data-testid` contracts so the chain spec can typeahead-pick known
  fixtures without text-match fragility.
