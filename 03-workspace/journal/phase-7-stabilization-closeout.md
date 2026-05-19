# Phase 7 Stabilization Close-out (PRs #37 to #48)

Wave: 7
Phase: 7 stabilization (carryover from Phase 6 polish close)
Date: 2026-05-19
Branch: twelve feature branches across PRs #37 to #48, then docs branch `phase-7/docs/stabilization-closeout`
Status: Closed (baseline at `9846f1e`; Phase 7 stabilization scope now empty)

Risks closed: `F-Wave7-LISTENVELOPE-01`, `F-Wave7-EXPENSE-SCHEMA-01`, `F-Wave7-ESM-SH-DRIFT-01`, `F-Wave7-FK-RENDER-SWEEP-01`, `F-Wave7-AUDIT-CACHE-SWEEP-01`, `F-Wave7-MUTATION-ERRORS-SWEEP-01`, `F-Wave7-LINEFORM-VALIDATE-01`, `F-Wave7-CANON-STEWARD-01`, `F-Wave7-TRIGGER-AUDIT-01`, `F-Wave7-LITDRIFT-01`, `F-Wave7-UUID-GUARD-01`, `F-Wave7-CRM-SCHEMA-01`, `F-Wave7-LINES-01`, `F-Wave7-LISTFILTER-01`. Fourteen of fourteen.

Risks filed: `F-Wave7-STALE-6_5-TODOS-01`, `F-Wave7-SIDEBAR-IA-01`, `F-Wave7-FK-RENDER-SWEEP-02`, `F-Wave7-EMIT-MOVEMENTS-MIGRATION-01`, `F-Wave7-LINES-DUAL-WRITE-DROP-01`, `F-Wave7-LINES-PAYLOAD-DROP-01`, `F-Wave7-PRODUCTION-LINES-NORMALIZE-01`, `F-Wave7-RECEIVING-DETAIL-ENTITY-LABEL-01`. Eight new.

## Context

Phase 7 stabilization scope opened at the close of the Phase 6 polish session with fourteen follow-ups bucketed under `STATUS.md > Phase 7 stabilization scope`. Eight items were filed during the Phase 6 walk itself (envelope drift, expense / CRM schema gaps, literal drift, UUID guard, line-form validation, trigger audit, canon-steward grep, list-filter lift). Six more were filed by the Phase 6 polish session as it surfaced sweep-class bugs whose individual fixes left a codebase-wide pattern (mutation-error sweep, FK-render sweep, audit-cache sweep, esm.sh drift).

