# Wave 6 F-Wave6-FLOW-01 Hotfix Storm

Wave: 6
Phase: 6 (quote-to-cash verification gate)
Date: 2026-05-19
Branch: six branches across PRs #24 to #29, then docs branch `docs/wave6-flow-hotfix-storm-closeout`
Status: Closed (baseline at `0d190e3`; Phase 6 gate substantially passed)

Risks closed: `F-Wave6-AUDIT-01`, `F-Wave6-LINES-API-01`, `F-Wave6-LISTUNWRAP-01`, `F-Wave6-WAREHOUSE-CREATE-01`, `F-Wave6-EMIT-MOVEMENTS-01`, `F-Wave6-NAV-CRM-01`.
Risks carried: `F-Wave6-AUDIT-02`, `F-Wave6-LINEFORM-01`, `F-Wave6-ITEMS-403-01`, `F-Wave6-WAREHOUSE-NAME-01`, `F-Wave6-PRODUCTION-CREATE-01`, all Phase 7 stabilization items (LINES-01, LISTFILTER-01, CRM-SCHEMA-01, EXPENSE-SCHEMA-01, LITDRIFT-01, CANON-STEWARD-01, LISTENVELOPE-01, UUID-GUARD-01, LINEFORM-VALIDATE-01, TRIGGER-AUDIT-01), plus all carried-open items from prior waves.

## Context

The Phase 6 F-Wave6-FLOW-01 gate is operator-led: sign in to `www.kitstak.com`, walk the full quote-to-cash chain on prod, every state change should write `audit_log`, no 500s. After PRs #20, #21, #23 landed all the chassis and remediation work, the operator opened a fresh session and started walking. Six bugs surfaced, one at each step of the chain; each shipped as its own hotfix PR in the same afternoon. The orchestrator and the operator stayed in a tight loop: operator hits bug, dispatches an agent against the symptom plus a stack trace, agent ships the fix and posts the PR, operator advances. By the end of the afternoon, the operator had walked customer create through invoice send and payment receive, and the gate was substantially passed at baseline `0d190e3`.

This entry documents the hotfix-storm cadence as a viable late-phase pattern and codifies the three recurring bug classes that surfaced. The Wave 6.5 audit and remediation closed the cross-domain wiring gaps; this storm closed the chassis-drift bugs that only show up when an operator walks a real path.

## Findings, in chronological discovery order

### Step 1: convert quote to project. PR #24 (`F-Wave6-AUDIT-01`)

Symptom: operator clicked "Convert to project" on an approved quote; the page surfaced "Convert failed: null value in column to_state of relation audit_log".

Root cause: migration 0044 wired a state-change audit trigger onto `project_line_items` even though `project_line_items` is not a state-machine entity. The trigger called `audit_append_state_change(..., to_state := NULL, ...)` and `audit_log.to_state` has been `NOT NULL` since migration 0001. The trigger fired inside the `convert_quote_to_project` RPC transaction (which inserts project line items as part of the convert flow) and rolled the whole RPC back.

Fix shape: migration 0047 redefines `trg_audit_project_line_items` so non-state-machine entities pass the action verb (`created` / `updated` / `deleted`) as `to_state`. `audit_log` schema, `audit_append_state_change`, and `convert_quote_to_project` untouched. Hash chain integrity preserved because `verify_audit_chain` treats `to_state` as opaque bytes. Forward-only migration, idempotent DDL.

Unblocked: quote -> project convert.

PR: https://github.com/kitstak/app/pull/24 · commit `12eb2c8`

### Step 2: project detail page. PR #25 (`F-Wave6-LINES-API-01`)

Symptom: the converted project loaded for a moment then ErrorBoundary caught "Something went wrong". DevTools showed `TypeError: lineItems.data.map is not a function` from `ProjectDetailPage`.

Root cause: `projects-api /projects/:id/line-items` was a one-off, returning `ok({ items: data ?? [] })` while the dominant pattern across CRM / invoicing / finance is `ok(data ?? [])`. `apiClient.ok()` unwraps one envelope level for the SPA, so the hook received `{items: [...]}` instead of `[...]`. The hook was typed `ProjectLineItem[]`. `(lineItems.data ?? []).map(...)` threw on the wrong shape.

Fix shape: the handler now returns `ok(data ?? [])` matching the dominant shape. One line changed on the server.

Unblocked: project detail page render after convert.

PR: https://github.com/kitstak/app/pull/25 · commit `99876af`

### Step 3: inventory pages render empty. PR #26 (`F-Wave6-LISTUNWRAP-01`)

Symptom: operator clicked "Warehouses" in the Sidebar to set up a warehouse for the receiving order. Page rendered with the header and "No warehouses." empty state, even though the operator could see warehouse rows in the Supabase studio.

