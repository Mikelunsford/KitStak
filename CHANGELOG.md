# Kitstak Changelog

All notable changes to Kitstak are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.9.0] · 2026-05-20 Phase 9 Observability close-out (PRs #65, #66, #67)

Sentry SaaS error + performance capture activated end-to-end. Three-PR arc closes the SPA portion of `F-Wave5-CO-01` / `F-Wave3-OBS-01`, which have been operator-gated since Wave 3. Full closeout at `03-workspace/journal/phase-9-sentry-spa.md`.

### Added

- **F-Wave5-CO-01 / F-Wave3-OBS-01 SPA chassis (PR #65 at `9303408`)**: new top-level dep `@sentry/react@^8.40.0` (MIT, operator approved). New `apps/web/src/lib/sentry.ts` typed wrapper mirroring the F-Wave5-CO-02 PostHog chassis byte for byte: lazy-loaded via dynamic `import('@sentry/react')` inside `initSentry`, named `manualChunks.sentry` in `vite.config.ts`, no-op when `VITE_SENTRY_DSN` is absent at build (tree-shakes to zero chunk emission). `main.tsx` fires `void initSentry()` BEFORE `ReactDOM.createRoot.render` so render-time errors during the very first paint are captured. `ErrorBoundary.componentDidCatch` forwards via `captureException`. `AuthContext` identifies the opaque Supabase user UUID on sign-in + cold-mount recovery; resets on sign-out. 15 unit-test assertions in `apps/web/src/lib/sentry.test.ts` covering init no-op, idempotency, identify / reset / capture short-circuits, and the full PII-scrub surface. Sample-rate defaults: `tracesSampleRate: 0.1`, `replaysSessionSampleRate: 0.0`, `replaysOnErrorSampleRate: 1.0`. Replay masking matches PostHog: `maskAllInputs: true`, `blockAllMedia: true`. Bundle delta: main `index-*.js` chunk at 29.95 kB / 40 kB (was 29.94 kB; +0.09 kB). New env vars: `VITE_SENTRY_DSN`, `VITE_SENTRY_ENVIRONMENT`, `VITE_SENTRY_TRACES_SAMPLE_RATE`, `VITE_SENTRY_REPLAY_SESSION_SAMPLE_RATE`. Edge-function (Deno-side) Sentry capture filed as `F-Wave5-CO-01-EDGE-01`; production source-map upload filed as `F-Wave9-SENTRY-SOURCEMAPS-01`.

### Fixed

- **F-Wave5-CO-01 closeout: Relay IP suppression hardening (PR #67 at `4a9a69a`)**: first captured Sentry event surfaced a constitutional PII gate breach. Operator's source IP `98.172.8.242` and city-level Geography `Fayetteville, US` appeared in the event despite `sendDefaultPii: false` plus `beforeSend` `delete event.user.ip_address`. Root cause: Sentry has TWO PII layers. SDK-side controls (which `sentry.ts` covered correctly) prevent the SDK from SENDING the IP. Server-side Relay (Sentry's ingest pipeline) enriches events with IP from the request source UNLESS the event arrives with `ip_address` explicitly set to `null` AND the project-level "Prevent Storing of IP Addresses" toggle is ON. With `delete`, the field is absent and the Relay treats absence as permission to auto-fill. Two-part fix: 1) operator flipped Sentry Project Settings → Security & Privacy → "Prevent Storing of IP Addresses" ON; 2) `beforeSend` now sets `event.user.ip_address = null` explicitly (not delete) and synthesises `{ ip_address: null }` on the user object even when input had no user, so anonymous events also carry the opt-out signal. Three new unit-test assertions added (16 sentry tests total, all passing). Three-layer PII gate now holds: SDK `sendDefaultPii: false` + event `ip_address = null` + project-level toggle. The first smoke-test event captured BEFORE the project-level Relay setting was flipped retains the operator's IP as a historical artefact; future events do not. Verification: Sentry Issue `JAVASCRIPT-REACT-1`, event `64a6acc3`, captured via a controlled `document.body.addEventListener('click', () => { throw new Error(...) }, { once: true })` smoke test from incognito Chrome; payload spot-checked clean of email / cookies / query string / Authorization. The original journal's claim that "`sendDefaultPii: false` refuses IP and cookies by default" was technically true at the SDK layer but incomplete; corrected in the journal's new "Activation" section.

- **Vercel "Sensitive" env-var workflow gap (PR #66 at `3e4fba6`)**: `deploy-prod.yml` runs `vercel build` on GitHub Actions runners. `vercel pull --environment=production` deliberately does NOT pull env vars flagged "Sensitive" in the Vercel project to the local `.env.local` that `vercel build` then reads — this is a documented Vercel security behaviour: Sensitive vars are only injected when the build runs on Vercel's own infrastructure. Both `VITE_SENTRY_DSN` (Sensitive from the start) and `VITE_POSTHOG_KEY` (Sensitive after some later operator-side edit) were affected. **The PostHog regression was silent**: the F-Wave8-POSTHOG-PROJECT-SETUP-01 closeout journal had recorded events flowing; subsequent Sensitive marking broke events without any deploy failing. The Sentry verification dive was what surfaced the gap. Fix mirrors the established pattern in `lighthouse.yml`: inject the two `VITE_*` values from GitHub repo secrets at the `env:` block of the `vercel build` step in `deploy-prod.yml`. Both values are frontend-public by design (PostHog Project Tokens are rate-limited per project; Sentry DSNs are rate-limited per project) so storing them as GitHub repo secrets carries no incremental risk vs the SPA bundle itself. After the fix, the deployed bundle hash changed and contained: PostHog `phc_*` token, `us.i.posthog.com` literal, Sentry ingest URL `o4511423231229952.ingest.us.sentry.io`, DSN public key `1b5b27cb6dc46bfaad38424597ebc63c`; new `sentry-CF0Aje5m.js` lazy chunk emitted. PostHog events resumed flowing within ~2 minutes of merge.

### Filed (Phase 9 carryover)

- `F-Wave5-CO-01-EDGE-01`: Deno-side Sentry capture for the ~18 Edge Functions under `supabase/functions/`. Recommended shape per the F-Wave5-CO-01 scoping survey: central wrapper in `_shared/handler-helpers.ts` so all functions instrument for free. Server-side env var would be `SENTRY_DSN` (NOT `VITE_*`).
- `F-Wave9-SENTRY-SOURCEMAPS-01`: production source-map upload via `@sentry/vite-plugin` so Sentry events arrive with deminified frames. Requires `SENTRY_AUTH_TOKEN` build-time secret (must NOT carry `VITE_` prefix).
- `F-Wave9-NODE20-DEPRECATION-01`: GitHub Actions Node.js 20 deprecation by 2026-06-02 (forced default flip), removed 2026-09-16. All six Kitstak workflows affected.
- `F-Wave9-VERCEL-NATIVE-BUILD-CONSIDER-01`: consider whether the `deploy-prod.yml`-on-GitHub-Actions architecture should migrate to Vercel's native git integration to render the Sensitive-env-var gotcha class architecturally moot.
- `F-Wave9-FONT-DECODE-ERROR-01`: production console emitted `Failed to decode downloaded font` plus `OTS parsing error` warnings during Sentry verification; one of three Google Fonts URLs in `apps/web/index.html` likely returns HTML instead of font bytes. Spawned as background task.

### Constitution

- `CLAUDE.md` "What we use" gains `@sentry/react` entry under the SPA-only line, mirroring the `jspdf` precedent from F-Wave2-CO-01.

## [0.8.0] · 2026-05-20 Phase 8 Polish close-out (PRs #56 through #64)

10 code follow-ups closed + 3 deferrals documented with explicit revisit triggers (SIDEBAR-IA waits on first operator nav-gap feedback; PRODUCTION-LINES-NORMALIZE waits on Pillar 2 light-up; PDF-STORAGE-BUCKET waits on customer share-link demand). Phase 8 closes a wide polish batch spanning analytics, PDF rendering, drag-and-drop, CI guardrails. Detailed entries in STATUS.md "Closed in this session (Phase 8 follow-up batch)" section.

### Added

- **F-Wave5-CO-02 PostHog analytics chassis (PR #58)**: `posthog-js@1.374.2` (MIT) added. New `apps/web/src/lib/analytics.ts` typed wrapper exposing `initAnalytics`, `identifyUser`, `resetAnalytics`, `track` with a bounded `AnalyticsEvent` union of exactly 5 funnel events: `signed_in`, `quote_sent`, `project_converted`, `invoice_sent`, `payment_received`. PII posture: opaque Supabase `user.id` UUID identifier, monetary amounts bucketed (`under_1k` / `1k_to_10k` / `10k_to_100k` / `over_100k`) via `bucketCents` so absolute dollar values never leave the SPA; no email / name / phone / address; session-recording masks all inputs. Lazy-load via `manualChunks.posthog`; tree-shaken to zero growth when `VITE_POSTHOG_KEY` absent at build. Activated 2026-05-20 against PostHog US Cloud project 433097 (closed as `F-Wave8-POSTHOG-PROJECT-SETUP-01` in PR #64). Journal at `03-workspace/journal/phase-8-posthog-analytics.md`.

- **F-Wave2-CO-01 PDF worker real-render (PR #56-style)**: `jspdf` (Apache-2.0 / MIT-permissive, operator approved as worker-side only; not allowed in SPA bundle). Three template renderers: invoice, quote, purchase_order. Each carries its own discriminated-union Zod schema at the worker boundary. Returns `data:application/pdf;base64,...` data URL; SPA service already expects `{ url: string }`. Brand palette applied (navy header, ink display text). 10-page hard cap; "Built to Ship." footer. Download PDF buttons added to InvoiceDetailPage, QuoteDetailPage, PODetailPage with `pdf.document.render` capability gate. Journal at `03-workspace/journal/phase-8-pdf-worker-jspdf.md`.

- **F-Wave8-PDF-FONT-EMBED-01 + F-Wave8-PDF-QUOTE-DOWNLOAD-01 + F-Wave8-PDF-PO-DOWNLOAD-01 (PR #60)**: Bebas Neue (56 KB display) + Inter Tight (298 KB body) bundled under SIL Open Font License 1.1 at `supabase/functions/pdf-worker/fonts/`. `scripts/encode-fonts.mjs` (zero deps) generates `fonts.ts` with base64 string constants; worker registers via `doc.addFileToVFS` + `doc.addFont`. SPA bundle delta zero (fonts are worker-only). Quote and PO download wiring added with vendor/customer FK resolution and `po_number ?? id.slice(0,8)` fallback for unnumbered draft POs. Test asserts both font names appear in PDF binary plus 1-line render under 2 MB. Journal at `03-workspace/journal/phase-8-pdf-polish.md`.

- **F-Wave2-DNDKIT-01 phase reorder UI**: `@dnd-kit/core@6.3.1` + `@dnd-kit/sortable@8.0.0` + `@dnd-kit/utilities@3.2.2` (all MIT, operator approved). New `apps/web/src/pages/3pl-operations/projects/PhasesSection.tsx` carries `DndContext` + `SortableContext` + `useSortable` + `GripVertical` drag handle. PointerSensor `activationConstraint: { distance: 4 }` so click on rest of card never starts a drag; KeyboardSensor wires Space + Arrow keys. Optimistic update with revert-on-error. Lazy-loaded via `React.lazy(() => import('./PhasesSection'))` at the ProjectDetailPage route boundary; main SPA index chunk lands at 29.79 kB / 40 kB (+0.04 kB delta). dnd-kit chunk at 48.94 kB raw / 16.56 kB gzipped. Up/Down buttons preserved as accessibility baseline. Journal at `03-workspace/journal/phase-8-dnd-kit-phase-reorder.md`.

- **F-Wave2-AGENT-A-05 master capability table consolidation**: six side-car cap files folded into singular `_shared/capabilities.ts` + `apps/web/src/lib/capabilities.ts` byte-mirror pair. 203 caps total across 8 roles in one union. Per-bundle `requireXxxCap` shim pattern (D-011) retired; handlers now import `requireCap` from `_shared/handler-helpers.ts` directly. Six cross-cutting bundles converted from `hasCrossCuttingCap` boolean check to `requireCap`. `customer-portal-api` carve-out preserved (Pattern B RLS). Journal at `03-workspace/journal/phase-8-cap-consolidation.md`.

### Fixed

- **F-Wave8-CI-VERCEL-DEDUPE-01 (PR #59)**: Deleted `.github/workflows/deploy-preview.yml`; Vercel's native Git integration already deploys PR previews. `deploy-prod.yml` retained for explicit CLI prod deploys on main push.

- **F-Wave8-CI-NIGHTLY-SKIP-GUARDS-01 (PR #62)**: Two nightly workflows (`audit-chain-verify`, `idempotency-gc`) were hard-failing every night with `curl: (22) error 401` because `SUPABASE_FUNCTION_URL`, `AUDIT_VERIFY_SECRET`, `GC_TRIGGER_SECRET` were not configured in repo Actions secrets. Both workflows now carry a leading `Verify secrets are configured` step mirroring the `nightly-rls-probe` pattern; the actual Invoke step is gated on `if: steps.secrets.outputs.configured == 'true'`. Schedule still fires; GitHub UI stays green with an informational notice instead of red 401. The merge also served as a no-op push to re-trigger `deploy-prod` after a Vercel free-tier `api-upload-free` rate-limit window (5000 file uploads in 24 h, hit at 04:22 UTC after the Phase 8 batch session shipped 10 PRs) had elapsed.

- **F-Wave7-EMIT-MOVEMENTS-MIGRATION-01**: Step 2 of LINES-01 multi-stage drop. Migration `0051_emit_movements_read_line_item_tables.sql` redefines `tg_receiving_orders_emit_movements` and `tg_shipments_emit_movements` to read from `receiving_order_line_items` and `shipment_line_items` (normalised tables added in 0050) instead of `(new.payload -> 'lines')` JSON. The 0048 exception-wrapped skip guard for missing-or-non-castable `item_id` removed because new tables enforce `item_id NOT NULL`. Handler dual-write to `payload.lines` remains until step 3 (`F-Wave7-LINES-DUAL-WRITE-DROP-01`); JSON field dropped in step 4 (`F-Wave7-LINES-PAYLOAD-DROP-01`). `tg_production_runs_emit_movements` left untouched (production_runs line normalisation is deferred as `F-Wave7-PRODUCTION-LINES-NORMALIZE-01`).

- **F-Wave7-FK-RENDER-SWEEP-02**: 7 list-page sites migrated from `<row>.<fk>_id.slice(0, 8)` to `<EntityLabel kind="..." id={...} />` (ProductionRunsListPage output_item_id, POsListPage vendor_id, ReceivingOrdersListPage warehouse_id, StockLevelsPage item_id, StockMovementsPage item_id, ShipmentsListPage warehouse_id, VendorBillsListPage vendor_id). 14 `<row>.number ?? <row>.id.slice(0, 8)` fallback patterns left as-is (correct shape for unnumbered rows). Round-3 candidates filed as `F-Wave8-ENTITYLABEL-CATEGORY-UNIT-HOOKS-01`.

- **F-Wave7-STALE-6_5-TODOS-01**: Four stale narrative TODO comments removed across `OpportunityDetailPage.tsx`, `ProjectDetailPage.tsx`, `useProjects.ts`. Allowlist block in `scripts/canon-steward-allowlist.txt` dropped; check exits 0 against cleaned tree.

### Filed (Phase 8 carryover)

- `F-Wave7-SIDEBAR-IA-01` (deferred): seven intentional orphan routes. Operator chose to leave as-is at zero paying customers; revisit on first operator nav-gap feedback.
- `F-Wave7-LINES-DUAL-WRITE-DROP-01`: step 3 of LINES-01 multi-stage drop.
- `F-Wave7-LINES-PAYLOAD-DROP-01`: step 4 of LINES-01 multi-stage drop.
- `F-Wave7-PRODUCTION-LINES-NORMALIZE-01` (deferred): mirror of LINES-01 for production_runs; revisit on Pillar 2 (Manufacturing) light-up.
- `F-Wave8-ENTITYLABEL-CATEGORY-UNIT-HOOKS-01`: list-hook plus EntityLabel branch lands alongside first display site for category / unit / tax UUIDs.
- `F-Wave8-POSTHOG-FEATURE-FLAGS-01`: PostHog feature-flag SDK wiring (unblocked by activation).
- `F-Wave8-POSTHOG-FUNNEL-EXPANSION-01`: expand event set once enough data accumulates (unblocked by activation).
- `F-Wave8-NIGHTLY-RLS-PROBE-INVESTIGATE-01`: `nightly-rls-probe` workflow passes the skip-guard, runs through `pnpm install` + `playwright install`, then fails inside the actual probe spec. Constitutional (RLS filters never throws; 403-where-404-expected is a release blocker per CLAUDE.md). Not blocking the current close-out batch but high-value.
- `F-Wave8-PDF-STORAGE-BUCKET-01` (deferred): optional "send shareable PDF link" flow via Supabase Storage bucket + signed URL; revisit on customer share-link demand.

## [0.7.4] · 2026-05-19 Phase 7 stabilization close-out (PRs #37 to #48)

All fourteen Phase 7 stabilization follow-ups closed across twelve PRs in three parallel cycles. Full closeout at `03-workspace/journal/phase-7-stabilization-closeout.md`. Phase 7 stabilization is now closed; Phase 8 carryover follow-ups filed.

### Boundary canon (PRs #37, #42, #44, #45)

- **F-Wave7-LISTENVELOPE-01 (PR #37 at `db6912e`)**: 8 handler sites across `quotes-api`, `sales-config-api`, `collaboration-api`, `customer-portal-api` canonicalised from `ok({items: data ?? []})` to `ok(data ?? [])`. 4 SPA services adjusted to consume flat arrays. Same drift class as PR #25 and PR #26 from the Phase 6 hotfix storm; none of the affected routes were on the operator's daily path.
- **F-Wave7-LINEFORM-VALIDATE-01 (PR #42 at `5ab63a5`)**: strict zod line schemas on receiving / shipment / production_run handlers. ProductionRun split into Consumed (strict, `item_id` required) and Produced (lenient, `item_id` may be null per the trigger's `coalesce(item_id, output_item_id)` shape). 8 new regression tests. Uses the existing `422 VALIDATION_ERROR` convention.
- **F-Wave7-LITDRIFT-01 (PR #44 at `5aa44a9`)**: new `_shared/constants.ts` plus byte-mirrored `apps/web/src/lib/constants.ts` added to the parity manifest; byte-mirror pair count moves from 25 to 26. 33 consumer sites converted across 3 categories: 8 feature flag keys, 9 header names, 16 error code emit/match sites. 5 literals intentionally left inline (SQL bodies, docs, PDF worker 501 stub, bundle-local `INTERNAL_ERROR`, Bearer prefix).
- **F-Wave7-UUID-GUARD-01 (PR #45 at `006d345`)**: new `parseUuidParam(value, paramName)` helper in `_shared/handler-helpers.ts`. `BAD_REQUEST` added to `ApiErrorCode` enum plus `STATUS_FOR_CODE` map. 150 invocations across 25 handler files. 4 new tests. Valid-UUID happy path byte-for-byte unchanged. The F-Wave6-WAREHOUSE-CREATE-01 root cause would have been a clean 400 instead of a 500 with this guard.

### SPA polish (PRs #40, #41)

- **F-Wave7-FK-RENDER-SWEEP-01 (PR #40 at `77eda56`)**: new `apps/web/src/components/ui/EntityLabel.tsx` helper with 8 entity kinds (warehouse, customer, vendor, project, item, contact, lead, account). Applied to 5 detail pages: Shipment, ProductionRun, JournalEntry, Contact, Lead. `ReceivingOrderDetailPage`'s PR #31 inline `useWarehousesList` pattern left intact pending soak; migration tracked as `F-Wave7-RECEIVING-DETAIL-ENTITY-LABEL-01`. Round-2 candidates (`category_id`, `unit_id`, `default_tax_id`, `tax_id`, `vendor_id`, list-page UUID-slice truncations) filed as `F-Wave7-FK-RENDER-SWEEP-02`.
- **F-Wave7-AUDIT-CACHE-SWEEP-01 plus F-Wave7-MUTATION-ERRORS-SWEEP-01 (PR #41 at `b9de37c`)**: 9 mutation hook files (`useProjects.ts`, `useInvoices.ts`, `useCreditNotes.ts`, `useJournalEntries.ts`, `usePurchaseOrders.ts`, `useVendorBills.ts`, `useExpenses.ts`, `useReceivingOrders.ts`, `useShipments.ts`) wired `auditLogKeys.byEntity('<entity>', id)` invalidation for 13 entity types. Project phases, leads, opportunities, production runs got the same treatment in their existing hook modules. 15 consumer pages got inline `mutation.error.message` rendering, submit-button-disabled-while-pending, and `mutate(..., { onSuccess })` rewrites where the call site still used `await mutateAsync` with no error path.

### Schema normalisation (PRs #46, #47, #48)

- **F-Wave7-CRM-SCHEMA-01 (PR #46 at `4b04e6d`)**: migration `0049_customers_default_payment_terms_days.sql` adds `customers.default_payment_terms_days integer null check (default_payment_terms_days >= 0)`. Side-car `CustomerSchema` extended on both sides of the byte-mirror. `crm-api` customer create / update handlers accept the field. `CustomerCreatePage` and `CustomerEditPage` gain a "Default payment terms (days)" number input. Closes the work PR #38's agent properly refused on principled grounds; the original side-car-only framing was inaccurate because the DB layer did not carry the column.
- **F-Wave7-LINES-01 (PR #47 at `9cb95ce`)**: migration `0050_receiving_shipment_line_items.sql` (renumbered from 0049 because PR #46 landed first and claimed 0049) creates `receiving_order_line_items` and `shipment_line_items` with Pattern A RLS, denormalised `org_id`, `quantity numeric(18,4)`, nullable `unit_cost_cents bigint`, position-ordered. Idempotent backfill from `payload.lines` JSON guarded by `NOT EXISTS`. 8 new ops-api routes per entity with idempotency and dual-write back to the parent's `payload.lines` JSON so the existing `emit_movements` triggers (0032 plus 0048) keep firing correctly until the next-release migration moves them off the JSON read. Two new capability groups (`receiving.line_item.*`, `shipment.line_item.*`) added to the `vendors_inventory_ops` side-car only via the D-011 per-bundle shim; singular `_shared/capabilities.ts` untouched. SPA gets Add Line / Remove Line UI on the two detail pages. Production runs intentionally out of scope (tracked as `F-Wave7-PRODUCTION-LINES-NORMALIZE-01`). Multi-stage drop plan split into three forward migrations tracked as `F-Wave7-EMIT-MOVEMENTS-MIGRATION-01`, `F-Wave7-LINES-DUAL-WRITE-DROP-01`, `F-Wave7-LINES-PAYLOAD-DROP-01`.
- **F-Wave7-LISTFILTER-01 (PR #48 at `9846f1e`)**: 10 of 12 audited endpoints needed server-side filter additions. STATUS.md's prior claim of "Server endpoints already support the filters" was inaccurate. Only `invoices.customer_id` and `payments.customer_id` were truly server-side supported. 10 endpoints across `quotes-api`, `projects-api`, `invoicing-api`, `vendors-api`, `ops-api` got `customer_id` / `vendor_id` / `project_id` filter parameters. 8 SPA services plus 8 hooks plus 4 query-key files updated to thread filter args into `queryKey`. Client-side `.filter(...)` removed from `CustomerDetailPage` and `VendorDetailPage`. 8 new RLS probe rows confirm filters honour cross-tenant scope.

### CI guardrails and infrastructure (PRs #38, #39, #43)

- **F-Wave7-EXPENSE-SCHEMA-01 (PR #38 at `f60850d`)**: `ExpenseSchema` extended with `project_id: z.string().uuid().nullable().optional()` on both sides of the byte-mirror. `ExpenseCreatePage` typed cast removed. The CRM half of the original dispatch was properly refused: the agent verified at the DB layer that `customers.default_payment_terms_days` did not exist and filed for re-scope.
- **F-Wave7-ESM-SH-DRIFT-01 (PR #39 at `b402613`)**: 24 edge-function files plus `vitest.regression.config.ts` converted from `https://esm.sh/...` URL imports to bare imports resolved via `supabase/functions/deno.json` import map. One new map entry for `@supabase/supabase-js@2.45.0` (PR #6 from Wave 2 hotfix had already mapped `zod`). The Vitest regression config's URL-rewrite stripped because bare specifiers now resolve through `node_modules` directly. Supabase Preview branch auto-discovers `deno.json` so the conversion did not require a workflow change. Every edge function deploy was a coin flip against CDN availability; the conversion removes the dependency entirely.
- **F-Wave7-CANON-STEWARD-01 plus F-Wave7-TRIGGER-AUDIT-01 (PR #43 at `0b8fd9e`)**: two new CI grep guardrails at `scripts/canon-steward-check.mjs` and `scripts/trigger-audit-check.mjs`, each wired into `.github/workflows/ci.yml`. Canon-steward greps for `Placeholder` / `TODO 6.5-*` / `TODO Canon Steward` markers, and additionally checks that every `<Link to="/foo/new">` resolves against a registered route and that every list page in `routes.ts` is reachable from at least one Sidebar entry. Trigger-audit greps for `insert into <table> ... NOT NULL ...` patterns inside `create or replace function` blocks and cross-checks against migration NOT NULL columns. 13 baseline violations allowlisted with traceable closure reasons (4 Phase 6.5 narrative TODOs, 7 intentional orphan deep-link routes, 2 historical trigger insertions closed by migrations 0047 and 0048). Sub-1s runtime each. Spawns `F-Wave7-STALE-6_5-TODOS-01` and `F-Wave7-SIDEBAR-IA-01`.

### Reframes codified

- **CRM-SCHEMA-01 refusal as a pattern win.** A thorough constitutional brief gave PR #38's agent the cover to fail safe on the side-car-only half of the dispatch rather than ship a half-fix. The work was picked up cleanly in Cycle 3 by PR #46 with the missing migration as the headline deliverable. Document as a pattern: when a side-car-only patch's STATUS framing is "the DB already has this", verify at the DB layer before opening the diff.
- **Parallel migration-bearing dispatches need pre-reserved migration numbers.** PR #46 and PR #47 both authored migration 0049 off the same baseline. The collision was caught at PR-merge time, not at agent-spawn time. PR #47 was rebased and renumbered to 0050. No data impact and both migrations are idempotent. Codified response: future parallel migration-bearing dispatches in the same cycle should reserve migration numbers upfront in the orchestrator's brief.
- **Agent Router cycles validated for stabilization scope.** Three cycles, twelve agents, zero agent constitutional violations, one principled refusal, one mechanical post-merge renumber. The shape of the scope dictates the shape of the dispatch: hotfix-storm (one agent per symptom) for operator-walked surfacing, Shape B (schema/RPC stage before dependent-UI stage) for cross-domain coupling, and parallel-cycle `Confidence: high` for stabilization (sweeps, schema gap-fills, CI guardrails).

## [0.7.3] · 2026-05-19 Phase 6 polish close-out (PRs #31 to #35)

The day after the F-Wave6-FLOW-01 walk, five polish PRs cleared the carryover bucket. Full closeout at `03-workspace/journal/phase-6-polish-closeout.md`. Phase 6 is now closed; the active scope is Phase 7 stabilization.

### Fixed (F-Wave6-WAREHOUSE-NAME-01, PR #31 at `73e4a96`)

`ReceivingOrderDetailPage` rendered `Warehouse: 8c9f2... (UUID)` instead of a human label. The page now resolves `warehouse_id` via `useWarehousesList` and renders `{code} · {display_name}` with raw-UUID fallback if the lookup misses. SPA-only edit. Spawns `F-Wave7-FK-RENDER-SWEEP-01` for the five other detail pages with the same shape (Shipment, ProductionRun, JournalEntry, Contact, Lead).

### Fixed (F-Wave6-ITEMS-403-01, PR #32 at `c06b545`)

`ItemPicker` returned `403 FORBIDDEN` on `GET /sales-config-api/items` for every role on every page. Root cause: `sales-config-api/index.ts` imported `requireCap` from `_shared/handler-helpers.ts`, which validates against the singular `_shared/capabilities.ts` carrying only the 14 `org.*` caps. Sales caps live in the sales side-car. Every `sales.*` cap lookup against the singular canon fell through to FORBIDDEN. The bundle has been silently 403'ing since it shipped in Wave 2; nothing in the SPA exercised an authenticated `sales-config-api` route until Wave 6.5 mounted `ItemPicker` across the chassis. Fix: new `supabase/functions/sales-config-api/_helpers.ts` shim consulting the sales side-car canon, mirroring the D-011 quotes-api / invoicing-api / projects-api pattern. The singular byte-mirrored `_shared/capabilities.ts` was not touched. Deploy gotcha: first `deploy-functions` run on the merge SHA failed on a transient esm.sh 522 against `https://esm.sh/zod@3.23.8` (run 26123760836); rerun on the same SHA succeeded. The broader pattern is filed as `F-Wave7-ESM-SH-DRIFT-01`.

### Fixed (F-Wave6-LINEFORM-01, PR #33 at `f6b8469`)

Add Material form on `ProjectDetailPage` swallowed `useAddProjectLineItem` failures. Operator typed `2.5` into "Unit price (cents)" expecting dollars; server returned 422; form silently did nothing. Root cause: handler called `await mutateAsync(...)` with no `onError` and no inline error surface. Fix: switched to `mutate(..., { onSuccess })` so React Query's error state is preserved on the mutation object; `addLine.error.message` rendered inline beneath the form mirroring PR #21's convert-to-project pattern; submit disabled while pending; label relabeled to `Unit price (whole cents, e.g. 250 = $2.50)` to defuse the dollars-vs-cents trap. Spawns `F-Wave7-MUTATION-ERRORS-SWEEP-01` (128 `useMutation` sites across 28 files, 7 of them CRM CreatePages on the daily path).

### Fixed (F-Wave6-PRODUCTION-CREATE-01, PR #34 at `9982980`)

Mirror of PR #27. `/3pl-operations/production` had list and detail routes but no `/new` route and no `ProductionRunCreatePage`; the list page's "New Production Run" CTA fell through to `/:id` with `id="new"` and surfaced a 500 on the Postgres uuid cast. Fix: new `ProductionRunCreatePage.tsx` modeled on `WarehouseCreatePage.tsx`, `/new` registered before `/:id` in `routes.ts`, capability-gated CTA added to the list page header. Bundle 29.4 / 40 kB (+0.83 kB).

### Fixed (F-Wave6-AUDIT-02, PR #35 at `347062f`)

Operator's test quote HISTORY tab showed only `draft -> submitted`. Expected `submitted -> approved` row did not appear, even though the quote was at `approved` and the Convert-to-Project button was enabled. Reframe: this turned out to be neither a trigger gap (Hypothesis A) nor an `AuditTimeline` filter (Hypothesis B). Read-only DB inspection confirmed the `submitted -> approved` row exists in `audit_log` with the right shape and hash chain link; `AuditTimeline.tsx` does not filter by row shape. Actual root cause: TanStack cache invalidation. `useQuoteAction` (submit / approve / send) and `useConvertQuoteToProject` invalidate `quotesKeys.*` on success but never the audit timeline's query key. With `staleTime: 30_000` + `refetchOnWindowFocus: false`, an operator who stays on the detail page through Submit then Approve sees the cached pre-approve snapshot of the audit timeline. DB row exists; SPA never re-fetches. Fix: new `apps/web/src/lib/queryKeys/auditLog.ts` factory with `auditLogKeys.byEntity(entityType, entityId)`; `AuditTimeline.tsx` keys off it; `useQuotes.ts` invalidates `auditLogKeys.byEntity('quote', id)` after every state-changing mutation and after convert-to-project. Spawns `F-Wave7-AUDIT-CACHE-SWEEP-01`: the same bug class almost certainly affects thirteen other state-machine detail pages (projects, invoices, credit notes, journal entries, purchase orders, vendor bills, expenses, receiving orders, production runs, shipments, leads, opportunities, project phases).

### Reframes codified

- **AUDIT-02 is a new bug class: stale audit-log cache after a state-machine mutation.** The diagnostic ladder is durable: DB row exists? -> filter at the render layer? -> cache invalidation at the query layer? Every TanStack mutation that writes a state transition must invalidate both the entity query keys and the audit-log query key for that entity. Tracked as `F-Wave7-AUDIT-CACHE-SWEEP-01`.
- **Deploy esm.sh URL imports are a systemic risk.** 25 files across `supabase/functions/` use `https://esm.sh/...` URL imports, including shared infrastructure (`_shared/handler-helpers.ts`, `_shared/idempotency.ts`). `supabase/functions/deno.json` already maps `zod` to `npm:zod@3.23.8`, so bare imports would bypass the CDN entirely. PR #32's deploy failed exactly once on a transient esm.sh 522. Tracked as `F-Wave7-ESM-SH-DRIFT-01`.

## [0.7.2] · 2026-05-19 Phase 6 quote-to-cash hotfix storm (PRs #24 to #29)

The operator walked F-Wave6-FLOW-01 end-to-end on prod. Six bugs surfaced, one per step of the chain; each shipped as its own hotfix PR in the same afternoon. Phase 6 gate now substantially passed at `0d190e3`. Full closeout at `03-workspace/journal/wave-6-flow-hotfix-storm.md`.

### Fixed (F-Wave6-AUDIT-01, PR #24 at `12eb2c8`)

Migration 0044's `trg_audit_project_line_items` passed `null` as `to_state` to `audit_append_state_change`, but `audit_log.to_state` is `NOT NULL`. Every insert into `project_line_items` rolled the entire convert transaction back and surfaced as "Convert failed: null value in column to_state of relation audit_log". Migration 0047 redefines the trigger so non-state-machine entities pass the action verb (`created` / `updated` / `deleted`) as `to_state`. `audit_log` schema, `audit_append_state_change`, and `convert_quote_to_project` untouched. Hash chain integrity preserved (`verify_audit_chain` treats `to_state` as opaque bytes). Unblocked: quote -> project convert.

### Fixed (F-Wave6-LINES-API-01, PR #25 at `99876af`)

`projects-api /projects/:id/line-items` returned `ok({ items: data ?? [] })` (a one-off shape) while `useProjectLineItems` was typed as a flat array. `apiClient` unwrapped one envelope level so the SPA hook received `{items: [...]}`. `(lineItems.data ?? []).map(...)` in `ProjectDetailPage` threw `TypeError: .map is not a function`; ErrorBoundary caught; the page rendered "Something went wrong" the moment an operator landed on a freshly converted project. Handler canonicalised to `ok(data ?? [])` matching the dominant CRM / invoicing / finance shape. Unblocked: project detail page render after convert.

### Fixed (F-Wave6-LISTUNWRAP-01, PR #26 at `35831db`)

PR #23's pagination conversion changed `inventory-api` to return `{items, next_cursor}`. Three SPA list services (`warehousesService`, `stockLevelsService`, `bomItemsService`) were still typed as flat-array returns; the `.map` inside the queryFn threw, React Query stored undefined data, lists rendered silently empty. Fix: zod-parse the envelope and return `.items`. Three files touched. Unblocked: every Inventory list page (Warehouses, Stock Levels, BOM Items).

### Fixed (F-Wave6-WAREHOUSE-CREATE-01, PR #27 at `1b6cf99`)

"New Warehouse" link in `WarehousesListPage` pointed at `/3pl-operations/warehouses/new` but no `/new` route was registered. The URL fell through to `/:id` with `id="new"`; the server tried `where id = 'new'::uuid`; Postgres threw; response was a 500. Fix: new `WarehouseCreatePage.tsx` plus the `/new` route registered before `/:id` in `routes.ts`. Unblocked: receiving-order create (needs a warehouse).

### Fixed (F-Wave6-EMIT-MOVEMENTS-01, PR #28 at `a564b1f`)

The three `stock_movements` emit triggers in migration 0032 cast `(v_line ->> 'item_id')::uuid` which threw NOT NULL violations the moment a receiving / shipment / production_run terminal transition fired against a payload line without `item_id`. Migration 0048 `create or replace`s all three trigger functions with a guarded `v_item_id` local that skips lines whose `item_id` is missing or non-castable. Production-runs `produced` branch preserved byte-for-byte. Unblocked: receiving received, shipment shipped, project completed.

### Fixed (F-Wave6-NAV-CRM-01, PR #29 at `0d190e3`)

Sidebar WORKSPACE was missing Contacts and Activities entries; the operator had no path from the shell to either list page. SPA-only three-line edit to `apps/web/src/components/shell/Sidebar.tsx`. Unblocked: contact and activity discoverability.

### Lessons codified

- Envelope drift (`ok({items: ...})` vs `ok(data, {next_cursor})`) is the recurring class. Same root in PR #25 and PR #26, and likely more lurking. Canonical shape needs to be enforced at the `ok()` helper or via a lint rule. Tracked as `F-Wave7-LISTENVELOPE-01`.
- Trigger inserts into NOT NULL columns are the recurring crash class. PR #24 (`audit_log.to_state`) and PR #28 (`stock_movements.item_id`) had the same shape. Tracked as `F-Wave7-TRIGGER-AUDIT-01`.
- Sidebar / route chassis drift surfaces only when an operator walks a path. PR #27 (no `/new` for warehouses) and PR #29 (no Contacts in WORKSPACE) both shipped silent for months. `F-Wave7-CANON-STEWARD-01` scope grew to cover the `<Link to="/foo/new">` -> route reachability check.

## [0.7.1] · Wave 6.5 hotfix (PR #21)

Three SPA regressions surfaced by operator F-Wave6-FLOW-01 re-test on post-Wave-6.5 prod. All three fixed in PR #21. SPA-only, Vercel auto-deployed, no migration, no edge function.

### Fixed

- ProjectDetailPage rendered the ErrorBoundary "something is wrong" page on first load. `useProjects.ts` shipped with `ProjectLineItemPlaceholder` (a TODO type Agent 6.5-A authored so it would not block on Agent 6.5-B's side-car landing). The Canon Steward consolidation pass missed replacing it with the real `ProjectLineItem` schema. Placeholder field names (`quantity_e3`, `line_total_cents`, `discount_bps`) did not match the real schema (`quantity`, `discount_percent`, no precomputed total). `formatCents(undefined)` threw on first row render. Fix: imports the real types from `@/lib/types/sales`; ProjectDetailPage reads `l.quantity` and computes line subtotal client-side as `qty * unit_price_cents * (1 - discount_percent/100)`; material-add form sends `quantity` (not `quantity_e3`) plus required `discount_percent: 0`; `useConvertProjectToInvoice` return type fixed to `{ invoice_id }` per the actual projects-api response (handler at `supabase/functions/projects-api/index.ts:465`); convert-to-invoice click handler navigates via `result.invoice_id`.
- "Convert to project" button click did nothing visible. `useConvertQuoteToProject` had no `onError` handler; STATE_CONFLICT (quote not in approved state) silently swallowed. Fix: QuoteDetailPage disables the convert button while pending, shows "Converting." label, renders `convert.error` inline when the mutation fails.
- 8 list pages had no "New X" CTAs to the Wave 6.5 create pages. Operator landed on OpportunitiesPipelinePage, LeadsKanbanPage, ContactsListPage, ReceivingOrdersListPage, ShipmentsListPage, PaymentsListPage, CreditNotesListPage, JournalEntriesListPage and saw no button. Fix: each gains an accent-styled Link CTA in the header matching the existing VendorBillsListPage pattern. ReceivingOrders had a pre-existing broken "Refresh" link pointing to `/3pl-operations/receiving`; corrected to `/3pl-operations/receiving/new` with the right label. ContactsListPage carries `customer_id` through the query string when present.

### Lesson codified

The placeholder coordination pattern (parallel agents stub each other's types so neither blocks) is useful; the Canon Steward resolution step needs a guardrail. `F-Wave7-CANON-STEWARD-01` follow-up: add a pre-commit check that fails the diff if a `Placeholder` / `TODO 6.5-*` / `TODO Canon Steward` marker is introduced or left in code.

## [0.7.0] · Wave 6.5 Workflow Integration Remediation

The Phase 6 workflow integration audit identified 41 cross-domain wiring gaps that the operator's `F-Wave6-FLOW-01` quote-to-cash exercise surfaced. The 48-probe matrix could not have caught these: probes hit edge functions directly with service-role JWTs; they do not traverse cross-domain SPA workflows. Phase 6.5 closed 39 of 41 gaps (2 LARGE line-normalization gaps deferred to Phase 7 with payload-JSON editors shipped as the interim).

Dispatch shape: Shape B from the audit (4 specialized agents across 2 stages plus 2 finishers per the new finisher-recovery pattern when Stage agents hit transient API blips).

### Added

- 5 forward migrations (0042 to 0046): seed_org_settings backfill for pre-0040 orgs, provision_organization self-healing patch, `project_line_items` table with RLS + audit trigger + capability set, `convert_quote_to_project` redefinition to carry line items, `convert_project_to_invoice` RPC, FK hardening sweep with new `project_id` columns on receiving_orders / shipments / expenses.
- 5 reusable pickers at `apps/web/src/components/ui/pickers/`: Customer, Project, Invoice, Item, Vendor. Shared props contract consumed across 12+ pages.
- 9 new create pages: PaymentCreatePage, CreditNoteCreatePage, ReceivingOrderCreatePage, ShipmentCreatePage, VendorBillCreatePage, LeadCreatePage, OpportunityCreatePage, ContactCreatePage, JournalEntryCreatePage.
- 6 new routes registered in `apps/web/src/routes.ts` (organized in 3 marker-bounded sections per agent).
- 4 new endpoints on `projects-api`: GET/POST/PATCH/DELETE `/projects/:id/line-items` and POST `/projects/:id/convert-to-invoice`. All gated via per-bundle `requireProjectCap` shim (D-011).
- Sales side-car extensions (byte-mirrored): `ProjectLineItemSchema`, `CreateProjectLineItemRequestSchema`, `UpdateProjectLineItemRequestSchema`, `ConvertProjectToInvoiceResponseSchema`. 4 new caps `project.line_item.{create,read,update,delete}` seeded across all 8 roles.
- Query-string carry-through wiring on 6 create pages (Quote, Project, Invoice, PO, Expense, plus the 3 new Stage-2 pages) so the "New X for this customer/vendor/project" CTAs from detail pages prefill the appropriate picker.

### Changed

- `ProjectDetailPage` rebuilt: customer + source quote display, line items / materials section with `ProjectLineItem` CRUD, related receiving / shipments / invoices sections, "Create invoice from project" button calling the new RPC.
- `VendorBillDetailPage` gained vendor display link plus "Record payment" form.
- `CustomerDetailPage` gained 6 related-entity sections (Quotes / Projects / Invoices / Payments / Contacts / Activities) with deep-link CTAs.
- `OpportunityDetailPage` gained customer link and "Create quote from opportunity" CTA.
- `POCreatePage` gained VendorPicker plus line items at create time (chain-POST pattern).
- `ExpenseCreatePage` gained category + vendor + project pickers.
- `VendorDetailPage` gained 4 related-entity sections.
- `QuoteCreatePage` / `InvoiceCreatePage` gained CustomerPicker plus 6 additional optional fields each.
- `provision_organization` patched to call `seed_org_settings()` forward (no more empty-flag-table orgs).

### Constitutional

- Singular `_shared/{types,workflow,capabilities,money}.ts` untouched. Sales side-car extended; byte-mirror parity intact across all 22 pairs (parity test 25 / 25).
- All 5 migrations forward-only and idempotent.
- All new POST/PATCH/DELETE endpoints require `Idempotency-Key`.
- `convert_project_to_invoice` follows the migration-0041 SECURITY DEFINER pattern with explicit `p_caller_org_id`.
- `project_line_items` ships with RLS Pattern A and the audit-on-state-change trigger.
- Brand discipline: zero violations on changed files.

### Lessons codified

- Cross-domain wiring is not a free byproduct of disjoint-domain dispatch; future multi-agent waves must explicitly charter a shared-UI agent (like 6.5-A) and a schema/RPC agent (like 6.5-B) before dispatching dependent-UI agents (like 6.5-C, 6.5-D).
- The finisher agent pattern: when a Stage agent fails partway through, spawn a small follow-up agent with the residual scope and a tight gate. Faster than re-dispatching the full Stage agent.
- `G-OPS-FLAG-01` (shipped earlier in PR #19) is the same string-literal drift class as `F-Wave6-CORS-01`. Phase 7 stabilization should sweep for similar drift and canonicalize cross-boundary constants in `_shared/`.

## [0.6.1] · G-OPS-FLAG-01 hotfix (PR #19) + Phase 7 prep CORS consolidation (PR #18)

PR #18 closed `F-Wave6-CORS-01` by having `_shared/responses.ts` import `corsHeaders()` from `_shared/cors.ts`; one source of truth for CORS allow-headers. PR #18 also added the seed_org_settings backfill proposal (operator decision then locked as Option A + B follow-up, both shipped in Phase 6.5 migrations 0042 + 0043).

PR #19 was the standalone `G-OPS-FLAG-01` hotfix surfaced by the Phase 6 workflow integration audit. `ops-api` bundle gate read `plugins.3pl`; canonical `seed_org_settings` writes `plugins.three_pl`; every shipments / receiving / production call returned 404 for any org seeded canonically. Standardized on `plugins.three_pl` across 8 files (3 active code, 5 comment/doc). No migration needed. Same class of bug as `F-Wave6-CORS-01`.

## [0.6.0] · Wave 6 Customer Zero chassis fixes

Phase 6 surfaced four foundational SPA -> edge-function wiring gaps that Wave 5's probe matrix could not have caught (the probes hit edge functions directly via service-role JWT, bypassing `apiClient`). All four landed in rapid succession from a single operator session on `www.kitstak.com`. Phase 6 chassis closed; operator quote-to-cash workflow exercise pending.

### Fixed (F-Wave6-API-01, PR #13)
- `apps/web/src/lib/apiClient.ts` called `fetch(path, init)` with relative paths (`/auth-api/me`, etc.). Vercel's catch-all SPA rewrite (`/(.*) -> /index.html`) returned `index.html`; `response.json()` rejected; every authenticated SPA call silently failed; Topbar rendered "No workspace". Fix: prepend `VITE_SUPABASE_URL + '/functions/v1'` to non-absolute paths, attach `apikey: VITE_SUPABASE_ANON_KEY` (Supabase gateway routing requirement), attach `Authorization: Bearer <access_token>` from `supabase.auth.getSession()` when a session exists. Falls back to the anon Bearer otherwise so `verify_jwt = false` bundles (`tenants-api/resolve-host`, `notifications-worker`, `admin-console-api`) still resolve pre-auth.

### Fixed (F-Wave6-API-02, PR #14)
- `_shared/cors.ts` and `_shared/responses.ts` did not list `apikey` in `Access-Control-Allow-Headers`. After F-Wave6-API-01 wired the SPA to send `apikey` + `Authorization`, browser preflight `OPTIONS` blocked every request. Fix: add `apikey` to both allow-headers lists. Drift noted: the two lists have diverged (`cors.ts` also lists `x-request-id` and `x-worker-secret`; `responses.ts` does not). Tracked as F-Wave6-CORS-01 follow-up.

### Fixed (F-Wave6-NAV-01, PR #15)
- Sidebar pointed Pillar 1 children at `/three-pl/receiving` and `/three-pl/shipments`. The flat ROUTES table registers them under `/3pl-operations/receiving` and `/3pl-operations/shipments` (matching the `pages/3pl-operations/` folder convention from Wave 2 domain ports). Clicking either rendered `/404`. Fix: align two Sidebar entries.

### Added (F-Wave6-NAV-03, PR #16)
- Sidebar refactored to unify the section type into one `NavSection` interface with optional `flag?: string`. Split into `CORE_SECTIONS` (always rendered) and `PILLAR_SECTIONS` (flag-gated, same disabled-state UI). New core sections:
  - **WORKSPACE**: Customers, Leads, Opportunities
  - **SALES**: Quotes, Projects, Invoices, Payments, Credit notes
  - **PROCUREMENT**: Vendors, Purchase orders, Vendor bills, Expenses
  - **INVENTORY**: Items, Warehouses, Stock levels, Stock movements
  - **FINANCE** (gated on `finance.journal_entries.enabled`): Chart of accounts, Journal entries, Period close
  - **TOOLS**: Search, Imports, Exports
  - **ADMIN**: Settings, Branding, Feature flags, Numbering (route-level `AdminProtectedRoute` still enforces role)
- 3PL Operations gains Production runs as a third pillar child (receiving / production / shipments triad).

### Data fixup (no PR)
- Direct SQL on prod via Supabase MCP: `select public.seed_org_settings('ba4622dd-eb46-41b6-b2dd-95c922bf44dd')` to insert the 10 default flag rows for the `kitstak` org (which was provisioned in Wave 1, before migration 0040 shipped `seed_org_settings`). Then `UPDATE` to enable `plugins.three_pl`, `feature.collaboration`, `feature.global_search`, `feature.imports`, `feature.exports`, and `INSERT ON CONFLICT` to enable `finance.journal_entries.enabled`. Pillars 2-5 stay off per the wave plan.

### Status
- Migration count holds at 41 (no schema changes this phase).
- All 23 edge function bundles redeployed automatically after F-Wave6-API-02 push (deploy-functions.yml fires on `supabase/functions/**` changes).
- Bundle size: 28.57 kB gzip / 40 kB cap (up 2.63 kB from 25.94, attributed to apiClient session-refresh logic + 24 new lucide-react icon imports for the expanded Sidebar).
- Brand discipline preserved: zero user-facing violations on changed files.

### Open follow-ups
- `F-Wave6-CORS-01`: consolidate the two CORS allow-headers lists by having `responses.ts` import from `cors.ts`. Deferred to Phase 7 polish.
- `F-Wave6-NAV-02`: align other pillar child paths (`/manufacturing/*`, `/copack/*`, `/kitforce/*`, `/kitcost/*`) when those pillars light up.
- `F-Wave6-FLOW-01`: operator-led quote-to-cash exercise on prod. The chassis is wired; the workflow exercise is the remaining Phase 6 gate.

## [0.5.1] · Wave 5 Hotfix 5: migrate.yml pooler hostname (F-Wave5-INFRA-01)

### Fixed
- `.github/workflows/migrate.yml` pooler hostname corrected from `aws-0-us-west-1.pooler.supabase.com` to `aws-1-us-west-1.pooler.supabase.com`. Wave 2 hotfix 1 (PR #5) fixed the region tail (`us-west-2` -> `us-west-1`) but the prefix change to `aws-0` was based on Supabase docs at the time. The authoritative pooler host per the Supabase Management API (`GET /v1/projects/<ref>/config/database/pooler`) is `aws-1-us-west-1.pooler.supabase.com`. The `aws-0` prefix DNS-resolves but routes to a different tenant pool, returning `FATAL: Tenant or user not found (SQLSTATE XX000)` on every connection attempt.
- The Supabase GitHub integration's auto-apply path (used by Preview branches) bypasses the pooler and uses the Management API, so this bug was masked through Phase 4 and only surfaced when Phase 5's probe matrix triggered the formal `migrate.yml` path on prod.
- Verified post-fix via `workflow_dispatch` (run 26057079796): `Connecting to remote database... Remote database is up to date. ✓`

### Status
- Migration count holds at 41 applied (slots 0001 - 0041; 0005 / 0006 intentionally empty). No migration changes.

## [0.5.0] · Wave 5 Probes and Observability

### Added
- `apps/web/playwright/rls-probe.spec.ts` (895+ lines, 48 `@rls`-tagged tests). Bootstraps two ephemeral orgs plus one user per org via `supabase.auth.admin.createUser` and `auth.admin.updateUserById` (stamps `kitstak_org_id` / `kitstak_org_role` onto `app_metadata`), then signs in to mint a real JWT. `test.afterAll` tears down via service-role, best-effort and idempotent. Skips at module level when any of `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` is absent.
  - Categories: list reads (10) and unqualified reads (2) cross-tenant return 200 + []; detail reads (6) cross-tenant return 200 + []; workflow POSTs (11) return 404 (never 403); bundle gates `plugins.three_pl` and `platform_admin.enabled` (4) return 404 when off; per-route flag `finance.journal_entries.enabled` (2) returns 403 FEATURE_DISABLED with `details.flag`; customer-portal-api Pattern B (2) rejects non-customer_user; Pattern C globals (3) stay readable; unauthenticated guard (3) returns 401; switch-org cross-tenant (2) returns 404 / 201; audit_log RLS (2).
- `apps/web/playwright/smoke.spec.ts`: hardened from URL placeholders to real `page.fill` / `page.click` / `expect(page).toHaveURL` sequences for the full Pillar-1 quote-to-cash flow plus AuditTimeline verification.
- `docs/operations/probes.md`: operator-facing runbook covering the three nightly workflows (RLS probe, audit chain verify, idempotency GC), failure triage, manual re-run via `workflow_dispatch`, and the staging secret contract per D-009.
- `supabase/functions/quotes-api/_helpers.ts` and `supabase/functions/projects-api/_helpers.ts`: per-bundle `requireSalesCap` shims wrapping the side-car `SALES_CAPABILITIES_BY_ROLE`. Matches the established invoicing-api `_helpers.ts` pattern. The singular byte-mirrored `_shared/capabilities.ts` is unchanged.

### Fixed (constitutional violations surfaced by the probe matrix on first run)
- **F-Wave5-API-01** (quotes-api): every transition handler (send / approve / convert / update) returned 403 cross-tenant because it imported `requireCap` from the singular handler-helpers, which only knows the 14 `org.*` capabilities. Fix: switch to the new per-bundle `requireSalesCap` shim.
- **F-Wave5-API-02** (projects-api): same pattern, same fix.
- **F-Wave5-API-03** (admin-console-api): anonymous callers got 401 from the platform gateway before the handler's 404 could fire. Fix: `[functions.admin-console-api] verify_jwt = false` in `supabase/config.toml`, matching the tenants-api pattern. The handler's existing `assertBundleEnabled` already returns 404 for anonymous.
- **F-Wave5-API-04** (`convert_quote_to_project` RPC): the cross-tenant guard used `public.current_org_id()` which returns NULL under the service-role client, so the check `v_org_id <> NULL` evaluated to NULL in three-valued SQL logic and the guard silently no-opped. The next check (`state != 'approved'`) won and the caller saw 409 STATE_CONFLICT for a quote in another tenant.

### Migration
- `0041_fix_convert_quote_to_project_cross_tenant.sql`: drops the 3-arg form of `convert_quote_to_project`; recreates as a 4-arg form taking `p_caller_org_id uuid` explicitly. Merges the missing-quote and cross-tenant branches into one `NOT_FOUND` raise. Forward-only, idempotent.

### Workflow hotfix
- `.github/workflows/nightly-rls-probe.yml`: `actions/setup-node` bumped to Node 22. `@supabase/realtime-js@2.105+` requires native WebSocket support, which Node 22 ships but Node 20 lacks. Other workflows stay on Node 20 because they do not use the supabase-js client at runtime.

### Not changed
- 22 byte-identical canon pairs intact (`pnpm test:contract` 25 / 25).
- 14 state machines, 8 roles, ~120 capabilities, money cents end-to-end, audit hash chain, JWT claim shape all unchanged.
- Bundle size: 25.94 kB gzip against the 40 kB cap.

### Final state
- RLS probe matrix: 48 / 48 passed in 31s on staging post-PR-10.
- Three nightly workflows wired: `nightly-rls-probe` (09:00 UTC), `audit-chain-verify`, `idempotency-gc`.
- `staging` GitHub Actions environment configured with `STAGING_SUPABASE_URL`, `STAGING_SUPABASE_ANON_KEY`, `STAGING_SUPABASE_SERVICE_ROLE_KEY` (sourced from the Supabase preview branch named `staging` per D-009).

## [0.3.0] · Wave 3 Integration

### Added
- `apps/web/src/lib/hooks/useOrgFlags.ts`: wraps `useFlags()` and reduces `OrgFeatureFlag[]` to `Record<string, boolean>` keyed by `flag_key`. Sidebar now reads live org feature flags. Closes `F-Wave2-API-03` (Sidebar `useOrgFlagsStub` removed).
- `apps/web/src/components/shell/ErrorBoundary.tsx`: global render-time error catcher mounted in `main.tsx` between `AuthProvider` and `<App />`. Brand-clean fallback (`SOMETHING WENT WRONG / Refresh to try again. / RELOAD`).
- `apps/web/playwright.config.ts`: Chromium-only Playwright config; testDir `./playwright`; baseURL from `process.env.PLAYWRIGHT_BASE_URL`; `webServer` runs `pnpm dev` locally and is undefined in CI.
- `apps/web/playwright/smoke.spec.ts` and `apps/web/playwright/rls-probe.spec.ts`: scaffolds for the Phase-5 specs; `test.skip` until staging secrets are wired.

### Changed
- `apps/web/src/App.tsx`: wildcard `*` route now `Navigate to="/404"` so `NotFoundPage` stays a single lazy chunk. Closes `F-Wave2-BUILD-01` (Vite static-plus-dynamic chunk warning).
- AuditTimeline mounted on the ten remaining state-having detail pages (quotes, projects, purchase orders, vendor bills, expenses, receiving orders, production runs, shipments, leads, opportunities). All thirteen state-having detail pages now share the same heading style (`text-2xl font-display tracking-wide text-ink mb-3`).

### Not changed
- `BrandingProvider` and `Topbar.useMe` were already gated on `isAuthed` from Wave 2; no rewire needed.
- 22 byte-identical canon pairs intact.

### Status
- Bundle size: 25.94 kB gzip / 40 kB cap (up from 25.55 kB; AuditTimeline mount + ErrorBoundary + hooks reorganization).
- All six gates green: typecheck, lint, test, test:contract (25 / 25), build (no dual-import warning), bundle-budget.

## [0.2.2] · Wave 2 Hotfix: Deno workspace import map for zod

### Fixed
- Deno bundling failure on every edge function bundle that imports a side-car (`_shared/types/<domain>.ts`). All six side-car type files use the bare specifier `from 'zod'`. The SPA resolves it via `node_modules`; Deno requires `npm:zod` or an import map. The bare import worked for Wave 0 / Wave 1 because the only deployed functions (`audit-chain-verify`, `idempotency-gc`) never imported `_shared/types.ts`. Wave 2 added 21 bundles that import their domain side-car, exercising the bare specifier for the first time and breaking both `deploy-functions` (run #3) and `Supabase Preview` (failed-to-bundle).

### Added
- `supabase/functions/deno.json`: workspace-level Deno import map with `"imports": { "zod": "npm:zod@3.23.8" }`. Pinned to the same minor as the SPA's `zod ^3.23.0` so the resolver does not drift between SPA tests and the edge runtime.
- `.github/workflows/deploy-functions.yml`: passes `--import-map ./supabase/functions/deno.json` to every `supabase functions deploy` call. Belt-and-suspenders alongside Supabase's own deno.json auto-discovery used by the Preview branch.

### Not changed
- Byte-mirror canon: all 22 pairs still byte-identical (`pnpm test:contract` 25 / 25).
- Side-car type files unchanged on both sides.
- Bundle size unchanged at 25.55 kB / 40 kB.
- No migrations changed.

## [0.2.1] · Wave 2 Hotfix: CI pooler hostname, CLI version, bundle list

### Fixed
- `.github/workflows/migrate.yml` pooler hostname corrected from `aws-1-us-west-2.pooler.supabase.com` to `aws-0-us-west-1.pooler.supabase.com`. The remote KitStak Supabase project lives in region `us-west-1` (confirmed via Management API). The previous hostname resolved to a pooler that does not host this tenant, producing `(ENOTFOUND) tenant/user postgres.*** not found` at the `supabase migration list` step.
- `.github/workflows/migrate.yml` and `.github/workflows/deploy-functions.yml` Supabase CLI version bumped from `1.180.0` to `latest`. CLI 1.180.0 predates Postgres 17 GA and rejected `db.major_version = 17` in `supabase/config.toml` at startup. The remote project runs Postgres 17.6.1.121 on the GA channel, so the correct fix is bumping the CLI, not lowering the config.
- `.github/workflows/deploy-functions.yml` BUNDLES array extended from Wave 1's two functions (`audit-chain-verify`, `idempotency-gc`) to all 23 functions covering Wave 1 plus Wave 2's 21 new bundles.

### Added
- `supabase/config.toml` `[functions.tenants-api]` with `verify_jwt = false`. The public `resolve-host` route must serve pre-auth so the SPA can resolve a custom hostname to an org before sign-in. The bundle dispatcher gates authenticated routes (e.g. `/branding`) with `requireCaller()` at the handler level. Closes `F-Wave2-AGENT-A-06`.

## [0.2.0] · Wave 2 Domain Ports

### Added
- 37 forward-only migrations (slots `0004` through `0040`, with `0005` and `0006` intentionally empty).
  - Identity: `org_settings`, `org_domains`, `numbering_sequences`, `next_doc_number` advisory-locked RPC, `identity_providers` per D-007.
  - CRM: customers, contacts, activities, leads (5-state), opportunities (6-stage), `convert_lead` atomic RPC, audit state-change triggers.
  - Sales: currencies, exchange_rates (Pattern C), taxes, payment_methods, pricing_tiers, items, units, item_categories, value_added_services, job_types, quotes (6-state), quote_line_items (Pattern B), quote_versions (SECURITY DEFINER snapshot), quote_approvals, quote_templates, projects (6-state), project_phases (4-state), `convert_quote_to_project` RPC, `recompute_quote_totals` trigger, `set_default_tax` and `set_default_payment_method` atomic-flip RPCs.
  - Invoicing and finance: invoices (9-state, `balance_cents` GENERATED ALWAYS AS — closes AUDIT.md row 72), invoice_line_items, invoice_versions, payments, payment_allocations, credit_notes (4-state), credit_note_allocations, chart_of_accounts + `seed_org_chart_of_accounts`, journal_entries (3-state), `check_journal_balance` invariant, `post_journal_entry` RPC, period_close (text CHECK 4-state, not pg enum), `close_period` and `reopen_period` RPCs, `tg_je_reject_closed_period` raising SQLSTATE P0001 with `period_closed:` prefix, three auto-JE triggers (invoice send, payment create, credit note allocate) all `EXISTS`-guarded and `finance.journal_entries.enabled` flag-gated.
  - Vendors / inventory / ops: vendors, purchase_orders (7-state) + `recompute_purchase_order_totals`, vendor_bills (7-state, `balance_cents` GENERATED) + `recompute_vendor_bill_paid`, expenses (6-state), three more auto-JE triggers (vendor bill approved, vendor bill paid, expense paid), warehouses, stock_levels (`quantity_available` GENERATED) + `seed_org_default_warehouse` + `recompute_stock_level`, stock_movements, bom_items, receiving_orders (4-state), production_runs (4-state), shipments (4-state), three stock-movement-emitter triggers, audit state-change triggers.
  - Cross-cutting: attachments (polymorphic, Storage bucket), comments, saved_views, notifications, `audit_log` entity_type CHECK extended to 30 types, `audit_trigger_coverage_gaps()` verifier (all 14 state machines covered across Agents B / C / D / E plus organization from Wave 1), `seed_org_numbering`, `quote_attachments` VIEW over generic attachments, `seed_org_settings` with 10 default feature-flag rows.
- 21 new edge function bundles (23 total with the two from Wave 1):
  - Identity: `auth-api`, `tenants-api`, `settings-api`, `admin-console-api` (bundle-gated on `platform_admin.enabled`).
  - CRM: `crm-api` (26 routes).
  - Sales: `sales-config-api`, `quotes-api`, `projects-api`.
  - Invoicing and finance: `invoicing-api`, `finance-api`.
  - Vendors / inventory / ops: `vendors-api`, `inventory-api`, `ops-api` (bundle-gated on `plugins.3pl`, returns 404 when off).
  - Cross-cutting: `collaboration-api`, `search-api`, `customer-portal-api` (Pattern B RLS + customer_id row filter), `dashboard-api`, `exports-api`, `imports-api`, `notifications-worker` (X-Worker-Secret), `pdf-worker` (501 stub pending dep approval).
- 18 byte-identical side-car canon pairs at `_shared/{types,workflow,capabilities}/<domain>.ts` mirrored to `apps/web/src/lib/...` for identity, crm, sales, finance, vendors_inventory_ops, cross_cutting. `ALL_STATE_MACHINES` union published from `cross_cutting`.
- 50+ SPA pages across `pages/admin/`, `pages/crm/`, `pages/3pl-operations/<domain>/`, `pages/finance/`, `pages/portal/`, `pages/search/`, `pages/dashboard/`, `pages/imports/`, `pages/exports/`. 67 total route specs in the flat ROUTES table.
- `parity.test.ts` extended from 4 singular pairs to 22 pairs (4 singular plus 18 side-cars). All 25 contract assertions pass.
- `allowImportingTsExtensions = true` in `apps/web/tsconfig.json` so the SPA can byte-mirror the Deno-side `.ts` import suffix used by `_shared/workflow/cross_cutting.ts`.

### Changed
- `invoices.balance_cents` is now GENERATED ALWAYS AS, matching `vendor_bills.balance_cents`. Closes AUDIT.md row 72 asymmetry.

### Status
- Pillar 1 (3PL Operations) lit at the schema, API, and SPA layers.
- Pillars 2-3 (Manufacturing, Co-Pack and Ecom) plumbed (schemas + edge function bundles, feature-flag-gated off).
- Pillars 4-5 (KitForce, KitCost) not in scope this wave.
- Bundle size: 25.55 kB gzip against the 40 kB cap.

## [0.1.0] · Wave 1 Foundation Completion

### Added
- 11 new `_shared` modules: `tenant`, `cors`, `handler-helpers`, `audit`, `feature-flags`, `feature-defaults`, `requireFlag`, `withFlag`, `mfa`, `numbering`, `route`. `requireCap` placed in `handler-helpers.ts` to keep the byte-mirror with the SPA intact.
- Three-gate route taxonomy in `apps/web/src/auth/`: `ProtectedRoute`, `AdminProtectedRoute`, `PortalRoute`. Canonical `AuthContext` discriminated union (`loading | authenticated | unauthenticated`).
- `BrandingProvider` relocated from `lib/branding.tsx` to `whitelabel/BrandingProvider.tsx`. Default app-name fallback is `Kitstak`.
- AppShell + Sidebar (five-pillar IA in canonical order) + Topbar + RequireFlag + AuditTimeline.
- `lib/queryKeys/`, `lib/services/`, `lib/hooks/` with `useMe`, `useBranding`, `useCapabilities`, `useSwitchOrg`.
- FeatureUnavailable and NotFound pages.
- `.github/workflows/deploy-functions.yml` workflow_run-gated on `migrate.yml` with `head_sha` pin. Closes the TS1 R-W2-01 deploy-ordering race lesson.
- `.github/workflows/nightly-rls-probe.yml` 09:00 UTC against the staging Supabase preview branch, skip-with-clear-message when secrets absent.
- `.github/workflows/lighthouse.yml` plus `apps/web/.lighthouserc.cjs` with LCP < 2500ms, CLS < 0.1, TBT < 200ms thresholds.
- `apps/web/vitest.contract.config.ts` with Deno-URL-to-bare-zod rewrite so contract tests run under Vitest.
- New devDeps: `@playwright/test`, `playwright`, `@axe-core/playwright`, `size-limit`, `@size-limit/preset-app`. New scripts: `test:rls`, `test:e2e`, `bundle-budget`, `gen:types`, `test:contract`.

### Changed
- `idempotency.ts` rewritten: strict UUID v4 validation, `Idempotent-Replay: true` header on cached replay, 24h replay window, replay routed through `ok()` and `fromApiError()` for uniform CORS plus `x-request-id`. PK shape `(key, user_id, org_id, route_hash)` per D-010.
- `.github/workflows/migrate.yml` rewritten. Was reverse-gated on `deploy-prod`; now fires on push to `main` for `supabase/migrations/**`, runs `supabase db push` via the IPv4 pooler, gated by the `production-db` GitHub environment.
- `apps/web/src/routes.ts` rebuilt as a flat `RouteSpec[]` table. `App.tsx` consumes it and maps `RouteSpec.guard` to the leaf wrapper.
- AuthContext state union renamed `anonymous` to `unauthenticated`.
- `.gitignore` tightened to `.env*` (with `!.env.example` allowlist); added `*.pem`, `*.key`, `*.crt`, `*.p12`.

### Fixed
- Em dash in `03-workspace/journal/wave-1-identity-branding.md` line 98 replaced with semicolon.

## [0.0.3] · Wave 1 Hotfix: Audit Trigger Search Path

### Fixed
- Migration 0003: `trg_audit_organizations_status` and `verify_audit_chain` were authored with `set search_path = public`, which excluded the `extensions` schema where `pgcrypto.digest()` lives. The trigger raised `ERROR 42883 function digest(text, unknown) does not exist` the first time it fired (during the `provisioning → active` transition inside `provision_organization`). Both functions now fully-qualify the call as `extensions.digest(...)`. Two `CREATE OR REPLACE` statements; no table or policy changes; chain math unchanged.

### Operator state
- Seated operator org `kitstak` (display name `Kitstak`) with `mike@kitstak.com` as `org_owner`. JWT `app_metadata` carries `kitstak_org_id` and `kitstak_org_role` so RLS scope resolves on the first signed-in request.
- Both Edge Functions (`idempotency-gc`, `audit-chain-verify`) deployed via MCP at v1 (`verify_jwt=false`; bearer-secret auth via Edge Function env). Smoke-tested with valid bearer: both return HTTP 200 with the expected envelope.
- All nine GitHub Actions secrets in place (Vercel triplet, Supabase triplet, plus `SUPABASE_FUNCTION_URL`, `GC_TRIGGER_SECRET`, `AUDIT_VERIFY_SECRET`).

## [0.0.2] · Wave 1 Identity, Tenancy, Branding

### Added
- Migration 0002: organizations status FSM (`provisioning, active, suspended, archived`) with auto-state-transition audit trigger writing a per-org hash chain to `audit_log`.
- `provision_organization(slug, display_name, owner_user_id, owner_email)` RPC: atomic tenant seat (organization, profile, membership, branding) culminating in the transition to `active`.
- `verify_audit_chain(org_id)` RPC: returns the first broken row in an org's audit chain or empty if intact.
- `sso_connections` and `saml_configs` tables with RLS (Pattern A and Pattern B). Schema only; provider integration deferred.
- `BrandingProvider` reading `org_branding` and injecting CSS variables on the document root. Tailwind theme tokens (`bg`, `ink`, `accent`) resolve through `rgb(var(--x))`.
- `AuthProvider` plus `RequireAuth` route guard. `SignInPage` now calls `supabase.auth.signInWithPassword` and surfaces server errors inline.
- `idempotency-gc` Edge Function sweeping rows older than 7 days, scheduled nightly via `.github/workflows/idempotency-gc.yml`.
- `audit-chain-verify` Edge Function plus nightly workflow that fails CI if any chain is broken.
- `pnpm test:contract`: byte-parity test for the four canon files (types, workflow, capabilities, money) plus a behaviour parity spec for the money helpers.
- `lib/workflow.ts` and `lib/capabilities.ts` byte-mirrored across SPA and `_shared`.

### Changed
- `organizations.status` check constraint extended to admit `provisioning`.
- Tailwind `bg.DEFAULT`, `ink.DEFAULT`, and `accent.DEFAULT` colors now resolve through CSS variables so runtime branding takes effect without rebuild.
- `styles.css` `:root` declares default CSS variables for the customer-overridable surfaces.
- CI workflow runs `pnpm --filter web test:contract` between `test` and `build`.

## [0.0.1] · Wave 0 Foundation

### Added
- Initial project scaffolding with Vite, React 18, TypeScript strict mode.
- Tailwind CSS configured with the Kitstak design tokens (navy, ink, accent).
- Supabase integration with foundational schema (organizations, roles, org_memberships, profiles, org_branding, org_feature_flags, idempotency_keys, audit_log).
- Row-level security on every tenant-scoped table from migration 0001.
- Idempotency table keyed on `(key, user_id, org_id, route_hash)`.
- Audit log with hash-chain columns from day one.
- Sign in page and authenticated dashboard placeholder.
- Hand-rolled UI primitives: Logo, Button, TextInput.
- Money helpers byte-mirrored across the SPA and the edge runtime, with parity tests scaffolded.
- Shared Zod canon for Org, User, FeatureFlag, AuditEntry, IdempotencyKey, Branding.
- CI/CD workflows for typecheck, lint, build, preview deploys, prod deploys, and migrate.
- Brand bar logo component matching the design system spec.