All fourteen are now closed across twelve PRs (#37 through #48). The Agent Router dispatched three cycles in parallel. Cycle 1 ran five agents covering the low-coupling cleanups (#37, #38, #39, #40, #41). Cycle 2 ran four agents covering the boundary canon work (#42, #43, #44, #45). Cycle 3 ran three agents covering the schema normalisation pass plus the LISTFILTER lift (#46, #47, #48). Each cycle ran at `Confidence: high`.

Two reframes shaped the session and are worth recording up front:

1. The CRM-SCHEMA-01 work was bundled into Cycle 1's EXPENSE-SCHEMA-01 dispatch. The agent verified at the DB layer that `customers.default_payment_terms_days` does not exist and refused to ship a side-car-only patch. The work was re-scoped into Cycle 3 as PR #46 (migration 0049 plus the side-car).
2. PR #46 and PR #47 both authored migration 0049 off the same baseline in parallel. The collision was caught at PR-merge time, not at agent-spawn time. PR #47 was rebased and renumbered to 0050. No data impact; both migrations are idempotent.

Total session bundle delta: 25.94 kB to 29.73 kB. Cap remains at 40 kB.

## Findings, in PR order

### Cycle 1

#### PR #37. F-Wave7-LISTENVELOPE-01. Eight handler sites canonicalised

Symptom: eight handlers across `quotes-api`, `sales-config-api`, `collaboration-api`, and `customer-portal-api` returned `ok({items: data ?? []})` (a one-off envelope shape) while the SPA's `apiClient` unwraps one envelope level. Identical class to PR #25 and PR #26 from the Phase 6 hotfix storm. None on the current hot path so the bug surfaces only when a future feature mounts one of the affected routes.

Fix shape: handlers canonicalised to `ok(data ?? [])` matching the dominant shape across CRM, invoicing, and finance bundles. Four SPA services adjusted to consume the flat array. No tests broke; the affected services were not under any operator path.

PR: https://github.com/kitstak/app/pull/37 · commit `db6912e`

#### PR #38. F-Wave7-EXPENSE-SCHEMA-01. Expense side-car gap closed; CRM half refused

Symptom: `ExpenseSchema` side-car did not enumerate `project_id` even though migration 0046 added the column. `ExpenseCreatePage` shipped with a typed cast `Partial<Expense> & { project_id?: string }` to send the field. The dispatch bundled in a parallel CRM half (`CustomerCreateSchema` to enumerate `default_payment_terms_days`).

Fix shape: `ExpenseSchema` extended with `project_id: z.string().uuid().nullable().optional()` on both sides of the byte-mirror. `ExpenseCreatePage` typed cast removed. The CRM half was properly refused. The agent verified via `information_schema.columns` that `customers.default_payment_terms_days` does not exist on the live DB and that the original STATUS.md framing of the follow-up was inaccurate. The work was filed for re-scope and landed in Cycle 3 as PR #46.

PR: https://github.com/kitstak/app/pull/38 · commit `f60850d`

#### PR #39. F-Wave7-ESM-SH-DRIFT-01. Twenty-four edge files plus one config converted

Symptom: twenty-four files under `supabase/functions/` and one Vitest config used direct CDN URL imports of the shape `https://esm.sh/zod@3.23.8` or `https://esm.sh/@supabase/supabase-js@2.45.0`. Every edge function deploy depended on esm.sh being up at deploy time. PR #32's deploy had failed exactly once on this dependency (esm.sh 522).

Fix shape: all twenty-four files converted to bare imports (`import { z } from 'zod'`, `import { createClient } from '@supabase/supabase-js'`). `supabase/functions/deno.json` already mapped `zod` to `npm:zod@3.23.8`; one new map entry added for `@supabase/supabase-js@2.45.0`. The Vitest regression config (`vitest.regression.config.ts`) also got its URL-rewrite stripped because the bare specifiers now resolve through `node_modules` directly. Supabase Preview branch auto-discovers `deno.json` so the conversion did not require a workflow change.

PR: https://github.com/kitstak/app/pull/39 · commit `b402613`

#### PR #40. F-Wave7-FK-RENDER-SWEEP-01. Shared `<EntityLabel>` helper

Symptom: five SPA detail pages rendered raw FK UUIDs in the same shape `ReceivingOrderDetailPage` did before PR #31 (Shipment, ProductionRun, JournalEntry, Contact, Lead).

Fix shape: new `apps/web/src/components/ui/EntityLabel.tsx` helper with eight `kind` values (`warehouse`, `customer`, `vendor`, `project`, `item`, `contact`, `lead`, `account`). Each kind dispatches to the existing list hook (`useWarehousesList`, `useCustomersList`, etc.), renders `{code} · {display_name}` where the entity has a code or `{display_name}` where it does not, and falls back to the raw UUID if the lookup misses. Applied to the five detail pages flagged in the follow-up. `ReceivingOrderDetailPage`'s PR #31 inline `useWarehousesList` pattern was left intact pending soak; migration tracked as `F-Wave7-RECEIVING-DETAIL-ENTITY-LABEL-01`.

PR: https://github.com/kitstak/app/pull/40 · commit `77eda56`

#### PR #41. F-Wave7-AUDIT-CACHE-SWEEP-01 plus F-Wave7-MUTATION-ERRORS-SWEEP-01. Two SPA sweeps in one PR

Symptom: thirteen state-machine detail pages were silently affected by the AUDIT-02 stale-cache class PR #35 surfaced. Separately, fifteen consumer pages had `useMutation` calls without inline error surfaces, swallowing validation failures the way the Add Material form did before PR #33.

Fix shape: nine mutation hook files (`useProjects.ts`, `useInvoices.ts`, `useCreditNotes.ts`, `useJournalEntries.ts`, `usePurchaseOrders.ts`, `useVendorBills.ts`, `useExpenses.ts`, `useReceivingOrders.ts`, `useShipments.ts`) wired `auditLogKeys.byEntity('<entity>', id)` invalidation for thirteen entity types. Project phases, leads, opportunities, and production runs got the same treatment in their existing hook modules. Fifteen consumer pages got inline `mutation.error.message` rendering, the submit-button-disabled-while-pending pattern, and the `mutate(..., { onSuccess })` rewrite where the call site still used `await mutateAsync` with no error path.

PR: https://github.com/kitstak/app/pull/41 · commit `b9de37c`

### Cycle 2

#### PR #42. F-Wave7-LINEFORM-VALIDATE-01. Strict zod line schemas at the API boundary

Symptom: receiving / shipment / production_run create endpoints accepted `payload.lines` as opaque JSON and pushed validation responsibility to the database triggers. PR #28 hardened the triggers; PR #42 is the API-boundary partner.

Fix shape: strict zod schemas added to all three handler families. Receiving and shipment use a single line shape (`item_id` required, `quantity` numeric, optional `unit_cost_cents` bigint, optional `notes`). Production_run was split into Consumed (strict, requires `item_id` and `quantity`) and Produced (lenient, allows `item_id` to be null because the trigger's `coalesce(item_id, output_item_id)` pattern legally accepts production runs whose lines do not record a separate consumed item). Eight new regression tests cover the strict and lenient paths.

One drift from the dispatch worth noting: the dispatch called for `400 BAD_REQUEST` on validation failures. The codebase already uses `422 VALIDATION_ERROR` for malformed bodies across every other bundle (the convention shipped in Wave 1). PR #42 followed the existing convention and used `422`. The drift was flagged in the PR body.

PR: https://github.com/kitstak/app/pull/42 · commit `5ab63a5`

#### PR #43. F-Wave7-CANON-STEWARD-01 plus F-Wave7-TRIGGER-AUDIT-01. Two CI grep guardrails

Symptom: the canon-steward pattern (parallel agents stub each other's types so neither blocks) needed a guardrail because the Phase 6.5 miss was caught only at operator re-test. The trigger-NOT-NULL pattern (PR #24 and PR #28) needed a guardrail because both shipped silent until the operator hit them.

Fix shape: two new scripts at `scripts/canon-steward-check.mjs` and `scripts/trigger-audit-check.mjs`, each wired into `.github/workflows/ci.yml`. The canon-steward script greps for `Placeholder` / `TODO 6.5-*` / `TODO Canon Steward` markers, and additionally checks that every `<Link to="/foo/new">` resolves against a registered route and that every list page in `routes.ts` is reachable from at least one Sidebar entry. The trigger-audit script greps for `insert into <table> ... NOT NULL ...` patterns inside `create or replace function` blocks and cross-checks against the migrations index of NOT NULL columns.

Thirteen baseline violations are allowlisted with traceable closure reasons in `scripts/canon-steward-allowlist.txt` and `scripts/trigger-audit-allowlist.txt`: four Phase 6.5 narrative TODO comments in detail pages (no behaviour impact), seven intentional orphan deep-link routes (five sales-config sub-pages plus `/3pl-operations/vas` plus `/imports/history`), and two historical trigger insertions closed by migrations 0047 and 0048. Both scripts run in under one second.

Spawned: `F-Wave7-STALE-6_5-TODOS-01` for the four stale narrative TODOs (cleanup is mechanical, no behaviour impact) and `F-Wave7-SIDEBAR-IA-01` for the seven orphan routes (deferred to a Phase 8 IA decision).

PR: https://github.com/kitstak/app/pull/43 · commit `0b8fd9e`

#### PR #44. F-Wave7-LITDRIFT-01. Cross-boundary literal canon

Symptom: cross-boundary string literals (feature flag keys, header names, error codes) were duplicated at the read site and the write site. Two prior bugs (`F-Wave6-CORS-01` and `G-OPS-FLAG-01`) were the same class.

Fix shape: new `_shared/constants.ts` with mirrored SPA file at `apps/web/src/lib/constants.ts` added to the parity manifest. Byte-mirror pair count moves from 25 to 26. Thirty-three consumer sites converted across three categories: eight feature flag keys (`plugins.three_pl`, `plugins.manufacturing`, etc.), nine header names (`X-Idempotency-Key`, `X-Request-Id`, `X-Worker-Secret`, etc.), and sixteen error code emit/match sites (`FORBIDDEN`, `NOT_FOUND`, `IDEMPOTENCY_CONFLICT`, etc.).

Five literals were intentionally left inline: SQL bodies (where literals are part of the schema), the docs files (where the literal is the documentation), the PDF worker's `NOT_IMPLEMENTED` error code (only used by the 501 stub), the bundle-local `INTERNAL_ERROR` in `_shared/handler-helpers.ts` (only one consumer), and the `Bearer ` prefix in auth header construction (the value is structural, not a name).

PR: https://github.com/kitstak/app/pull/44 · commit `5aa44a9`

#### PR #45. F-Wave7-UUID-GUARD-01. parseUuidParam at handler boundary

Symptom: handlers cast `:id` path segments straight to Postgres `uuid`. A non-UUID `:id` (`new`, `123`, `undefined`) surfaced as a 500 with a Postgres cast error message in the response body. The F-Wave6-WAREHOUSE-CREATE-01 root cause would have been a clean 400 instead of a 500 with this guard.

Fix shape: new `parseUuidParam(value, paramName)` helper in `_shared/handler-helpers.ts`. Throws an `ApiError(400, 'BAD_REQUEST', ...)` with `paramName` in `details`. `BAD_REQUEST` added to the `ApiErrorCode` enum and the `STATUS_FOR_CODE` map. Applied to 150 invocations across 25 handler files. Four new tests cover the happy-path (valid UUID returns the value unchanged) and the four malformed-input shapes (empty, non-UUID, double-cast, mixed-case-rejected-strict). Valid-UUID happy path is byte-for-byte unchanged.

PR: https://github.com/kitstak/app/pull/45 · commit `006d345`

### Cycle 3

#### PR #46. F-Wave7-CRM-SCHEMA-01. Closes the work PR #38 properly refused

Symptom: re-scoped from PR #38. The DB layer did not carry `default_payment_terms_days` on `customers`; the work was a full schema change plus side-car plus form work, not the side-car-only fix the original follow-up framed.

Fix shape: migration `0049_customers_default_payment_terms_days.sql` adds `customers.default_payment_terms_days integer null check (default_payment_terms_days >= 0)`. Side-car `CustomerSchema` extended on both sides of the byte-mirror. `crm-api` customer create / update handlers accept the field. `CustomerCreatePage` and `CustomerEditPage` gain a "Default payment terms (days)" number input. Forward-only with full constitutional header. DOWN MIGRATION block (operator-only) documents the column drop.

This is the work PR #38's agent refused on principled grounds. Documenting it as a pattern win: a thorough constitutional brief gave the agent the cover to fail safe rather than ship a half-fix that would have left the DB layer drifted from the side-car canon.

PR: https://github.com/kitstak/app/pull/46 · commit `4b04e6d`

#### PR #47. F-Wave7-LINES-01. Receiving and shipment line item normalisation

Symptom: `receiving_orders` and `shipments` stored their line items as JSON inside `payload`. The shape was undocumented at the schema level (only the trigger code knew the field names) and operator ergonomics required editing JSON inline.

Fix shape: migration `0050_receiving_shipment_line_items.sql` (renumbered from 0049; see below) creates two tables. `receiving_order_line_items` and `shipment_line_items` carry denormalised `org_id` for Pattern A RLS, ordered position columns, `quantity numeric(18,4)`, nullable `unit_cost_cents bigint`, and the parent FK. Idempotent backfill from `payload.lines` JSON guards re-runs with `NOT EXISTS`. Eight new ops-api routes per entity (GET / POST / PATCH / DELETE for the collection plus for the single line). All POST / PATCH / DELETE require `Idempotency-Key`. Dual-write back to the parent's `payload.lines` JSON so the existing `emit_movements` triggers (0032 plus 0048) keep firing correctly until the next-release migration moves the triggers off the JSON read.

Two new capability groups (`receiving.line_item.{create,read,update,delete}` and `shipment.line_item.{create,read,update,delete}`) added to the `vendors_inventory_ops` side-car only via the D-011 per-bundle shim; the singular `_shared/capabilities.ts` was not touched. SPA gets two new service modules, four new hooks (`useReceivingOrderLineItems`, `useAddReceivingOrderLineItem`, `useRemoveReceivingOrderLineItem`, plus shipment mirrors), and Add Line / Remove Line UI on the two detail pages modelled on `ProjectDetailPage`'s Add Material pattern (PR #33 with the inline error rendering treatment from PR #41).

Production runs were intentionally out of scope. The Produced-vs-Consumed split surfaced in PR #42 makes a parallel normalisation a larger piece of work than receiving / shipment, and the operator's daily path does not exercise it the same way. Tracked as `F-Wave7-PRODUCTION-LINES-NORMALIZE-01`.

Multi-stage drop plan for `payload.lines` recorded in `03-workspace/journal/phase-7-lines-normalization.md` and split into three forward migrations tracked as follow-ups: `F-Wave7-EMIT-MOVEMENTS-MIGRATION-01` (next release, migrate the two `emit_movements` triggers to read from the new tables), `F-Wave7-LINES-DUAL-WRITE-DROP-01` (release after, drop the dual-write from `ops-api` handlers), `F-Wave7-LINES-PAYLOAD-DROP-01` (release after that, forward migration drops `payload.lines` from parents and `lines` body param from the receive / ship RPCs).

Migration number collision: PR #47 originally authored the migration as 0049 because it was dispatched in the same cycle as PR #46 off the same baseline. The collision was caught at PR-merge time when PR #46 landed first; PR #47 was rebased and the migration renumbered to 0050. No data impact and both migrations are idempotent. The codified response is in the lessons section below.

PR: https://github.com/kitstak/app/pull/47 · commit `9cb95ce`

#### PR #48. F-Wave7-LISTFILTER-01. Server-side filter lift

Symptom: `CustomerDetailPage` and `VendorDetailPage` filtered quotes / projects / invoices / payments / POs / vendor bills / expenses / receiving client-side after pulling the full org list. STATUS.md framed the follow-up as "Server endpoints already support the filters". On audit this turned out to be inaccurate: only `invoices.customer_id` and `payments.customer_id` were truly server-side supported; the other ten endpoints needed server-side filter additions.

Fix shape: ten endpoints across `quotes-api`, `projects-api`, `invoicing-api`, `vendors-api`, and `ops-api` got `customer_id` / `vendor_id` / `project_id` filter parameters. Eight SPA services updated to thread filters through. Eight hooks updated. Four query-key files updated to include the filter in the cache key. Client-side `.filter(...)` calls removed from the two detail pages. Eight new RLS probe rows added to confirm the filters honour cross-tenant scope (filter-by-customer-in-other-tenant returns `200 + []`, not the global list).

PR: https://github.com/kitstak/app/pull/48 · commit `9846f1e`

## Constitutional invariants verified across the wave

| Invariant | State at close |
|---|---|
| Money rules (cents-as-bigint, `_cents` suffix, roundHalfEven, byte-mirrored helpers) | Held. `receiving_order_line_items.unit_cost_cents` and `shipment_line_items.unit_cost_cents` both `bigint`. No floating-point money introduced anywhere. |
| RLS Pattern A on every tenant-scoped table | Held. Both new tables in PR #47 carry Pattern A from migration 0050 with denormalised `org_id`. Every new LISTFILTER server filter (PR #48) sits inside the existing `current_org_id()` boundary. |
| Migration rules (forward-only, idempotent, no edits post-apply) | Held. Two new forward-only migrations (0049, 0050) with full constitutional headers and operator-only DOWN MIGRATION blocks. The migration-number collision (0049) was resolved by renumbering the second one before merge, not by editing applied migrations. |
| Idempotency (`Idempotency-Key` on every non-GET, hashed, stored) | Held. All sixteen new line-item routes from PR #47 enforce `Idempotency-Key`. All new filter-bearing endpoints from PR #48 are GET so the rule does not apply. PR #46's customer create / update extension preserves the existing idempotency contract. |
| Audit log (append-only, hash chain, auto-state-transition triggers) | Held. Line items have no state machine so no audit trigger is needed; the parents' existing state transitions still emit. The SPA invalidates `auditLogKeys.byEntity` on every state-changing mutation across thirteen entity types after PR #41. |
| Capabilities (D-011 per-bundle `requireXxxCap` shim) | Held. Two new capability groups added via the side-car only; singular `_shared/capabilities.ts` untouched. |
| Side-car parity | Ratcheted up. Twenty-five byte-mirror pairs to twenty-six (PR #44 added `constants`). `pnpm test:contract` 26 of 26 at every PR and at close. |
| Banned deps | Held. No new top-level deps. |
| Brand discipline | Held. All copy clean across the twelve PRs; no em dashes, no double hyphens, no emojis in user-facing copy. |
| TS1 read-only zone | Held. No writes. |

## Reframes and process drifts codified

### Reframe 1: the CRM-SCHEMA-01 refusal is a pattern win

The original Cycle 1 dispatch bundled EXPENSE-SCHEMA-01 and CRM-SCHEMA-01 as parallel side-car-only patches. The agent verified at the DB layer via `information_schema.columns` that `customers.default_payment_terms_days` did not exist and refused to ship the side-car-only piece. The agent filed for re-scope and shipped only the EXPENSE half.

A thorough constitutional brief (the canon's emphasis on byte-mirror parity plus forward-only migrations) gave the agent the cover to fail safe rather than push the half-fix. The work was picked up cleanly in Cycle 3 by PR #46 with the missing migration as the headline deliverable. Document as a pattern: when a side-car-only patch's STATUS framing is "the DB already has this", verify at the DB layer before opening the diff. If the DB does not have it, refuse and refile with the migration in scope.

### Reframe 2: parallel migration-bearing dispatches need pre-reserved migration numbers

PR #46 and PR #47 both authored migration 0049 in Cycle 3 in parallel. The collision was caught at PR-merge time, not at agent-spawn time. PR #47's rebase plus renumber was mechanical (one filename change, one constitutional header date stamp), and both migrations are idempotent so there was no data risk. The codified response is that future parallel migration-bearing dispatches in the same cycle should reserve migration numbers upfront in the orchestrator's brief, or the orchestrator should pre-renumber after the first lands and rebase the others before they open.

The Phase 6.5 dispatch shape (Shape B: shared-UI agent plus schema/RPC agent before dependent-UI agents) avoided this class of collision because the schema/RPC agent ran alone in Stage 1. Phase 7's parallel-cycle dispatch is faster but trades the safety of a single-writer stage for the need to coordinate migration numbers explicitly.

### Reframe 3: Agent Router with `Confidence: high` per cycle was the right pattern for stabilization work

Three cycles, twelve agents, zero agent constitutional violations, one principled refusal (PR #38's CRM half), one mechanical post-merge renumber (PR #47). Compare to Phase 6.5's Stage 1 / Stage 2 dispatch which produced two transient agent failures and one Canon Steward miss. The wider stabilization scope of Phase 7 (no new domain coupling; each PR was either a sweep, a schema gap-fill, or a CI guardrail) was a better fit for parallel `Confidence: high` than the cross-domain wiring shape of Phase 6.5. Hotfix-storm shape (one agent per symptom, one PR per fix) remains the cleanest pattern for operator-walking-the-flow surfacing.

## New follow-ups filed this session

- `F-Wave7-STALE-6_5-TODOS-01`: four stale narrative TODO comments in `OpportunityDetailPage.tsx`, `CustomerDetailPage.tsx`, `ProjectDetailPage.tsx`, `useProjects.ts`. No behaviour impact. Allowlisted in `scripts/canon-steward-allowlist.txt` with closure reason "Phase 6.5 narrative; cleanup is mechanical". Cleanup deferred to a Phase 8 cosmetic sweep.
- `F-Wave7-SIDEBAR-IA-01`: seven intentional orphan routes (five sales-config sub-pages: tax / currency / unit / category / payment-method; plus `/3pl-operations/vas`; plus `/imports/history`). Allowlisted in `scripts/canon-steward-allowlist.txt` with closure reason "intentional orphan, deep-link only". Deferred to a Phase 8 IA decision on whether to surface these in Sidebar or to formalise them as deep-link-only utility routes.
- `F-Wave7-FK-RENDER-SWEEP-02`: round-2 candidates flagged in PR #40. Five additional FK columns rendered as raw UUIDs across list pages and summary cells: `category_id`, `unit_id`, `default_tax_id`, `tax_id`, `vendor_id`. Plus the list-page UUID-slice truncations (the `id.slice(0, 8)` shorthand used on roughly fifteen list pages) which could be replaced with `<EntityLabel kind="..." />` for parity with the detail-page treatment.
- `F-Wave7-EMIT-MOVEMENTS-MIGRATION-01`: next-release migration to migrate `tg_receiving_orders_emit_movements` and `tg_shipments_emit_movements` to read from the new line-item tables instead of the parent's `payload.lines` JSON. Step one of the multi-stage drop.
- `F-Wave7-LINES-DUAL-WRITE-DROP-01`: release after the above. Drop the dual-write from `ops-api` line-item handlers; payload.lines stops being maintained at the application layer. Step two of the multi-stage drop.
- `F-Wave7-LINES-PAYLOAD-DROP-01`: release after that. Forward migration drops `payload.lines` from the parent rows (a no-op in Postgres jsonb terms; the column itself stays for other payload fields) and drops the `lines` body param from the receive / ship RPCs. Step three of the multi-stage drop.
- `F-Wave7-PRODUCTION-LINES-NORMALIZE-01`: mirror of LINES-01 for `production_runs`. Not constitutionally required (production runs are not on the operator's daily path the way receiving / shipment are) but worth doing if operator ergonomics warrant. The Produced-vs-Consumed split surfaced in PR #42 makes this a larger piece of work than the receiving / shipment normalisation.
- `F-Wave7-RECEIVING-DETAIL-ENTITY-LABEL-01`: migrate `ReceivingOrderDetailPage`'s PR #31 inline `useWarehousesList` resolve pattern to the new `<EntityLabel kind="warehouse" id={...} />` helper post-soak. Mechanical refactor; deferred because PR #31 shipped working and the soak window is the cheap insurance.

## Lessons

1. **Pre-flight DB verification in agent briefs.** PR #38's refusal worked because the dispatch brief was explicit about the forward-only migration rule. Going forward, every side-car-extension dispatch should include the operator-verifiable claim that the DB layer carries the column, or the dispatch should be scoped to include the migration. Saved a half-fix from shipping and the work was clean once re-scoped.

2. **Parallel dispatch reserves migration numbers.** PR #46 and PR #47 collided on slot 0049 because neither agent had visibility into the other's draft. The codified response: orchestrator briefs reserve specific migration numbers per parallel agent in the same cycle. Cheap to implement, removes a non-zero post-merge cost.

3. **Cycle-grained dispatch beats stage-grained dispatch for stabilization work.** Phase 6.5's Stage 1 / Stage 2 model was the right shape for cross-domain coupling. Phase 7's three-cycle parallel model was the right shape for stabilization (sweeps, schema gap-fills, CI guardrails). The shape of the scope dictates the shape of the dispatch. Document under SESSION-CATALYST.md when that lands.

4. **CI guardrails close a class of bugs that operator-walks cannot.** The canon-steward and trigger-audit scripts (PR #43) would have caught the F-Wave6-WAREHOUSE-CREATE-01 missing-route bug, the F-Wave6-NAV-CRM-01 missing-Sidebar-entry bug, the F-Wave6-AUDIT-01 NOT-NULL-trigger-insert bug, and the F-Wave6-EMIT-MOVEMENTS-01 NOT-NULL-trigger-insert bug. Four bugs from the Phase 6 hotfix storm are now structurally precluded for under one second of CI cost per PR. Worth more than the LOC count suggests.

5. **STATUS.md framing can drift from the code reality.** The LISTFILTER follow-up framed the server as "already supports the filters"; on audit ten of twelve endpoints did not. The agent did the audit anyway because the brief was about closing the SPA-side client-filter pattern, not the server-side enablement. Going forward, every follow-up that names a "the server already does X" assumption should carry a checklist of the specific endpoints to verify pre-implementation.

## Gates verified at close

At baseline `9846f1e`, post-merge of PR #48:

| Gate | Result |
|---|---|
| `pnpm typecheck` | 0 errors |
| `pnpm lint` | 0 warnings, 0 errors |
| `pnpm test` | green |
| `pnpm test:contract` | 26 of 26 (`constants` pair landed in PR #44) |
| `pnpm build` | clean |
| `pnpm bundle-budget` | 29.73 / 40 kB (up 0.33 kB from 29.4 across the twelve PRs; bulk of the delta is the line-item UI on the two detail pages from PR #47 and the new `<EntityLabel>` helper from PR #40) |
| `node scripts/canon-steward-check.mjs` | exit 0 (13 baseline violations allowlisted) |
| `node scripts/trigger-audit-check.mjs` | exit 0 (2 baseline violations allowlisted) |

Migration count holds at 50 (slots 0001 to 0050; 0005 and 0006 intentionally empty). Two new migrations this session: 0049 (CRM-SCHEMA-01) and 0050 (LINES-01). Byte-mirror parity intact across 26 pairs. Singular `_shared/{types,workflow,capabilities,money,constants}.ts` carry only the cross-domain canon and remain unchanged from their respective seeding waves (constants seeded this session in PR #44). All copy clean (no em dashes, no double hyphens, no emojis). TS1 read-only zone untouched.

Phase 7 stabilization scope: closed. Eight Phase 8 carryover items filed.