Root cause: PR #23's Tier-1 pagination conversion changed `inventory-api` list endpoints from flat-array returns to `{items, next_cursor}` envelopes. Three SPA list services (`warehousesService`, `stockLevelsService`, `bomItemsService`) had not been updated when the envelope changed. They were typed as flat-array returns. The `.map` inside the queryFn threw on the new shape. React Query caught the throw, marked the query errored, but the page treated the data as undefined and rendered the empty state instead of surfacing the error. Three different list pages all silently empty.

Fix shape: each service zod-parses the new envelope and returns `.items`. Three files touched, same edit shape on each.

Unblocked: Warehouses list (and Stock Levels and BOM Items, which the operator was about to need on the next two steps).

PR: https://github.com/kitstak/app/pull/26 · commit `35831db`

### Step 4: create the warehouse. PR #27 (`F-Wave6-WAREHOUSE-CREATE-01`)

Symptom: operator clicked the "New warehouse" CTA. Page rendered a 500.

Root cause: the CTA pointed at `/3pl-operations/warehouses/new` but no `/new` route was registered. With react-router-dom v6 declaration order, the URL fell through to `/:id` and matched with `id="new"`. The warehouse detail page fired its query against `id = 'new'`, the server passed it to Postgres as `where id = 'new'::uuid`, Postgres threw a cast error, the handler caught and surfaced a 500.

Fix shape: new `WarehouseCreatePage.tsx` mirroring the Wave 6.5 create-page patterns, plus the `/new` route registered before `/:id` in `routes.ts` so it takes precedence.

Unblocked: warehouse create -> receiving-order create.

PR: https://github.com/kitstak/app/pull/27 · commit `1b6cf99`

### Step 5: receiving received, shipment shipped, project completed. PR #28 (`F-Wave6-EMIT-MOVEMENTS-01`)

Symptom: operator hit "Mark received" on the receiving order. Surface error: "null value in column item_id of relation stock_movements violates not-null constraint". Same shape on the shipment shipped transition and the project completed transition.

Root cause: migration 0032's three `stock_movements` emit triggers (one each on receiving received, shipment shipped, production_run produced) iterate over the `payload.lines` JSON array on the parent row and insert one `stock_movements` row per line. Each trigger casts `(v_line ->> 'item_id')::uuid` directly. If the payload was constructed without `item_id` (the SPA's payload-JSON editor is permissive; the operator's test data had at least one line without `item_id`), the cast surfaced `null`, and the insert hit the NOT NULL on `stock_movements.item_id`.

Fix shape: migration 0048 `create or replace`s the three trigger functions. Each now resolves `v_item_id` into a local variable via a tolerant cast (`case when v_line ? 'item_id' and v_line ->> 'item_id' ~ '^[0-9a-f-]{36}$' then (v_line ->> 'item_id')::uuid else null end`) and `continue`s the loop when `v_item_id is null`. Production-runs `produced` branch preserved byte-for-byte. Forward-only migration. Idempotent DDL.

Unblocked: every terminal transition in the receiving / shipment / production triad.

PR: https://github.com/kitstak/app/pull/28 · commit `a564b1f`

### Step 6: discoverability for Contacts and Activities. PR #29 (`F-Wave6-NAV-CRM-01`)

Symptom: at the end of the walk, the operator wanted to add a contact to the customer they had created. Could not find the entry point. Sidebar WORKSPACE section had Customers, Leads, Opportunities. No Contacts. No Activities.

Root cause: when the Sidebar was rebuilt in PR #16, only the entities the operator had on the immediate quote-to-cash hot path got first-class WORKSPACE entries. Contacts and Activities have list pages registered in `routes.ts` and detail pages and create pages, but no shell entry.

Fix shape: three-line edit to `apps/web/src/components/shell/Sidebar.tsx` adding the two entries to the WORKSPACE section.

Unblocked: contact and activity discoverability from the shell.

PR: https://github.com/kitstak/app/pull/29 · commit `0d190e3`

## Lessons

1. **Envelope drift is the recurring SPA-edge bug class.** PR #25 and PR #26 had the same root: an edge function returned an envelope the SPA hook did not expect, the `.map` inside the queryFn threw, React Query silently stored undefined, the page either crashed (PR #25, with a precomputed total) or rendered empty (PR #26, with no row to crash on). Both shipped silent for at least one prior release before the operator hit them. Eight more `ok({items: ...})` handlers are still on the codebase: `quotes-api:356`, `sales-config-api:308`, `collaboration-api:244` and `:300`, `customer-portal-api:106` and `:131` and `:156` and `:221`. None are on the quote-to-cash hot path, so they get fixed in Phase 7 polish. The right durable answer is to enforce the canonical envelope at the `ok()` helper itself or via a lint rule that flags `ok({items` literal callers. Tracked as `F-Wave7-LISTENVELOPE-01`.

