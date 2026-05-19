# Kitstak Status

Last updated: 2026-05-19

## Current state

**Phase 6 F-Wave6-FLOW-01 quote-to-cash gate has been walked end-to-end on prod and the polish carryover is now closed (baseline `347062f`).** The operator confirmed the full chain: customer create · quote create · approve · convert to project · add material · warehouse create · receiving order create · receiving received · shipment create · shipment shipped · project completed · invoice create · invoice send · payment receive. Six hotfix PRs (#24 through #29) landed during the walkthrough itself, then five polish PRs (#31 through #35) cleared the carryover bucket the morning after: warehouse-name FK display, sales-config 403, Add Material silent fail, ProductionRunCreatePage, and the AUDIT-02 stale-cache reframe. Phase 6 is now closed; the active scope is Phase 7 stabilization.

**Pre-walkthrough hardening (PR #23 at `b884f5d`).** Tier-1 fixes shipped before the operator walked the gate: pagination across list endpoints and notifications delivery wiring.

**Wave 6.5 hotfix (PR #21) and remediation (PR #20).** Phase 6.5 closed 39 of 41 cross-domain wiring gaps that the prior F-Wave6-FLOW-01 attempt had surfaced. PR #21 cleaned up the three SPA regressions that surfaced on first re-test (ProjectDetailPage placeholder, convert silent-fail, missing list CTAs). Full history in `03-workspace/journal/wave-6-5-workflow-integration.md` and `wave-6-5-hotfix.md`.

## Outstanding work and drift register

### Phase 6 gate

- **`F-Wave6-FLOW-01`**: **passed at `347062f`**. The operator walked the full quote-to-cash chain through invoice send and payment receive (substantially passed at `0d190e3`); the five polish carryover items closed in PRs #31 to #35. Phase 6 is done.

### Operator-gated (waiting on explicit operator authorization beyond a phase go)

- **`F-Wave2-AGENT-A-05`**: master capability table consolidation. Fold all domain caps from the 6 side-cars into the singular `_shared/capabilities.ts`. Removes the per-bundle `requireXxxCap` shim pattern (D-011) in favor of a single `requireCap`.
- **`F-Wave2-CO-01`**: pdf-worker real render. Needs operator-approved JS PDF dependency (`pdfkit` or `jsPDF`, both BSD). Today `pdf-worker` returns a 501 stub.
- **`F-Wave2-DNDKIT-01`**: project-phase reorder UI. Needs operator-approved `dnd-kit` dependency. Today reorder uses Up / Down buttons.
- **`F-Wave5-CO-01`** / **`F-Wave3-OBS-01`**: Sentry SPA + edge-function capture. Needs operator-approved DSN.
- **`F-Wave5-CO-02`**: analytics provider selection. Needs operator pick (PostHog / Segment / Mixpanel / etc.).

### Phase 7 stabilization scope

- **`F-Wave7-LINES-01`**: receiving / shipment line normalization. Today lines are stored as `payload` JSON on `receiving_orders` and `shipments`. The 6.5 audit flagged operational ergonomics; constitution does not mandate normalization. New tables (`receiving_order_line_items`, `shipment_line_items`) plus handler updates plus side-car schemas.
- **`F-Wave7-LISTFILTER-01`**: server-side list filters. `CustomerDetailPage` and `VendorDetailPage` filter quotes / projects / invoices / payments / POs / vendor bills / expenses / receiving client-side after pulling the full org list. Lift filters into the list services (`useQuotesList`, `useProjectsList`, etc.). Server endpoints already support the filters.
- **`F-Wave7-CRM-SCHEMA-01`**: extend `CustomerCreateSchema` side-car to include `default_payment_terms_days` (called out by audit, not in current side-car).
- **`F-Wave7-EXPENSE-SCHEMA-01`**: extend `ExpenseSchema` side-car to enumerate `project_id` (column shipped in migration 0046 but Zod schema does not enumerate it; `ExpenseCreatePage` uses a typed cast to send it).
- **`F-Wave7-LITDRIFT-01`**: canonicalize cross-boundary string literals in `_shared/`. The `G-OPS-FLAG-01` and `F-Wave6-CORS-01` bugs were the same class: a literal duplicated at the read site and the write site, drifting in isolation. Canonicalize all flag keys, header names, and other cross-boundary constants as named imports from `_shared/`.
- **`F-Wave7-CANON-STEWARD-01`**: pre-PR grep guardrail. Add a pre-commit check that fails the diff if it introduces or leaves a `Placeholder` / `TODO 6.5-*` / `TODO Canon Steward` marker. The placeholder pattern (parallel agents stub each other's types so neither blocks) is useful; the resolution step needs a guardrail because the Canon Steward miss in Phase 6.5 was caught only at operator re-test. **Scope grew this session**: should also check that every `<Link to="/foo/new">` resolves against a registered route and that every list page in `routes.ts` is reachable from at least one Sidebar entry (PR #27 and PR #29 both shipped silent for months and only surfaced on operator foot-traffic).
- **`F-Wave7-LISTENVELOPE-01`** (new this session): canonicalize the remaining `ok({items: ...})` handlers (`quotes-api:356`, `sales-config-api:308`, `collaboration-api:244` and `:300`, `customer-portal-api:106`, `:131`, `:156`, `:221`). None on the current hot path, so Phase 7 polish. Same drift class as PR #25 and PR #26.
- **`F-Wave7-UUID-GUARD-01`** (new this session): server-side handlers should return `400 BAD_REQUEST` on a non-UUID `:id` path segment, not let it fall through to a Postgres cast error and surface as `500`. Defense in depth; the F-Wave6-WAREHOUSE-CREATE-01 root cause would have been a clean 400 instead of a 500 with this guard.
- **`F-Wave7-LINEFORM-VALIDATE-01`** (new this session): `payload.lines` on receiving / shipment / production_run create should be validated at the API boundary against a strict zod schema, including requiring `item_id` when a line is present. Companion to the existing `F-Wave7-LINES-01` normalisation. PR #28 hardened the database triggers to tolerate missing `item_id`, but the API should reject the malformed payload up front.
- **`F-Wave7-TRIGGER-AUDIT-01`** (new this session): grep guardrail on trigger function bodies that perform `insert into <table> ... NOT NULL ...`. PR #24 (`audit_log.to_state`) and PR #28 (`stock_movements.item_id`) had the same shape: a trigger inserted with a value that was either `NULL` or the result of a permissive cast from a missing payload field. A pre-commit grep that surfaces `insert into` inside `create or replace function` blocks and cross-checks NOT NULL columns would have caught both.
- **`F-Wave7-MUTATION-ERRORS-SWEEP-01`** (filed in PR #33): every other `useMutation` call site in the SPA needs the same inline-error treatment PR #21 (convert-to-project) and PR #33 (Add Material) applied. Grep surfaces 128 `useMutation` occurrences across 28 files; 7 of them are `*CreatePage.tsx` create forms in `pages/crm/` alone (Activity, Contact, Customer, CustomerEdit, Lead, Opportunity, OpportunityDetail) that follow the same shape as Add Material and almost certainly silently swallow validation errors today. Hook files (`useOps.ts`, `useInvoices.ts`, `useProjects.ts`, etc.) define the mutations; the consumer pages are where the inline error renderer needs to land. Sweep should audit every `mutate` / `mutateAsync` consumer, confirm an inline error path exists, and add one mirroring this PR where it does not. Probably 15 to 20 page-level edits.
- **`F-Wave7-FK-RENDER-SWEEP-01`** (filed in PR #31): five SPA detail pages render raw FK UUIDs in the same shape `ReceivingOrderDetailPage` did before PR #31: ShipmentDetailPage, ProductionRunDetailPage, JournalEntryDetailPage, ContactDetailPage, LeadDetailPage. Generalize the `useWarehousesList`-resolve pattern across all six pages, and lift the resolver to a shared `<EntityLabel kind="..." id={...} />` helper if the duplication justifies it. SPA-only; no schema impact.
- **`F-Wave7-AUDIT-CACHE-SWEEP-01`** (filed in PR #35): the stale-audit-cache bug AUDIT-02 surfaced almost certainly affects every other state-machine detail page in the SPA. PR #35 added an `auditLogKeys` factory and wired `useQuotes.ts` to invalidate `auditLogKeys.byEntity('quote', id)` on every state-changing mutation. The same wiring is missing on thirteen other entities: projects, invoices, credit notes, journal entries, purchase orders, vendor bills, expenses, receiving orders, production runs, shipments, leads, opportunities, project phases. Sweep should add the invalidation to every state-changing mutation hook. Symptom is silent and only surfaces when an operator stays on the detail page through more than one state transition.
- **`F-Wave7-ESM-SH-DRIFT-01`** (filed in PR #32 deploy triage): 25 files across `supabase/functions/` use direct CDN URL imports of the shape `https://esm.sh/zod@3.23.8` or `https://esm.sh/@supabase/supabase-js@2.45.0`, including shared infrastructure files (`_shared/handler-helpers.ts`, `_shared/idempotency.ts`). Every edge function deploy depends on esm.sh being up at deploy time; PR #32's deploy failed exactly once on a transient 522 against this dependency (run 26123760836). `supabase/functions/deno.json` already maps `"zod": "npm:zod@3.23.8"` (PR #6, Wave 2 hotfix); the bare `import { z } from 'zod'` shape would resolve through the import map and bypass the CDN entirely. Convert all 25 sites to bare imports. The Supabase Preview branch also auto-discovers `deno.json`, so the conversion does not require a workflow change.

### Phase 6 polish carryover

Closed in PRs #31 to #35 this session. See "Closed in this session" below for details. The bucket is empty.

### Other carried open

- **`F-Wave5-TEST-02`**: smoke selectors dry-run against staging. The Playwright smoke spec is scaffolded but selectors have not been validated against live staging. Eventually expand into a cross-domain workflow smoke that walks one full quote-to-cash chain (the only existing cross-domain verifier today is the operator running F-Wave6-FLOW-01).
- **`F-Wave6-NAV-02`**: align other pillar child paths (Manufacturing, Co-Pack and Ecom, KitForce, KitCost) when those pillars light up. Pillar 1 paths fixed in PR #15.

### Closed in this session

- `F-Wave6-API-01` / `02`, `F-Wave6-NAV-01` / `03`: Wave 6 chassis PRs #13 to #16.
- `F-Wave6-CORS-01`: PR #18 (CORS consolidation).
- `G-OPS-FLAG-01`: PR #19 hotfix (string-literal drift).
- 39 of 41 audit gaps: Phase 6.5 PR #20.
- `F-Wave6-DATA-01`: migrations 0042 + 0043 (seed_org_settings backfill plus provision_organization self-heal).
- ProjectDetailPage crash, convert silent fail, list page CTAs: PR #21.
- Pagination + notifications delivery (PR #23).
- `F-Wave6-AUDIT-01`: PR #24 (project_line_items audit trigger passed `null` to `audit_log.to_state`, migration 0047 redefines trigger to send action verb).
- `F-Wave6-LINES-API-01`: PR #25 (`projects-api /projects/:id/line-items` returned one-off `ok({items: ...})` envelope; apiClient unwrapped one level, `(lineItems.data ?? []).map(...)` in ProjectDetailPage threw on the new envelope shape; handler canonicalised to `ok(data ?? [])`).
- `F-Wave6-LISTUNWRAP-01`: PR #26 (PR #23's pagination conversion changed `inventory-api` to return `{items, next_cursor}`; three SPA list services (`warehousesService`, `stockLevelsService`, `bomItemsService`) were typed as flat-array returns, the `.map` inside queryFn threw, lists rendered silently empty; fix unwraps the envelope and returns `.items`).
- `F-Wave6-WAREHOUSE-CREATE-01`: PR #27 (Sidebar "New Warehouse" link pointed at `/3pl-operations/warehouses/new` but no `/new` route was registered; URL fell through to `/:id` with `id="new"`, Postgres threw on the uuid cast, 500 surfaced; fix adds `WarehouseCreatePage` and registers `/new` before `/:id` in routes.ts).
- `F-Wave6-EMIT-MOVEMENTS-01`: PR #28 (the three `stock_movements` emit triggers in migration 0032 cast `(v_line ->> 'item_id')::uuid` which threw NOT NULL violations the moment a receiving / shipment / production_run terminal transition fired against a payload line without `item_id`; migration 0048 `create or replace`s the three trigger functions with a guarded `v_item_id` local that skips lines whose item_id is missing or non-castable; production-runs `produced` branch preserved byte-for-byte).
- `F-Wave6-NAV-CRM-01`: PR #29 (Sidebar WORKSPACE section was missing Contacts and Activities entries; SPA-only three-line edit to `Sidebar.tsx`).
- `F-Wave6-WAREHOUSE-NAME-01`: PR #31 (`ReceivingOrderDetailPage` rendered `d.warehouse_id` as a raw UUID; page now resolves the FK via `useWarehousesList` and renders `{code} · {display_name}` with raw-UUID fallback if the lookup misses; SPA-only edit; spawns `F-Wave7-FK-RENDER-SWEEP-01` covering Shipment, ProductionRun, JournalEntry, Contact, Lead detail pages which carry the same shape).
- `F-Wave6-ITEMS-403-01`: PR #32 (`sales-config-api/index.ts` imported `requireCap` from `_shared/handler-helpers.ts` which validates against the singular byte-mirrored `_shared/capabilities.ts`; sales caps live in the sales side-car so every `sales.*` lookup against the singular canon fell through to FORBIDDEN for every role, including `org_owner`; new `sales-config-api/_helpers.ts` shim consults the sales side-car canon, mirroring quotes-api / invoicing-api / projects-api D-011 pattern; singular `_shared/capabilities.ts` untouched. Deploy gotcha: first deploy-functions run on the merge SHA failed on a transient esm.sh 522, rerun on the same SHA succeeded; the broader pattern is filed as `F-Wave7-ESM-SH-DRIFT-01`).
- `F-Wave6-LINEFORM-01`: PR #33 (Add Material form on `ProjectDetailPage` swallowed `useAddProjectLineItem` failures because the submit handler used `await mutateAsync(...)` with no `onError` and no inline error surface; operator typed `2.5` into "Unit price (cents)" expecting dollars, 422 came back, form silently did nothing. Fix switches the handler to `mutate(..., { onSuccess })` so React Query's error state is preserved on the mutation object, renders `addLine.error.message` inline beneath the form mirroring PR #21's convert-to-project pattern, disables the submit button while pending, and relabels the field to `Unit price (whole cents, e.g. 250 = $2.50)` to defuse the dollars/cents trap. Spawns `F-Wave7-MUTATION-ERRORS-SWEEP-01` for the codebase-wide sweep).
- `F-Wave6-PRODUCTION-CREATE-01`: PR #34 (mirror of PR #27; `/3pl-operations/production` had a list and a detail route but no `/new` route and no `ProductionRunCreatePage`, so the list page's "New Production Run" CTA fell through to `/:id` with `id="new"` and surfaced a 500 on the uuid cast; new `ProductionRunCreatePage.tsx` modeled on `WarehouseCreatePage.tsx`, `/new` registered before `/:id` in `routes.ts`, capability-gated CTA added to the list page header; bundle 29.4 / 40 kB, +0.83 kB).
- `F-Wave6-AUDIT-02`: PR #35 (operator's test quote HISTORY showed `draft -> submitted` but not `submitted -> approved`. Reframe: the original symptom framing assumed either a trigger gap or an `AuditTimeline` filter, and both hypotheses turned out to be wrong. Read-only DB inspection confirmed the `submitted -> approved` row exists in `audit_log` with the right shape and hash chain link; `AuditTimeline.tsx` does not filter by row shape. Actual root cause: `useQuoteAction` (submit / approve / send) and `useConvertQuoteToProject` invalidate `quotesKeys.*` on success but never the audit timeline's query key, and with `staleTime: 30_000` + `refetchOnWindowFocus: false` an operator who stays on the detail page through Submit then Approve sees the pre-approve cached snapshot of the audit timeline. DB row exists; SPA never re-fetches. Fix: new `apps/web/src/lib/queryKeys/auditLog.ts` factory; `AuditTimeline.tsx` keys off it; `useQuotes.ts` invalidates `auditLogKeys.byEntity('quote', id)` after every state-changing mutation and after convert-to-project. Spawns `F-Wave7-AUDIT-CACHE-SWEEP-01` for the thirteen other state-machine detail pages affected by the same bug class).

## Drift register

### Code-level: HELD on every hard constitutional constraint

| Constraint | State |
|---|---|
| Money rules (cents-as-bigint, `_cents` suffix, roundHalfEven, byte-mirrored helpers) | Held. `project_line_items` uses `bigint unit_price_cents`. |
| RLS Pattern A on every tenant-scoped table | Held. `project_line_items` got Pattern A from migration 0044. Cross-tenant `convert_project_to_invoice` follows the migration-0041 `p_caller_org_id` pattern. |
| Migration rules (forward-only, idempotent, no edits post-apply) | Held. 5 new migrations 0042 to 0046 all forward-only with constitutional headers. |
| Idempotency (`Idempotency-Key` on every non-GET, hashed, stored) | Held. All new `projects-api` POST/PATCH/DELETE endpoints require it. |
| Audit log (append-only, hash chain, auto-state-transition triggers) | Held. `project_line_items` ships with auto-trigger from migration 0044; `audit_log` entity_type enum extended. |
| Capabilities (D-011 per-bundle `requireXxxCap` shim) | Held. `projects-api` extended with `project.line_item.*` caps via `requireProjectCap` shim. |
| Banned deps | Held. No new top-level deps. |
| Brand discipline | Held. All copy clean; lucide-react icons only; no em dashes, no double hyphens, no emojis. |
| TS1 read-only zone | Held. No writes. |
| Byte-mirror parity (22 pairs) | Held. `test:contract` 25/25 across every PR. |

### Code-level: MINOR DRIFTS (workarounds in code with durable follow-ups filed)

| Drift | Workaround | Follow-up |
|---|---|---|
| `ExpenseSchema` side-car omits `project_id` (DB column exists from migration 0046) | `ExpenseCreatePage` uses a typed cast `Partial<Expense> & { project_id?: string }` to send it; server-side Zod accepts/strips | `F-Wave7-EXPENSE-SCHEMA-01` |
| `CustomerCreateSchema` side-car omits `default_payment_terms_days` | `CustomerCreatePage` does not capture the field | `F-Wave7-CRM-SCHEMA-01` |
| List services don't expose `customer_id` / `vendor_id` / `project_id` filters | `CustomerDetailPage` / `VendorDetailPage` filter client-side after pulling full org list | `F-Wave7-LISTFILTER-01` |
| `receiving_orders` and `shipments` store lines as payload JSON | Payload-JSON editor on the create pages (operator can hand-edit JSON; constitution does not mandate normalization) | `F-Wave7-LINES-01` |

### Process-level: DRIFTS that surfaced + codified responses

1. **Wave 2's disjoint-domain dispatch produced 0 cross-domain seams.** Six agents each shipped a domain CRUD; nobody owned the seams between domains. 41 gaps surfaced when operator exercised quote-to-cash end-to-end. **Response**: Phase 6.5 codified Shape B (shared-UI agent + schema/RPC agent before dependent-UI agents) as the future-wave pattern. Documented in `wave-6-5-workflow-integration.md` lessons section.

2. **Canon Steward missed a TODO placeholder during consolidation.** Agent 6.5-A shipped `ProjectLineItemPlaceholder` in `useProjects.ts` with a TODO marker for the orchestrator to replace once 6.5-B's real `ProjectLineItem` type landed. The Canon Steward pass missed the marker. The placeholder field names (`quantity_e3`, `line_total_cents`) did not match the real schema (`quantity`, `discount_percent`, no precomputed total); `formatCents(undefined)` threw at first render of a real row, ErrorBoundary caught. Operator caught it at re-test. **Response**: hotfix PR #21 replaced the placeholder; `F-Wave7-CANON-STEWARD-01` codifies a pre-commit grep guardrail.

3. **String-literal drift across boundaries: recurring pattern.** Two instances in two consecutive waves: CORS allow-headers (`cors.ts` and `responses.ts` drifted; `F-Wave6-CORS-01`) and feature flag key (`ops-api` read `plugins.3pl` while `seed_org_settings` wrote `plugins.three_pl`; `G-OPS-FLAG-01`). Same class of bug. **Response**: both closed in this session (PR #18 + PR #19). `F-Wave7-LITDRIFT-01` spawns a sweep to canonicalize all cross-boundary string literals in `_shared/`.

4. **Transient API blips during agent runs.** Phase 6.5 Stage agents hit API connection errors mid-run three times (twice in Stage 1, once in Stage 2). Each agent had landed ~95% of deliverables before failing. **Response**: discovered the finisher-agent recovery pattern. Spawn a small follow-up agent with the residual scope (specific files to fix, specific gates to pass) as its charter. Faster than re-dispatching the full Stage agent and the partial work is durable. Documented in `wave-6-5-workflow-integration.md` and now codified in `SESSION-CATALYST.md`.

5. **48-probe matrix is necessary but not sufficient.** Probes hit edge functions directly with service-role JWTs; they cannot surface SPA-edge integration gaps or cross-domain workflow gaps. Phase 6 chassis revealed 4 such bugs (apiClient URL, CORS, Sidebar paths, Sidebar expansion); Phase 6.5 audit revealed 41 more. The only existing cross-domain verifier is the operator running `F-Wave6-FLOW-01` by hand. **Response**: tracked under `F-Wave5-TEST-02` (smoke selector hardening) but scope needs to grow into a real browser-driven workflow smoke that walks one full quote-to-cash chain pre-merge.

### Spine-level: INTACT

- The constitution at `CLAUDE.md` still governs every sub-agent prompt.
- Multi-agent dispatch protocol still works (Wave 6.5 proved it at 4 agents + 2 finishers).
- Cowork orchestrator role intact (canon updates, gate enforcement, PR opening, Canon Steward consolidation).
- Phase boundaries plus operator-gated decisions intact.
- All 22 byte-mirror canon pairs intact.
- 46 migrations applied at remote; no migration-rule violations.

**Wave 6 Customer Zero chassis fixes shipped (PRs #13, #14, #15, #16, #17, #18, #19 merged · main at `a90eded`).** Phase 6 opened with the operator signing in to `www.kitstak.com` and the Topbar rendering "No workspace" despite a fully provisioned `kitstak` org and stamped JWT claims. Four rapid-fire hotfixes landed all the foundational SPA -> edge-function wiring gaps that Wave 5's probe matrix could not have caught: apiClient relative URLs + missing auth headers (PR #13), CORS allow-headers missing `apikey` (PR #14), Sidebar pillar paths drifted from the routes table (PR #15), Sidebar surfaced only pillars while the Phase 6 quote-to-cash flow needs Workspace / Sales / Procurement / Inventory / Finance / Tools / Admin (PR #16). Plus an operator-data fixup seeding `org_feature_flags` for the `kitstak` org (which had been provisioned before migration 0040's `seed_org_settings` shipped). Phase 6 chassis closed; the operator-led quote-to-cash workflow exercise is the remaining Phase 6 gate.

**Wave 5 probes closed at 48 / 48 green on staging (PR #9 + PR #10 merged · commits `32d7acd` and `ebe8f5d`).** Phase 4 (marketing site) skipped at operator direction (built in parallel outside this session). Phase 5 shipped the 48-probe RLS matrix; the matrix's first real run surfaced six constitutional violations which the same phase resolved via four hotfixes: Node 22 in the probe workflow (native WebSocket), staging branch rebase to apply 37 Wave 2 migrations, probe seed schema corrections, and the substantive 403→404 fixes (quotes-api / projects-api side-car capability shims, admin-console-api `verify_jwt = false`, and forward migration `0041` redefining `convert_quote_to_project` to take `p_caller_org_id` explicitly). Final probe run: 48 / 48 in 31s. Sentry and analytics remain deferred per operator.

**Wave 3 integration shipped (PR #8 merged · commit `209c106`).** AuditTimeline mounted on every state-having detail page (13 total); Sidebar live `useOrgFlags()`; global `ErrorBoundary`; NotFoundPage dual-import Vite warning fixed; `apps/web/playwright.config.ts` plus smoke + rls-probe scaffolds.

**Wave 2 domain ports shipped (PR #4 merged · commit `e1dd9ba`).** Pillar 1 (3PL Operations) is lit at the schema, API, and SPA layers. Pillars 2-3 (Manufacturing, Co-Pack and Ecom) are plumbed (schemas plus edge function bundles, feature-flag-gated off). 41 forward-only migrations now applied at the remote (Postgres 17.6.1.121, GA channel, region `us-west-1`).

### Migrations applied (48 slots used, 0005 and 0006 intentionally empty)

`0001_foundation`, `0002_identity_branding_provisioning`, `0003_fix_audit_search_path`, `0004_identity_extensions`, `0007` to `0010` (CRM), `0011` to `0017` (sales chassis, quoting, projects), `0018` to `0024` (invoicing, payments, finance), `0025` to `0033` (vendors, inventory, ops), `0034` to `0040` (cross-cutting, audit trigger coverage, attachments view, org settings seed), `0041` (cross-tenant convert_quote_to_project), `0042` to `0046` (Wave 6.5: seed_org_settings backfill, provision_organization self-heal, project_line_items, convert_quote_to_project line-carry, convert_project_to_invoice, FK hardening), `0047` (Phase 6 hotfix: redefine project_line_items audit trigger to pass action verb as `to_state`; closes F-Wave6-AUDIT-01), `0048` (Phase 6 hotfix: guard the three emit_movements triggers against missing or non-castable `item_id`; closes F-Wave6-EMIT-MOVEMENTS-01).

### Edge function bundles deployed and scheduled

- **Wave 1 (scheduled)**: `audit-chain-verify`, `idempotency-gc`.
- **Wave 2 (HTTP API)**: `auth-api`, `tenants-api` (`verify_jwt=false` for the public `resolve-host` route), `settings-api`, `admin-console-api` (bundle-gated on `platform_admin.enabled`), `crm-api`, `sales-config-api`, `quotes-api`, `projects-api`, `invoicing-api`, `finance-api`, `vendors-api`, `inventory-api`, `ops-api` (bundle-gated on `plugins.3pl`), `collaboration-api`, `search-api`, `customer-portal-api`, `dashboard-api`, `exports-api`, `imports-api`, `notifications-worker` (`verify_jwt=false`, X-Worker-Secret), `pdf-worker` (501 stub pending operator-approved JS PDF dep).

### Side-car canon

`_shared/{types,workflow,capabilities}/<domain>.ts` paired with `apps/web/src/lib/{types,workflow,capabilities}/<domain>.ts` for six domains: identity, crm, sales, finance, vendors_inventory_ops, cross_cutting. `parity.test.ts` asserts 22 byte-identical pairs (4 singular plus 18 side-cars). `_shared/workflow/cross_cutting.ts` aggregates all 14 state machines into `ALL_STATE_MACHINES`. The singular byte-mirrored files (`types.ts`, `workflow.ts`, `capabilities.ts`, `money.ts`) carry the foundation only and are unchanged since Wave 1.

### SPA surface

67 routes in the flat `RouteSpec[]` table, marker-bounded per agent. Three-gate auth taxonomy (`ProtectedRoute`, `AdminProtectedRoute`, `PortalRoute`). AppShell + Sidebar (five-pillar IA in canonical order) + Topbar + RequireFlag + AuditTimeline. Pages under `pages/admin/`, `pages/crm/`, `pages/3pl-operations/<domain>/`, `pages/finance/`, `pages/portal/`, `pages/search/`, `pages/dashboard/`, `pages/imports/`, `pages/exports/`. Bundle size: **25.55 kB gzip** against the 40 kB cap.

### Gates verified at Wave 2 close

- `pnpm typecheck` zero errors.
- `pnpm lint` zero errors, zero warnings.
- `pnpm test` 5 of 5.
- `pnpm test:contract` 25 of 25.
- `pnpm build` succeeds.
- `pnpm bundle-budget` 25.55 kB / 40 kB.
- Brand validation greps: zero user-facing violations.
- TS1 read-only zone untouched.

### Wave 2 second hotfix (PR #6, merged · commit `1cfdcf6`)

PR #5's hotfix unblocked the pooler connection and CLI version. The next `deploy-functions` run advanced past those errors and deployed the first two bundles (`audit-chain-verify`, `idempotency-gc`), then failed on `auth-api` with `Relative import path "zod" not prefixed with / or ./ or ../`. The Supabase Preview check on the same SHA failed the same way. Root cause: all 6 side-car type files use bare `from 'zod'`, which the SPA resolves via `node_modules` but Deno cannot resolve without an import map. Fix: `supabase/functions/deno.json` ships a workspace import map (`"zod": "npm:zod@3.23.8"`) and the deploy workflow passes `--import-map` explicitly. No canon files touched; byte-mirror parity intact (`test:contract` 25 / 25).

After this hotfix merged, all 3 post-merge workflows turned green (`ci`, `deploy-functions`, `deploy-prod`). All 23 edge function bundles deployed successfully per the deploy log.

### Wave 2 first hotfix (PR #5, merged · commit `2057391`)

Two GitHub Actions failures after PR #4 merge required a hotfix:

- `migrate.yml` used `aws-1-us-west-2.pooler.supabase.com`; the project's region is `us-west-1` and the canonical pooler hostname is `aws-0-us-west-1.pooler.supabase.com`. ENOTFOUND on the DNS lookup.
- `deploy-functions.yml` pinned the Supabase CLI at `1.180.0`, which predates Postgres 17 GA support and rejects `db.major_version = 17` in `config.toml`. The remote project IS on Postgres 17.x, so the correct fix is bumping the CLI, not lowering the config.

Both workflows now pin `supabase/setup-cli@v1` with `version: latest`. `deploy-functions.yml` BUNDLES array extended to all 23 functions (Wave 1's 2 plus Wave 2's 21). `config.toml` adds `[functions.tenants-api] verify_jwt = false` so the public host-resolver route serves pre-auth (closes `F-Wave2-AGENT-A-06`).

## Wave 3 deliverables (shipped this phase)

- Sidebar pillar gates wired to live `useOrgFlags()` (closes `F-Wave2-API-03`).
- Global `ErrorBoundary` mounted in `main.tsx` below `AuthProvider`.
- NotFoundPage Vite static-plus-dynamic chunk warning eliminated by wildcard `Navigate to="/404"` (closes `F-Wave2-BUILD-01`).
- `AuditTimeline` mounted on every state-having detail page (quotes, projects, purchase orders, vendor bills, expenses, receiving orders, production runs, shipments, leads, opportunities, in addition to the three from Wave 2: invoices, credit notes, journal entries). Heading style normalized across all 13.
- `apps/web/playwright.config.ts` plus `apps/web/playwright/{smoke,rls-probe}.spec.ts` scaffolds land. `test:e2e` and `test:rls` scripts point at the new config. Specs `test.skip` until Phase 5 wires staging Supabase secrets.

`BrandingProvider` and `Topbar.useMe` gating already shipped in Wave 2 (both call their hook with `enabled: isAuthed`); no changes needed this phase. Sentry SPA init deferred (no `VITE_SENTRY_DSN` in the operator's keys file).

## Wave 5 deliverables (shipped this phase)

- `apps/web/playwright/rls-probe.spec.ts`: 48 cross-tenant probes against a Supabase preview branch named `staging`. Bootstraps two ephemeral orgs plus one user per org, seeds one row per primary entity into org A, then probes from user B's JWT. Categories: list reads (10) and unqualified reads (2) cross-tenant return 200 + []; detail reads (6) cross-tenant return 200 + []; workflow POSTs (11) return 404 (never 403); bundle gates `plugins.three_pl` and `platform_admin.enabled` (4) return 404 when off; per-route flag `finance.journal_entries.enabled` (2) returns 403 FEATURE_DISABLED with `details.flag`; customer-portal-api Pattern B (2) rejects non-customer_user roles; Pattern C globals (3) stay readable; unauthenticated guard (3) returns 401; switch-org cross-tenant (2) returns 404 / 201; audit_log RLS (2). Tagged `@rls` so `pnpm test:rls` picks them up. Skips cleanly when staging secrets are absent.
- `apps/web/playwright/smoke.spec.ts`: hardened from URL placeholders to real `page.fill` / `page.click` / `expect(page).toHaveURL` sequences for signin, switch org, customer create, quote send + accept, convert to project, invoice send, payment post, receiving order, shipment, AuditTimeline verification. Tagged `@smoke`. Test-skips when `PLAYWRIGHT_BASE_URL` or smoke credentials are absent.
- `docs/operations/probes.md`: operator-facing runbook covering all three nightly workflows (RLS probe, audit chain verify, idempotency GC), how to read failures, how to re-run on demand, and the staging secret contract.

Sentry SPA + edge-function capture and analytics provider deferred per operator decision. Both remain follow-ups for a later wave.

## Phase 5 close (hotfixes that landed during the phase)

The probe matrix's first real run surfaced six constitutional violations the matrix was designed to catch. All resolved in the same phase, on top of three infrastructure hotfixes to unblock the probe runtime:

1. **Probe workflow on Node 22** (`9a0eaf8`). `@supabase/realtime-js@2.105+` requires native WebSocket; Node 20 lacks it. Bumped just `nightly-rls-probe.yml`'s `actions/setup-node` to Node 22. Other workflows stay on Node 20.
2. **Staging branch rebase** (no code change). The Supabase preview branch `staging` was created at migration 0003 and missed all 37 Wave 2 migrations. Rebased via the Supabase Management API; the rebase also redeploys functions from main onto staging.
3. **Probe seed schema corrections** (`fe913e6`). The probe's fixture bootstrap used several wrong column names (`name` → `display_name` on warehouses; `given_name` / `family_name` → `first_name` / `last_name` on contacts; `state` → `status` on leads / invoices / credit notes / purchase_orders / vendor_bills / expenses / journal_entries; `title` → `display_name` and `state` → `stage` on opportunities; `posted_on` → `entry_date` on journal_entries); missing required document numbers and period_year / period_month on journal entries; `amount_cents 0` on payments (CHECK > 0).
4. **Constitutional 403→404 / 401→404 fixes** (`ae02e8c`). Two patterns:
   - Quotes-api and projects-api imported `requireCap` from the singular handler-helpers, which only knows the 14 `org.*` capabilities. Every `quotes.*` / `projects.*` cap check returned `FORBIDDEN`. Fix: per-bundle `_helpers.ts` with `requireSalesCap` wrapping the side-car `SALES_CAPABILITIES_BY_ROLE`, mirroring the invoicing-api pattern. The singular byte-mirrored `_shared/capabilities.ts` was not touched.
   - Admin-console-api had `verify_jwt = true` so the Supabase gateway returned 401 to anonymous callers before the handler could throw its 404. Fix: `[functions.admin-console-api] verify_jwt = false` in `config.toml` (handler already correctly returns 404 for anonymous).
5. **Forward migration `0041`** (`ebe8f5d`). The probe still saw 409 STATE_CONFLICT cross-tenant on `quotes-api convert-to-project`. Root cause: `convert_quote_to_project` checked `v_org_id <> public.current_org_id()`, but the handler invokes the RPC via the service-role client, which has no JWT claim. `current_org_id()` returned NULL; the comparison evaluated to NULL (treated as false); the cross-tenant guard never fired; the next check (`state != 'approved'`) won. Fix: drop the 3-arg RPC, recreate as 4-arg taking `p_caller_org_id`, surface mismatch as `NOT_FOUND`. Handler passes `caller.orgId`. Forward-only; idempotent.

**Final probe run on commit `ebe8f5d`**: 48 / 48 passed in 31s.

## Phase 5 open follow-ups

- **F-Wave5-TEST-02**: dry-run smoke selectors against live staging once Phase 6 starts exercising the full SPA workflow.
- **F-Wave5-INFRA-01**: `migrate.yml` failed against the production-db pooler with "Tenant or user not found" while applying 0041. The Supabase GH integration's auto-apply unblocked this specific deploy (0041 is in the prod migration table). The pooler connection string in `migrate.yml` and / or the `SUPABASE_DB_PASSWORD` / `SUPABASE_PROJECT_REF` secrets need a check-in before the workflow can be relied on for future schema changes. The orchestrator updated `SUPABASE_DB_PASSWORD` from the keys file's rotated value during the phase; the failure may be a pooler-username format issue (`postgres.<ref>` user encoding).
- **F-Wave3-OBS-01**: Sentry SPA + edge-function capture, blocked on `VITE_SENTRY_DSN`.
- **F-Wave2-AGENT-A-05** (carried): operator-gated merge of domain side-car capabilities into the master byte-mirrored `_shared/capabilities.ts`. The per-bundle shim pattern now lives in invoicing-api, quotes-api, and projects-api as the supported interim.

## Wave 6 deliverables (shipped this phase, chassis portion)

- **PR #13** (commit `6540819`): `apps/web/src/lib/apiClient.ts` rewritten to prepend `VITE_SUPABASE_URL + '/functions/v1'` to non-absolute paths, attach `apikey: VITE_SUPABASE_ANON_KEY`, and attach `Authorization: Bearer <access_token>` from `supabase.auth.getSession()`. Falls back to the anon Bearer for `verify_jwt = false` bundles. Closes `F-Wave6-API-01`.
- **PR #14** (commit `7f9acb5`): `apikey` added to `Access-Control-Allow-Headers` in both `_shared/cors.ts` and `_shared/responses.ts`. Closes `F-Wave6-API-02`. Spawns `F-Wave6-CORS-01` to consolidate the two drifted lists.
- **PR #15** (commit `94b4d01`): `apps/web/src/components/shell/Sidebar.tsx` pillar children realigned from `/three-pl/*` to `/3pl-operations/*` to match the routes table. Closes `F-Wave6-NAV-01`.
- **PR #16** (commit `a91b0f9`): Sidebar refactored to unify pillar and core sections under one `NavSection` type with optional `flag?: string`. New core sections: WORKSPACE (Customers/Leads/Opportunities), SALES (Quotes/Projects/Invoices/Payments/Credit notes), PROCUREMENT (Vendors/POs/Vendor bills/Expenses), INVENTORY (Items/Warehouses/Stock levels/Stock movements), FINANCE (gated on `finance.journal_entries.enabled`: COA/Journal entries/Period close), TOOLS (Search/Imports/Exports), ADMIN (Settings/Branding/Flags/Numbering). 3PL Operations gains Production runs. Closes `F-Wave6-NAV-03`.
- **Operator data fixup (no PR)**: `select public.seed_org_settings('ba4622dd-eb46-41b6-b2dd-95c922bf44dd')` inserted the 10 default flag rows; `UPDATE` enabled `plugins.three_pl`, `feature.collaboration`, `feature.global_search`, `feature.imports`, `feature.exports`; `INSERT ON CONFLICT` enabled `finance.journal_entries.enabled`. The `kitstak` org was provisioned in Wave 1, before migration 0040 shipped `seed_org_settings`, so the seed never fired retroactively.

### Gates verified at Wave 6 chassis close

- `pnpm typecheck` zero errors.
- `pnpm lint` zero errors, zero warnings.
- `pnpm test` 5 of 5.
- `pnpm test:contract` 25 of 25.
- `pnpm build` succeeds.
- `pnpm bundle-budget` **28.57 kB / 40 kB** (up 2.63 kB from 25.94: ~0.14 kB apiClient logic + ~2.49 kB for 24 new lucide-react icon imports for the expanded Sidebar).
- Brand validation greps: zero user-facing violations.
- TS1 read-only zone untouched.

## Wave 6 remaining work (operator-led quote-to-cash exercise)

Phase 6 gate per `SESSION-CATALYST.md` §9: "operator successfully exercises the full Pillar-1 workflow on prod, every state-change writes audit_log, no 500s." The chassis is now wired. The exercise itself is the next step:

1. Sign in to `www.kitstak.com` as `mike@kitstak.com` against the seeded `kitstak` org.
2. **Workspace -> Customers -> New**: create a customer.
3. **Sales -> Quotes -> New** (against that customer) -> Send -> Accept -> Convert to Project.
4. **Sales -> Invoices -> New** (against that project) -> Send -> Post payment.
5. **3PL Operations -> Receiving** -> create one and complete.
6. **3PL Operations -> Shipments** -> create one and ship.
7. Every detail page should render an `AuditTimeline` section with rows.

Tracked as `F-Wave6-FLOW-01`. Any small gaps surfaced during the exercise (missing copy, missing buttons, capability-gate corrections, broken navigation) are fixed inline per the Phase 6 protocol.

## Wave 6 open follow-ups

- `F-Wave6-FLOW-01`: operator-led quote-to-cash exercise on prod (the remaining Phase 6 gate).
- `F-Wave6-CORS-01`: consolidate the two CORS allow-headers lists by having `responses.ts` import from `cors.ts`. Deferred to Phase 7 polish.
- `F-Wave6-NAV-02`: align other pillar child paths when those pillars light up.

## Phase 7 prep

Both items previously tracked here landed in Wave 6.5. CORS consolidation shipped in PR #18 (closes `F-Wave6-CORS-01`); the `seed_org_settings` backfill shipped in migrations 0042 + 0043 via Option A + B together (closes `F-Wave6-DATA-01`). The active Phase 7 scope now lives under "Phase 7 stabilization scope" near the top of this file.

## Open risks

None open at Wave 2 close. The 10 Wave 2 follow-ups (`F-Wave2-*`) are tracked in `03-workspace/journal/wave-2-domain-ports.md`. The two operator-gated decisions are:

- `F-Wave2-CO-01`: pdf-worker render endpoint needs an operator-approved JS PDF dep (`pdfkit` or `jsPDF`, both BSD).
- `F-Wave2-DNDKIT-01`: `dnd-kit` is referenced by `00-canon/01-architecture.md` but is not in `apps/web/package.json`. Phase reorder shipped as up / down buttons.