2. **Trigger inserts into NOT NULL columns are the recurring database crash class.** PR #24 (`audit_log.to_state` got `null`) and PR #28 (`stock_movements.item_id` got `null` after a permissive cast) had the same shape: a trigger inserted with a value that was either explicitly `NULL` or the result of a permissive cast from a missing payload field. Both were authored against migrations that defined the trigger and the target table at the same time, so the author had every reason to think the schema-level NOT NULL was satisfied. A pre-commit grep that surfaces `insert into <table>` inside `create or replace function` blocks and cross-checks the column list against the table's `NOT NULL` columns would have caught both. Tracked as `F-Wave7-TRIGGER-AUDIT-01`.

3. **Sidebar / route chassis drift surfaces only when an operator walks a path.** PR #27 (no `/new` route for warehouses despite a "New warehouse" link in the Sidebar) and PR #29 (no Contacts entry in WORKSPACE despite a registered Contacts list route and `customer.contact.*` capabilities seeded across all eight roles) both shipped silent for months. Neither typecheck nor lint nor the byte-mirror parity test nor the 48-probe RLS matrix can catch either; probes hit edge functions directly, the SPA shell is invisible to them. The existing `F-Wave7-CANON-STEWARD-01` should grow a guardrail that: every `<Link to="/foo/new">` resolves against a registered route; every `routes.ts` entry that renders a list page is reachable from at least one Sidebar entry. The check belongs at the orchestrator boundary (pre-PR) since the agents that wrote the broken pages had no way to know about the missing partner edit.

4. **Hotfix-storm cadence is a viable late-phase pattern.** Six PRs in one afternoon, all small, all narrowly scoped to a single bug surfaced at a specific operator step. The operator stayed in the session, walking the chain forward as each fix deployed. The orchestrator and the operator together formed a one-bug-at-a-time pipeline that is faster than batching: by the time the operator hit step five, the first four fixes were already on prod and tested. Compare to the Wave 6.5 batched audit and remediation, which closed 39 of 41 gaps but introduced two regressions that PR #21 had to clean up. The storm pattern works best when the bugs are independent (no PR in this run depended on another PR in the run) and small (each fix touched between one and three files). The pattern fails if the bugs are entangled or if the fixes are themselves large.

## Risks carried

- **Phase 6 polish carryover** (non-blocking, defer to a Phase 6 polish PR or Phase 7): `F-Wave6-AUDIT-02` (submitted -> approved audit row missing or filtered), `F-Wave6-LINEFORM-01` (missing onError on add-material form), `F-Wave6-ITEMS-403-01` (`ItemPicker` 403s on `sales-config-api/items` for `org_owner`), `F-Wave6-WAREHOUSE-NAME-01` (`ReceivingOrderDetailPage` shows raw warehouse UUID), `F-Wave6-PRODUCTION-CREATE-01` (no `/new` route or `ProductionRunCreatePage`).
- **Phase 7 stabilization scope**: `F-Wave7-LINES-01`, `F-Wave7-LISTFILTER-01`, `F-Wave7-CRM-SCHEMA-01`, `F-Wave7-EXPENSE-SCHEMA-01`, `F-Wave7-LITDRIFT-01`, `F-Wave7-CANON-STEWARD-01` (scope grew this session), `F-Wave7-LISTENVELOPE-01` (new), `F-Wave7-UUID-GUARD-01` (new), `F-Wave7-LINEFORM-VALIDATE-01` (new), `F-Wave7-TRIGGER-AUDIT-01` (new).
- **Operator-gated**: `F-Wave2-AGENT-A-05`, `F-Wave2-CO-01`, `F-Wave2-DNDKIT-01`, `F-Wave5-CO-01` / `F-Wave3-OBS-01`, `F-Wave5-CO-02`.
- **Other carried open**: `F-Wave5-TEST-02`, `F-Wave6-NAV-02`.

## Gates verified at close

At baseline `0d190e3`, post-merge of PR #29:

| Gate | Result |
|---|---|
| `pnpm typecheck` | 0 errors |
| `pnpm lint` | 0 warnings, 0 errors |
| `pnpm test` | green |
| `pnpm test:contract` | 25 / 25 |
| `pnpm build` | clean |
| `pnpm bundle-budget` | within 40 kB cap |

Migration count now 48 applied. Byte-mirror parity intact across 22 pairs. Singular `_shared/{types,workflow,capabilities,money}.ts` untouched. All copy clean (no em dashes, no double hyphens, no emojis). TS1 read-only zone untouched.

Phase 6 F-Wave6-FLOW-01 gate: substantially passed.
