# Kitstak Changelog

All notable changes to Kitstak are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

Nothing currently held. All shipped work is versioned below.

## [0.25.0] · 2026-06-17 Per-line supply_source override (PR #329)

The deferred follow-up to PR #327 (Option A). The override column shipped at the DB
(migration `0121`) and is honored by `view_job_profitability` (`0122`); this wires it end to
end so operators can set it per consumption line. No new migration (the columns already
exist; prod stays at `0122`). Live on prod after the four edge bundles and the SPA deployed.
Journal: `03-workspace/journal/2026-06-17-entitypicker-line-override.md`.

### Added

- **Per-line supply_source override (F-UIUX-ENTITYPICKER-LINE-OVERRIDE-01)**: a nullable
  supply_source field on the read and create schemas of the five consumption-line types
  (receiving, shipment, manufacturing-consumed, kitting-consumed, job-run-daily-log-consumed),
  byte-identical across the `_shared` and `apps/web` mirrors of `vendors_inventory_ops.ts`,
  `copack.ts`, and `threepl.ts`. The POST and PATCH handlers in ops-api, manufacturing-api,
  copack-api, and three-pl-api accept and persist it. A new `SupplySourceSelect` control
  ("inherit from item" plus the four values) lands on the add-line form of all five
  consumption-line editors. Receiving captures the picked item's default source and disables
  and nulls the unit-cost input when the effective source `COALESCE(override, item default)`
  is `customer_supplied` or `third_party_consigned`, so org cost is not captured for material
  the org neither owns nor pays for. No new cost-zeroing logic: the dashboard folds and the
  job-profitability view were already supply-source aware. Read fields are `nullable().optional()`
  (the additive-read-column convention) so legacy and mock rows still parse; money math, RLS,
  idempotency, and the audit log are untouched.

## [0.24.0] · 2026-06-17 Inline quick-create EntityPicker and items.supply_source (PR #327)

The 2026-06-17 smoke ticket: reference pickers were native selects with no way to create the
referenced record without leaving the form and losing the draft, and items carried no supply
source so cost roll-ups could not tell org-owned material from material the org neither owns
nor pays for. Shipped in three phases as one PR, live on prod (migrate, deploy-functions, and
deploy-prod all green; prod at migration `0122`). Journal:
`03-workspace/journal/2026-06-17-entitypicker-inline-quickcreate.md`.

### Added

- **EntityPicker inline quick-create (F-UIUX-ENTITYPICKER-01)**: a hand-rolled typeahead
  combobox (`EntityPicker`, listbox ARIA, full keyboard nav, pure logic in `entityPickerModel`
  with a unit test) and a reusable `Modal` primitive (focus trap, scroll lock, focus restore)
  replace the native-select reference pickers. A capability-gated "+ New" row opens a bespoke
  quick-create modal for customer, item, vendor, project, and channel; each posts through the
  existing service (Idempotency-Key minted by apiClient, org from the JWT, one audit row) and
  hands the new record back so the parent picker auto-selects it. The modal mounts inside the
  parent form, so the in-progress draft survives and the new record is merged ahead of the
  list refetch to avoid a label flash. A new `ChannelPicker` replaces the last raw select on
  the sales-order create form. The "+ New" row hides for roles without the create capability;
  the server `requireCap` stays the authority (a viewer holds none of the five create caps).
- **items.supply_source (F-UIUX-ENTITYPICKER-SUPPLY-SOURCE-01)**: migration `0120` adds
  `items.supply_source` (in_house, customer_supplied, vendor_consigned, third_party_consigned;
  NOT NULL default in_house, TEXT plus CHECK). A supply_source control lands on the item
  create, edit, and quick-create surfaces; ItemPicker shows the source in the option label and
  filters by it; the item detail page shows the source and flags zero org material cost.
- **Per-line supply_source override (migration 0121)**: a nullable override on the five
  consumption-line tables (receiving, shipment, manufacturing-consumed, kitting-consumed,
  job-run-consumed). NULL inherits the item default. Honored at the DB and the
  job-profitability view today; the operator-facing controls are the tracked follow-up
  `F-UIUX-ENTITYPICKER-LINE-OVERRIDE-01`.

### Changed

- **Supply-source cost roll-up zeroing**: material the org neither owns nor pays for
  (customer_supplied and third_party_consigned) rolls up as zero org material cost; in_house
  and vendor_consigned keep captured cost. Migration `0122` rewrites `view_job_profitability`
  so actual material zeroes any consumed line whose effective source COALESCE(line, item) is
  in that set (security_invoker carried over; a LEFT JOIN to items so an RLS-hidden item never
  drops a row or silently zeros cost). Both KitCost dashboard folds (inventory value and
  project margins) zero not-org-owned material keyed off the item default. Money stays BIGINT
  cents with banker's rounding; the zeroing substitutes 0 before the round and sum. Canon kept
  byte-identical (`pnpm test:contract` green).

## [0.23.1] · 2026-06-17 Recompute-error parity on the line handlers (run closeout)

### Fixed

- **Surface the recompute-totals RPC error (F-UIUX-RECOMPUTE-ERR-PARITY-01)**: the quote add and remove line handlers, and the invoice create, update, and delete line handlers, now check the `recompute_quote_totals` / `recompute_invoice_totals` RPC result and surface a failure instead of swallowing it, so a failed header recompute can no longer leave the line cents updated while the document totals drift stale. The quote line PATCH (#324) already carried this guard; this brings the other five call sites to parity.

## [0.23.0] · 2026-06-17 Rail consistency and the held backend trio (PRs #321 to #324)

The two deferred rail follow-ups plus the three held backend items, all shipped to prod the same day. The scoping pass found the backend trio was mostly already built: default-for-org shipped its columns, one-default unique indexes, and atomic-flip RPCs back in migration 0011; credit-note numbering was already seeded; and the invoice line PATCH already existed end to end. Only one small migration (journal-entry numbering) and one new endpoint (the quote line PATCH) were genuinely new. Prod advanced to migration 0119.

### Added

- **Inline draft-line editing (#324, F-UIUX-INLINE-LINES-01)**: quote and invoice draft lines gain an in-place Edit affordance. A new `PATCH /quotes/:id/line-items/:lineId` endpoint mirrors the create handler (cap-gated, server-side draft guard, ownership double-scoped to line and quote id, `assertRefInOrg` on item/vas/tax, idempotency-wrapped under a unique route key) and recomputes the four line cents server-side via the now-exported `computeLineMath`, re-resolving `tax_rate_snapshot` on a `tax_id` change. No migration (the UPDATE RLS policy shipped in 0116). The invoice side reused its already-built PATCH; only the editor UI was added. An adversarial review hardened two null-row edge cases and surfaced the recompute RPC error.
- **Interactive rail on three more first edges (#321, F-UIUX-RAIL-FIRST-EDGE-01)**: the Pattern D rail is wired on the safe first edge of the manufacturing run (draft to started), production run (planned to in_progress), and credit note (draft to issued), each pinned so it never offers the destructive complete or the navigate-to-apply step.
- **Set-as-default for taxes and payment methods (#323, F-UIUX-DEFAULT-FOR-ORG-01)**: the two sales-config list pages gain a cap-gated Set-as-default row action over the existing atomic-flip RPC.

### Changed

- **Auto-assigned document numbers for credit notes and journal entries (#322, F-UIUX-AUTONUMBER-JE-01)**: both create paths allocate the next document number from the org-scoped numbering chassis when the field is left blank, so the operator no longer hand-types one. Credit notes needed no migration (the CN- row was already seeded); journal entries got migration 0119 with a JE-M- prefix kept clear of the JE- namespace the auto-JE triggers use. The number field stays an optional override.
- **Default-for-org checkbox made effective (#323, F-UIUX-DEFAULT-FOR-ORG-01)**: the tax and payment-method create/update path routes a checked default through the atomic-flip RPC instead of a raw column write (which previously 500ed on a second default), inside the idempotency closure; unchecking on edit is non-destructive. Quote create now pre-selects the org-default tax and payment method when the header fields are blank.
- **Opportunity stage controls cap-gated (#321, F-UIUX-RAIL-OPP-CLIENT-CAP-01)**: the ADVANCE STAGE buttons and rail hide for roles without `crm.opportunities.stage.transition`, matching the other detail pages.

## [0.22.0] · 2026-06-17 UI/UX reconfiguration: the deferred F-UIUX rollout (PRs #315 to #319)

The deferred F-UIUX-* follow-ups from the 0.21.0 phase-2 bundle, completed as five SPA-only PRs. Presentation layer only: no schema, migration, RLS, money, idempotency, audit_log, or contract change. Each branched off `main` on disjoint files so they merge in any order; the index chunk held at roughly 35.8 kB gz under the 40 kB `size-limit` throughout. Grounded by four parallel read-only mapping agents before any edit; the logic-heavy units (the interactive rail gating and the per-route nav caps) carried an adversarial review.

### Added

- **Next-step toasts across the create flows (#315, F-UIUX-TOASTS-ROLLOUT-01)**: the quote-create next-step toast (#313) extends to ten more create flows. Customer, vendor, opportunity, and contact create offer an action-button toast that deep-links the next step with the new record prefilled (add a contact, create a PO, add an activity); item, lead, invoice, PO, shipment, and receiving get a context-aware message-only toast. The two line-count-aware messages (invoice, PO) use new pure, unit-tested helpers mirroring `quoteCreatedToast`. Item and lead deliberately stay message-only because their would-be target form cannot be prefilled (`BomCreatePage` reads no `parent_item_id`; `OpportunityCreatePage` requires a customer a lead has no FK for).
- **Interactive lifecycle rail on four more hubs (#316, F-UIUX-RAIL-ROLLOUT-01)**: the Pattern D rail (#312) extends to the opportunity, expense, purchase order, and shipment detail pages. Each passes `onAdvance` only when the next happy-path step is a transition the page already exposes as a button, gated by the same capability and mapped to the same mutation (the shipment `picking` to `shipped` step routes through the dedicated Ship action). A shared pure `nextStepperState` helper backs the gate. Invoice, receiving, vendor bill, and lead stay display-only by design.
- **Project hub on tabs (#317, F-UIUX-HUB-TABS-PROJECT-01)**: the project detail page's six record sections (materials, phases, receiving, manufacturing, shipments, invoices) become tabs, matching the customer and vendor hubs. A pure wrapping change on a core page: every form, the lazy `PhasesSection` and its dnd-kit chunk split, the convert-to-invoice action, and every test-id are preserved verbatim (`git diff -w` shows only the tab scaffolding). Also resolves `F-UIUX-HUB-TABS-LEAF-01` as a no-op: sales order and manufacturing run are confirmed leaf pages.
- **Member hub on tabs (#318, F-UIUX-HUB-TABS-MEMBER-01)**: the KitForce member detail page becomes a hub with Overview, Assignments, Time entries, and Shifts tabs, each filtered server-side by `member_id` through the existing list hooks (the follow-up was wrongly flagged backend-blocked; the filters already exist). Read-only lists with no create CTA (those entities are created inline on their list pages); the time-entry rate stays `read_rate`-gated.

### Changed

- **Per-route capability gating on the sidebar (#319, F-UIUX-NAV-ROLE-SCOPE-PERROUTE-01)**: each nav entry now hides unless the role holds that resource's read capability, layered on the existing section gates. `visibleRoutesForMode` gains an optional `can` predicate (backward compatible). Effect: non-owner roles see a tighter nav that matches the capability policy (for example sales no longer sees Vendor bills or Expenses, ops no longer sees the finance ledger entries). SPA render hiding only; the server stays the authority. An adversarial review confirmed every cap is the correct read cap and that no section a role's gate admits is left empty. Routes whose resource has no read cap (the Production and Fulfillment add-ons, WMS putaway) and the already-adminOnly Settings routes stay ungated. The optional `F-UIUX-EYEBROW-TASK-ALIGN-01` is intentionally not done: the eyebrow was deliberately decoupled from the sidebar in #308, so re-coupling would only create churn.

## [0.21.0] · 2026-06-16 UI/UX reconfiguration phase 2, the structural bundle (PRs #308 to #313)

The structural follow-on to the 0.20.0 quick wins. After verifying the quick wins, the operator reopened two decisions locked earlier the same day, the morning hybrid-nav call and the locked UX-Q7 display-only rail, and chose to build the remaining structural items as one bundle. Six SPA-only PRs, presentation layer only: no schema, migration, RLS, money, idempotency, audit_log, or contract change. Each branched off main on disjoint files so the bundle merged in any order with no conflicts; the index chunk held under the 40 kB size-limit throughout. The larger surfaces were delivered on their flagship page with the long tail deferred to scoped F-UIUX follow-ups rather than a risky blanket sweep.

### Added

- **Command-palette action verbs (#310, F-UIUX-PALETTE-VERBS-01)**: the Cmd or Ctrl-K palette now lists executable verbs ("New quote", "Go to period close") alongside entity matches, filtered by query, capability, and add-on entitlement. Verbs and entity rows unify on one `CommandRow` type in a single listbox. `CommandBar` is lazy-split in `AppShell` so the capability matrix it now pulls stays out of the eager index chunk (the same fix the Create menu took); the index dropped to 35.7 kB gz.
- **Credit-note Apply CTA (#309, F-UIUX-CREDIT-NOTE-APPLY-CTA-01)**: the credit-note detail surfaces the existing apply flow as a primary CTA when the note is issued with a positive remaining balance and the caller holds `credit_notes.apply`. Pure gate helper; the server stays the authority.
- **Shared RelatedSection primitive and vendor hub tabs (#311, F-UIUX-HUB-TABS-ROLLOUT-01)**: the inline related-records section from the customer hub is extracted to one shared `components/shell/RelatedSection`; the customer hub refactors onto it and the vendor hub moves to tabs (Overview plus purchase orders, vendor bills, expenses, receiving).
- **Interactive lifecycle rail (#312, Pattern D, UX-Q7 reopened)**: the `StateStepper` rail's immediate next step is now optionally interactive. When a page passes `onAdvance`, that one step becomes a button that advances the entity through the page's existing transition handlers; every other step stays display-only, and pages that do not opt in are byte-identical to before. Wired on the quote hub first.
- **Next-step toast on quote create (#313, Pattern A, F-UIUX-TOASTS-01)**: a shared `nextStepToast` helper over sonner plus a context-aware quote-created toast that names the next verb (add lines, or send for approval when lines were staged inline).

### Changed

- **Task-based navigation (#308, F-UIUX-TASK-IA-REKEY-01)**: the sidebar is re-keyed from seven pillar sections (one SPINE backbone plus one per add-on) to eight task groups shaped around what operators do: Sell, Buy, Inventory and Warehouse, Production and Fulfillment, Money, Workforce, Insights, Settings. All fifty-six nav entries are remapped with zero URL changes (`routes.ts` is untouched; the sidebar layer owns grouping). Sections are role-scoped on a representative read capability so read-only roles keep access, and Settings folds the former Admin block behind an owner or admin gate. The breadcrumb eyebrow taxonomy is now an independent domain axis from the task sidebar.

## [0.20.0] · 2026-06-16 UI/UX reconfiguration quick wins (PRs #300 to #304, #306)

A dropped whole-app UI/UX reconfiguration spec was verified against the code first and found to be roughly seventy percent already shipped: the state-driven detail action bars (Send, Approve, Receive payment, gated by `canTransition`), the customer hub related-record sections, the dashboard work-card queue, the Cmd or Ctrl-K command palette, and the empty-state coaching all already existed. The verified delta shipped as six SPA-only PRs, presentation layer only, no schema and no migration. Operator scope was quick wins; the larger structural items the spec wanted but that would reverse recently shipped or locked decisions (the full pillar to task-group nav re-key, the interactive lifecycle rail) stayed deferred.

### Added

- **Tabs primitive (#304)**: a hand-rolled, dependency-free `components/ui/Tabs.tsx` implementing the WAI-ARIA tabs pattern (roving tabindex, arrow / Home / End keys, automatic activation) with the active tab synced to a URL search param so tabs are deep-linkable and back-button friendly. The pure helpers `resolveActiveTabKey` and `nextTabIndex` are unit-tested.
- **Topbar search and create menu (#303)**: a visible Search button that opens the existing Cmd or Ctrl-K command palette (previously reachable by shortcut only, with no on-screen affordance), plus a Create quick-create menu scoped to what the caller can both perform (capability) and reach (plugin entitlement) via a new pure `createMenuActions` registry. The menu is lazy-split into `CreateMenu.tsx` so the capability matrix stays out of the eager index chunk.
- **Sidebar type-to-filter (#302)**: a filter box at the top of the sidebar that narrows sections and links by label, backed by a pure `filterRoutesByQuery` helper.

### Changed

- **Sidebar default-open and Admin scoping (#302)**: the sidebar opens only the always-on SPINE backbone on first load instead of every section, and the Admin links are hidden for non-admins via `useCapabilities` (mirroring `AdminProtectedRoute`; the route guard stays authoritative, so this is presentation only). The persisted-expanded allow-list is now derived from `SIDEBAR_MODES`, closing a latent omission of the `wms` key.
- **Dashboard header (#301)**: the operational dashboard leads with a compact page title instead of the oversized marketing hero; the live work-card queue and setup checklist are unchanged.
- **Customer hub on tabs (#306)**: `CustomerDetailPage` renders its Overview plus six related-record sets (Quotes, Projects, Invoices, Payments, Contacts, Activities) as tabs instead of a long vertical stack, reusing the existing sections and their quick-create CTAs verbatim.

### Fixed

- **Detail-subtitle name resolution (#300)**: quote, invoice, and project detail subtitles no longer flash the raw foreign-key UUID on first paint. They use the existing `fallbackLabel` helper (short prefix while loading, resolved name once settled), matching the breadcrumb treatment already on those pages.

## [0.19.2] · 2026-06-16 SSO store-metadata MVP (#298, migration 0118)

### Added

- **SSO store-metadata MVP (F-Wave13-SSO-HANDSHAKE-01, #298, migration 0118)**: `sso_connections.provider_validated_at` plus a CHECK that a connection cannot be active until validated; an `oidc_configs` table mirroring the `saml_configs` Pattern B RLS; and `settings-api` `POST /sso/saml-metadata` and `/sso/oidc-metadata` to store IdP metadata (requires `org.sso.write`, gated behind `auth.sso_saml`, Idempotency-Key enforced, cross-tenant or unknown connection returns 404). The SPA Configure panel stores metadata, Mark-validated sets `provider_validated_at`, and Activate is gated until validated. The OIDC `client_secret` is deferred to the live-handshake phase (not stored, so no plaintext secret at rest); the live identity-provider handshake stays an operator step. Live on prod (migration 0118).

## [0.19.1] · 2026-06-15 Wave 13 closeout follow-ups (PRs #296, #297)

The first follow-ups spawned by the Wave 13 closeout, merged to prod. Schema advanced to migration 0117.

### Security

- **SECURITY DEFINER grant revoke (F-Wave13-SEC-AUTH-EXEC-REVIEW-01, #297, migration 0117)**: follow-on to 0111. Revoked `EXECUTE` from `authenticated` on the remaining 115 SECURITY DEFINER functions (25 directly-callable service RPCs plus 90 trigger functions), excluding `current_org_id` and `current_user_role` (the only two any RLS policy references). Closed the live `audit_append_state_change` audit-log forge path and the cross-tenant `recompute_*` and chain-head reads; every callsite is the service-role `admin()` client, so the app is unaffected. The `authenticated_security_definer_function_executable` advisor dropped 117 to 2 on prod. rls-probe Category 13.

### Changed

- **Retry-After-aware 429 backoff (F-Wave13-RETRY-AFTER-429-01, #296)**: the apiClient retries a 429 after a capped Retry-After delay (delay-seconds or HTTP-date, malformed values rejected, 60s cap), reusing the same Idempotency-Key so a non-GET replay cannot double-apply.
- **Transition cache invalidation remainder (F-Wave13-UX-INVALIDATION-REMAINDER-01, #296)**: the shipment and production-run transition hooks adopt the shared invalidation contract (detail key plus entity tree plus audit timeline).

### Fixed

- **forwardRef test hardening (F-Wave13-FORWARDREF-TEST-HARDENING-01, #296)**: `TextInput` exposes a named render function the test calls directly, instead of reaching into the React forwardRef internal `.render` property.

## [0.19.0] · 2026-06-15 Wave 13: audit remediation (twenty units, P0 to P2) (PRs #276 to #293)

Remediation of the 2026-06-15 product audit and operator simulation. All twenty backlog units shipped across three phases. Schema advanced through migration 0116. Built as three dynamic multi-agent workflows (one implementer per unit plus code and security review), each unit gated green, migrations verified on staging, merged in order with the constitution's stop-and-ask discipline. Closeout `03-workspace/journal/wave-13-audit-remediation.md`. Prod advisor deltas: unindexed FKs 101 to 0, function search_path mutable 37 to 0, anon-executable SECURITY DEFINER 11 to 0, leaked-password 1 to 0, multiple-permissive policies 88 to 0, init-plan policies 7 to 0.

### Security

- **JWT signature verification (R-W13-SEC-01, #279)**: `tenants-api` and `admin-console-api` moved to `verify_jwt = true`; the one public route, `GET /tenants/resolve-host`, split into a new `tenants-public-api` bundle so the gateway verifies the signature before any authenticated handler trusts a claim.
- **Function hardening (R-W13-SEC-02, #277, migration 0113)**: pinned `search_path = public` on 37 functions and revoked `EXECUTE` from `public, anon` on 11 anon-executable SECURITY DEFINER functions. Leaked-password protection enabled in Supabase Auth.
- **Paid-plugin entitlement gate (R-W13-BILL-01, #280)**: enabling a paid `plugins.*` flag now requires an active subscription, else `403 BILLING_REQUIRED`. Bundle-gate misses stay 404.

### Added

- **TOTP MFA enrollment and SSO connection UI (R-W13-AUTH-01, #292)**: TOTP enroll and verify, plus SSO connection-record management. The SAML and OIDC handshake is deferred (F-Wave13-SSO-HANDSHAKE-01).
- **Item master deepening (R-W13-CAT-01, #284, migration 0115)**: unit of measure, cost (`cost_cents`), reorder point, and barcode on `items`, with forms wired.
- **Command-bar global search (R-W13-SRCH-01, #285)**: a hand-rolled Cmd or Ctrl-K bar over search-api across customers, quotes, projects, invoices, items, and job numbers.
- **Inline create-with-lines (R-W13-UX-02, #288)**: line items can be staged on the quote, invoice, receiving, and BOM create screens.
- **Pillar analytics (R-W13-OBS-01, #283)**: product events for 3PL job runs, WMS receiving and putaway, manufacturing runs, and KitForce labor, no PII.
- **Auto draft Supply Plan on conversion (R-W13-3PL-02, #286)**: quote-to-project conversion seeds a best-effort draft Supply Plan.

### Changed

- **FK covering indexes (R-W13-PERF-01, #276, migration 0112)**: indexes for the 101 unindexed foreign keys.
- **RLS policy consolidation (R-W13-PERF-02, #293, migration 0116)**: per table, the FOR ALL write policy split into command-scoped INSERT, UPDATE, and DELETE so SELECT is governed by one policy, and init-plan auth calls wrapped as `(select fn())`. Verified semantics-preserving by a static adversarial predicate diff (zero widening) and the CI cross-tenant probe.
- **Putaway posts stock (R-W13-WMS-01, #278, migration 0114)**: completing a putaway requires a destination bin (raises STATE_CONFLICT on null) and a new `set_putaway_destination` RPC sets the bin on an in-progress task.
- **Transition guards and mirror cleanup (R-W13-FIN-01, R-W13-DB-01, #287)**: status-equals-from compare-and-set on the remaining SELECT-then-UPDATE transitions; stopped dual-writing the receiving and shipment JSON line mirror.
- **Fetch retry and field errors (R-W13-UX-03, #289)**: idempotent transient auto-retry reusing the same Idempotency-Key, and per-field Zod form errors.
- **Query invalidation (R-W13-UX-01, #281)** and **breadcrumb taxonomy (R-W13-IA-01, #282)**: transitions invalidate the entity and audit caches explicitly; eyebrow taxonomy aligned to the pillar IA.
- **CI and observability hygiene (R-W13-DX-01, #290)**: size-limit budgets for lazy chunks, an edge-function Sentry capture scaffold, and the `three-pl-api` split into a `handlers/` layout.
- **Co-Pack imports and channels (R-W13-COPACK-01, #291)**: repaired the CSV import column mapping (allowlist intact) and relabeled channels manual-only.

## [0.18.0] · 2026-06-15 Wave 12: WMS add-on (warehouse execution, Body B) plus FSM RPC grant hardening (PRs #267, #268, #269, #271, #272, #273, #274)

The sixth add-on shipped. WMS (warehouse execution) deepens the spine's warehouse-level stock to bin level without replacing it: a nullable `location_id` dimension rides the existing append-only `stock_movements` ledger, the sum of the bins equals the warehouse `quantity_on_hand` by construction, and turning `plugins.wms` off leaves the spine totals untouched. Gated `plugins.wms` (default off) at a new `/wms/*` root behind a new `wms-api` edge bundle. Migrations 0105 to 0110, plus the 0111 grant hardening. ADR `docs/adr/0002-spine-plus-addons-and-wms-sixth-addon.md`. There is no WMS closeout journal yet; the migration headers and `03-workspace/specs/2026-06-14-wms-bodyb-phase1-handoff.md` are the authoritative record for Body B.

### Added

- **WMS chassis (B0, #267)**: migration 0105 seeds the `plugins.wms` feature flag (default off) and extends `seed_org_settings` so new orgs get it. The `wms-api` bundle and `/wms` sidebar section land behind the gate.
- **Warehouse locations (B1, #268)**: migration 0106 adds `warehouse_locations` (bins, shelves, racks, docks, and staging areas inside a warehouse). A config table, not a registered state machine: `active` is a boolean flag. Carries an audit trigger, WMS capabilities, byte-mirror types, the `wms-api` location routes, and the SPA `/wms/locations` surface.
- **Stock-movement bin dimension (B2, #269, the spine stop-point)**: migration 0107 adds the additive nullable `location_id` to `stock_movements` (plus forward refs `lot_id` and `license_plate_id`), a `bin_stock_levels` rollup that derives bin-grain `quantity_on_hand` the identical way the spine derives the warehouse grain, the `recompute_bin_stock_level` function, and one AFTER INSERT trigger that fires both rollups off the same row. The sum-reconcile invariant (sum of bins equals the warehouse total) holds by construction. Closes the carried operator stop-point risk R-W12-CO-02. Read capability, `BinStockLevel` type, the `/bin-stock` GET routes, and the SPA `/wms/bin-stock` surface.
- **Receiving-to-dock (#271)**: migration 0108 lets the receive path set a bin. `receiving_orders` gains a single header `dock_location_id` (one dock per receipt, a header column, never per line), and the receipt-emitting trigger applies it to every line it emits onto the ledger.
- **Directed putaway (B3, #272)**: migration 0109 adds `putaway_tasks`, a rich FSM (`suggested` / `in_progress` / `done` / `cancelled`). Completing a task is a warehouse-flat internal move: it emits two existing-type movements (`transfer_out` at the source dock and `transfer_in` at the destination bin, same quantity), so the warehouse total stays flat while the bin grain shifts. No new ledger type is invented. Capabilities, `PutawayTask` types, the `/putaway` routes, and the SPA `/wms/putaway` surface.
- **Lots and lot capture (B4, #273)**: migration 0110 adds the `lots` parent and end-to-end lot capture. A received line can carry a lot (`receiving_order_line_items.lot_id`), the receipt emitter threads that lot onto the ledger row alongside the dock, and a putaway task auto-defaults its lot from the source receiving line so the transfer cites the same lot the receipt credited. The bin recompute null-safe-matches lot, so a lot-keyed bin row reconciles at the (location, lot) grain. FEFO is groundwork only here (the `expiration_date` index); FEFO consumption is a later phase. Capabilities, `Lot` types, the `/lots` routes, the receiving line-item lot capture, and the SPA `/wms/lots` surface.

### Security

- **FSM action RPC grant hardening (#274)**: migration 0111 revokes `EXECUTE` from `authenticated` on the 18 state-changing action and transition RPCs. The SPA never calls any RPC directly (zero `.rpc()` in `apps/web/src`); every action RPC is invoked from an Edge Function through the service-role `admin()` client, so the `authenticated` grant was an unused attack surface (a hand-rolled PostgREST `POST /rest/v1/rpc/<fn>` from an authenticated session could reach these SECURITY DEFINER functions and attempt to bypass the Edge `requireCap` gate or spoof `p_caller_org_id`). `service_role` retains `EXECUTE`, so the Edge call path is unchanged. The two RLS-context helpers (`current_org_id`, `current_user_role`) and every recompute / seed / audit helper keep their `authenticated` grant and are out of scope. Closes `F-Wave12-WMS-FSM-RPC-GRANT-HARDEN-01`.

### Changed

- **SPA index lean-up (#265)**: the left-nav Sidebar is lazy-split out of the always-on app shell, moving roughly fifty lucide-react navigation icons and `sidebarModes.ts` into a `Sidebar-*.js` chunk. The SPA index chunk drops from 39.99 to 33.7 kB gzipped under the held 40 kB `size-limit` budget (about 6 kB reclaimed), clearing headroom for the WMS `/wms` navigation weight without raising the budget. Closes `F-Wave12-INDEX-BUDGET-HEADROOM-01`; pairs with `F-Wave10-INDEX-SPLIT`.
- **Supabase CLI pin (#270)**: `migrate.yml` pins the Supabase CLI version to stop the flaky latest-release resolution.

## [0.17.0] · 2026-06-14 Wave 12: 3PL commercial layer completed (Job Runs, Billing Review, Job Profitability) (PRs #261, #263)

Body A, the 3PL commercial and operational planning layer, is complete. The two remaining phases close the loop from floor execution to money-out: Job Runs record the day-by-day execution of a project, and Billing Review checks estimate against actual before drafting the invoice. Migrations 0098 to 0104.

### Added

- **Job Runs and Daily Progress (A6, #261)**: migration 0098 adds `job_runs` (the day-by-day execution of a project on the floor) plus its four FSM transition RPCs; 0099 adds `job_run_daily_logs` (the stock-affecting layer); 0100 wires `JR-` numbering. Migration 0101 adds the `supply_plans.job_run_id` breadcrumb (a released plan's stock is consumed by a job run) and the `fulfill_supply_plan` RPC (`released` to `fulfilled`), which releases the remaining holds so the spine `quantity_reserved` is not left stale once the operator marks the plan fulfilled. The finer per-consume automatic draw-down stays the follow-up `F-Wave12-SUPPLY-PLAN-FULFILL-CONSUME-01`.
- **Billing Review (A7, #263)**: migration 0102 adds `billing_reviews` (an estimate-versus-actual check before invoicing) plus its approve / cancel RPCs. Approve creates a spine DRAFT invoice with lines built from the account service rates and lands the review; 0103 wires the numbering.
- **Job Profitability (A7, #263)**: migration 0104 adds the `job_profitability` view (a derived read model, not a new write table): one row per non-deleted job run, comparing the quote estimate (project budget) against job-run actuals (posted daily-log labor plus consumed material cost) against billed revenue (the project's non-cancelled invoices).

## [0.16.0] · 2026-06-13 Wave 12: 3PL commercial layer (Accounts, Job Builder, Quote integration, Project snapshot, Supply Plan) (PRs #249, #252, #254, #256, #257)

The 3PL Operations add-on gained its commercial and operational planning layer, building the product loop Job Builder to Quote to Project to Supply Plan on top of the spine. Five A-phases shipped to prod on 2026-06-13 (migrations 0089 to 0097). ADR `docs/adr/0002-spine-plus-addons-and-wms-sixth-addon.md`.

### Added

- **Accounts (A1, #249)**: `three_pl_accounts` (the service-relationship layer over a CRM customer) and `account_service_definitions` (the per-account Rate Card overlay). New `three-pl-api` edge bundle, ACC- numbering, six `threepl.account.*` capabilities, and the pillar-grouped sidebar (ADR 0003).
- **Job Builder (A2, #252, #254)**: `job_templates` and `job_template_lines` (the reusable job engine: component / service / step lines under a branded variant preset). JB- numbering, six `threepl.job_template.*` capabilities, and the Job Builders SPA.
- **Quote integration (A3, #256)**: an "Apply template" control expands a Job Builder template's lines onto a quote, and `convert_quote_to_project` carries the quote's `job_type_id` onto the project so a won quote becomes a project of the right type (migration 0093).
- **Project conversion with template snapshotting (A4, #257)**: `convert_quote_to_project` records `source_job_template_id` on the quote and project and freezes the template (header plus lines) into `projects.job_template_snapshot`, so later template edits never rewrite a project's origin (migration 0094).
- **Supply Plan (A5, #257)**: `supply_plans` and `supply_plan_lines` resolve a project's material demand against on-hand stock. `release_supply_plan` reserves available stock and surfaces the shortage; `cancel_supply_plan` releases the holds. This activates the previously dormant spine reservation path: migration 0095 adds the `reserve` / `reserve_release` movement types and derives `stock_levels.quantity_reserved` (the GENERATED `quantity_available` follows). SUP- numbering, `threepl.supply_plan.*` capabilities, and the Supply Plans SPA.

## [0.15.0] · 2026-06-04 Cross-tenant FK security fix, edge Deno typecheck gate, FK-validation follow-ups (PRs #238, #240, #241, #242)

A 73-agent read-only optimization audit confirmed the cross-tenant foreign-key class as the top risk (grade B plus; the constitution holds). Every foreign key in the schema is a plain single-column constraint that checks existence, not org, so a service-role write could persist a client-supplied FK pointing at another tenant's row. The proven breach: payment apply and credit-note apply accepted an `invoice_id` validated only as a UUID, after which the recompute triggers mutated the victim org's invoice and forged an `audit_log` row. Four PRs closed the gap and hardened the surrounding surface; #239 was superseded by #241. Closeout journal at `03-workspace/journal/2026-06-04-fk-security-deno-gate-closeout.md`.

### Fixed / Security

- **Cross-tenant FK validation (#238)**: new shared `assertRefInOrg(table, caller, id)` helper does an org-scoped existence check and returns `404 NOT_FOUND` (never 403) before every client-supplied foreign-key write across 14 edge bundles (about 129 call sites). The polymorphic `activities.entity_id` fails closed on an unmapped type; `owner_user_id` validates against `org_memberships.user_id`; `quote_line_items` is skipped (no `org_id`, parent-scoped). Coverage verified against the authoritative `pg_constraint` list, which caught gaps the scoping agents missed. Regression coverage added as a Category 12 block in `rls-probe.spec.ts`.
- **Imports mass-assignment, MASSG-IMPORTS-01 (#242)**: the imports commit now inserts the Zod-parsed row (declared columns only) plus server-set `org_id` / `created_by` / `updated_by`, instead of the raw client row, so a client can no longer inject `created_by`, `id`, `status`, or any undeclared column.
- **Soft-deleted-referent hardening (#242)**: `assertRefInOrg` filters soft-deleted parents by default; the three parent tables with no `deleted_at` column (`chart_of_accounts`, `expense_categories`, `org_memberships`) opt out with `softDelete: false`.
- **Edge type fixes (#240)**: corrected a `stripe-webhook` `apiVersion` pin (cast to `Stripe.LatestApiVersion`, the deliberate `2024-09-30.acacia` pin kept, zero runtime change) and a `kitforce` clock-in rate compared as `string | number > 0` (coerced to a number for the comparison and the snapshot).

### Changed

- **Edge Deno typecheck gate (#241)**: `ci.yml` now runs `deno check` over every edge-function bundle entry point on every PR, since `supabase functions deploy` transpiles with esbuild and never typechecks. Enabling it required resolving 47 pre-existing type errors (44 the untyped service-role client cast pattern resolved with `as unknown as`, plus a `dashboard-api` `PostgrestQueryBuilder` versus `PostgrestFilterBuilder` helper mistype and a `leads` `'converted'` status backstop).
- **Batch FK validation (#242)**: new `assertRefsInOrg` validates many ids in one `IN` query; used by journal-entry line validation and the imports commit.

### Notes

- The import `RowSchemas` declare column names that do not match the target tables (`number` vs `invoice_number`, `email` / `phone` vs `primary_email` / `primary_phone`, `unit_of_measure` vs `unit_id`), so the import feature is likely broken for four of five entities. Filed as a separate follow-up; #242 changed only the insert allowlist, not the import wire contract.
- No migration, schema, RLS, money, idempotency, or `audit_log` change in any of the four PRs. No new dependency. Verified locally with Deno 2.1.4 (`deno check` exit 0 on all 28 bundles) and `pnpm --filter web test` (724 src plus 438 regression green).

## [0.14.0] · 2026-06-02 Codebase review remediation (39 findings) + repository housekeeping (PR #208)

A 55-agent adversarial codebase review surfaced 39 confirmed findings (4 HIGH, 14 MEDIUM, 21 LOW, no CRITICAL), all remediated across six workstreams on one branch, independently re-reviewed, and shipped via squash PR #208. Both migrations applied to staging then prod and verified live. Closeout journal at `03-workspace/journal/2026-06-01-wave10-review-remediation-closeout.md`.

> Changelog gap note: the 2026-05-31 Stripe billing activation and the 2026-06-01 full-DoD Phases A, B, and C (PRs #164 through #201) shipped without dedicated CHANGELOG entries. STATUS.md and the per-day journals under `03-workspace/journal/` are the authoritative record for that span.

### Changed

- **WS-A money integrity**: invoice line totals are now server authoritative. The invoicing-api handler recomputes `tax_amount_cents` and `line_total_cents` from trusted inputs in pure scaled BigInt and ignores any client-supplied derived `_cents` on both create and patch. Purchase-order line math and the SPA and dashboard money paths moved from `Math.round` (half-up) to `roundHalfEven` (banker's). `tax_rate_snapshot` confirmed and documented as a decimal fraction (`numeric(7,4)`).
- **WS-B idempotency**: `settings-api` `deleteSetting` is now wrapped in the Idempotency-Key flow. The shared wrapper moved from lookup-then-execute-then-insert to reserve-before-execute with fail-closed persist, closing a same-key concurrency window and a swallowed-persist re-execution path.
- **WS-E quality**: collapsed the duplicate `created()` response helper to one source, added logging to previously silent dashboard catches, switched mutable lists to stable id keys, normalized TanStack Query defaults, reused the shared `admin()` client in the workers, and relocated the org-scoped list helpers to `_shared/crud.ts`.

### Fixed / Security

- **WS-C audit**: removed the unused `writeAudit()`/`computeDiff()`/`withRequestContext()` helpers (a latent chain-breaking footgun with no callers) and corrected the stale header comment; added a migration `audit_log_entity_type_check` superset guard and a writer-versus-verifier payload contract test.
- **WS-D authz and security**: added a `saved_views` capability gate, made `INTERNAL_ERROR` 500 bodies opaque while logging the real cause server-side, replaced the wildcard CORS origin with an `ALLOWED_ORIGINS` allow-list, removed the `listUsers` filter-string interpolation in favor of a parameterized profiles lookup, added a webhook host allow-list (fail-closed), pinned billing redirect targets to `*.stripe.com`, and moved the Stripe price map to a shared module with a parity test.
- **CORS prod hotfix**: the new allow-list fell back to `app.kitstak.com` while prod runs at `www.kitstak.com`; the `ALLOWED_ORIGINS` edge secret was set on prod and a live preflight confirmed the correct `Access-Control-Allow-Origin` before any user impact.

### Migrations

- **`0086_idempotency_reserve_state.sql`**: relaxes `idempotency_keys.status_code` to nullable and adds a `state` column (`pending`/`completed`, default `completed`) with a check constraint; primary key unchanged; historical rows backfill as `completed`.
- **`0087_rls_select_wrap.sql`**: wraps `current_org_id()` / `current_user_role()` / `auth.uid()` calls in subqueries on the high-read tenant tables (audit_log, quotes, invoices, stock levels and movements, projects, customers, contacts, leads, opportunities and their line items), preserving USING and WITH CHECK semantics exactly. Remaining lower-traffic tables tracked as a follow-up.

### Constitution

- New `saved_views.saved_view.read|create|delete` capabilities byte-mirrored across `_shared/capabilities.ts` and `apps/web/src/lib/capabilities.ts` (read for all internal roles plus viewer; write for owner, admin, sales, ops, accounting; portal roles none).
- Two new edge secrets introduced: `ALLOWED_ORIGINS` (set on prod) and `WEBHOOK_ALLOWED_HOSTS` (unset, fail-closed while the webhook channel is dormant).

### Housekeeping

- Pruned 126 stale agent worktrees and 306 stale local branches (307 to 1, keeping only `main`) after verifying every deleted branch was merged or squash-merged into `main`.
- A `knip` dead-code scan returned only intentional structure (byte-mirror canon files, complete data-layer API surfaces, test-only exports), so no source was removed.
- `database.types.ts` verified already current with prod after `0086`.

### Filed (follow-ups)

- `F-Wave10-INDEX-SPLIT-01`: split the oversized `auth`, `kitforce`, `copack`, `ops` index files into per-resource modules.
- `F-Wave10-QUERY-DEFAULTS-SWEEP-01`: apply the shared query defaults to the remaining hooks.
- `F-Wave10-CRUD-CALLSITE-MIGRATION-01`: migrate the remaining bundles onto the shared list and get helpers.
- `F-Wave10-RLS-WRAP-REMAINDER-01`: wrap the lower-traffic tenant tables in the RLS subquery form.
- `F-Wave10-IDEMPOTENCY-PENDING-STALENESS-01`: add a staleness window or failed state so a thrown handler does not leave a pending row until nightly GC.

## [0.13.0] · 2026-05-27 Staff invite admin loop + portal v0.6 smoke (PRs #154, #155, #156, #157, #158)

Closing batch for the staff invite admin chassis end-to-end, plus customer portal v0.6 UX polish, plus a chassis improvement to canon-steward-check. Customer portal walked live on prod against a real customer with cross-tenant attack probes; all five probes returned the constitutional Pattern B answer. Day closeout journal at `03-workspace/journal/2026-05-27-day-closeout.md`.

### Added

- **`F-Wave9-CANON-STEWARD-ROUTE-HINT-01` (PR #154)**: `scripts/canon-steward-check.mjs` now emits a remediation hint when an orphan-route violation is detected, pointing at `scripts/canon-steward-allowlist.txt` with the exact format. Fires once per run (not per offending route) to keep CI output legible. Twice on 2026-05-26 an agent shipped a new orphan route without remembering the allowlist; this hint lets agents self-heal without a re-push. New 3-test regression suite at `apps/web/test/regression/canon-steward-route-hint.test.ts` spawns the real script against the real tree with `routes.ts` snapshot+restore guards. No behavioural change beyond the appended hint.
- **`F-Wave9-STAFF-INVITE-MEMBERS-LIST-01` (PR #155)**: real `GET /auth-api/members` handler replacing the v1 caller-only stub. New `org.member.list` capability byte-mirrored on both halves of the canon (granted to org_owner, org_admin, ops, accounting, viewer; denied to sales, customer_user, vendor_user). New byte-mirrored `OrgMemberRowSchema` carries `user_id, org_id, email, display_name, role_code, role_display_name, created_at, is_active, claimed`. Response is flat array per F-Wave7-LISTENVELOPE-01 canon. SPA `MembersPage` rewritten with real table (Name, Email, Role, Joined columns); caller's own row marked `(you)`; brand-aligned loading/error/empty states.
- **`F-Wave9-INVITE-EMAIL-SUBJECT-COPY-01` + `F-Wave9-STAFF-INVITE-AUDIT-01` (PR #156)**: humane email subject/body resolving inviting org's display_name ("You have been invited to join {orgDisplayName}" replacing the awkward "You have been invited to Kitstak on Kitstak" double-naming). Migration `0067_org_membership_audit.sql` extends `audit_log_entity_type_check` to include `org_membership`, adds AFTER INSERT trigger writing to audit_log with proper hash chain link (mirrors 0061 manufacturing_run_created_audit pattern); backfills 7 existing org_memberships rows. Verified live on staging (4 rows backfilled, trigger fires on insert with hash chain populated, action=invited, metadata={user_id, role_id}, to_state derived from is_active) before prod apply (7 rows backfilled).
- **`F-Wave9-STAFF-INVITE-PATCH-01` + `F-Wave9-STAFF-INVITE-RESEND-01` (PR #157)**: PATCH `/auth-api/members/:user_id` for role change + deactivate, with self-deactivate refusal (422 CANNOT_DEACTIVATE_SELF) and privilege-escalation guard (org_admin cannot mint org_owner; only org_owner can mint org_owner; returns 403 FORBIDDEN_ROLE_ESCALATION). POST `/auth-api/members/:user_id/resend` regenerates magic link via `auth.admin.generateLink({type:'magiclink'})` and queues notification through the Resend chassis; refuses already-claimed accounts (422 MEMBER_ALREADY_CLAIMED). `listOrgMembers` extended to return `claimed: boolean` from `auth.users.email_confirmed_at`; SPA Resend button only shows on unclaimed rows. Migration `0068_org_membership_update_audit.sql` extends the audit trigger from 0067 to also fire on UPDATE (`AFTER INSERT OR UPDATE`); hash chain integrity preserved; idempotent. Two new caps: `org.member.update`, `org.member.resend`. MembersPage gains action menu per non-caller row with role select (org_owner option hidden unless caller is owner), Deactivate/Reactivate, Resend buttons.
- **Portal v0.6 UX polish bundle (PR #158)**: closes four findings from the customer portal live smoke walk. **F-Wave9-PORTAL-NAV-01**: new `PortalTopbar` component mounted on all 4 portal pages with `Dashboard | Invoices | Quotes | Projects | Sign out` nav, active route emphasized; dashboard section headers become `<Link>` components into dedicated list pages; "View all" anchor under each section table; dashboard tables capped at 5 rows so the page stays a summary. **F-Wave9-PORTAL-NULL-PLACEHOLDER-01**: root cause was `formatDateMedium(null)` returning literal `"."` in `apps/web/src/lib/dates.ts`; replaced with new exported `NULL_DATE_PLACEHOLDER = '·'` constant (centered dot, U+00B7); em-dash was the obvious replacement but the constitution bans them on disk. **F-Wave9-PORTAL-STATUS-LABEL-HUMANIZE-01**: `StatusBadge` rewritten with full `LABEL_MAP` covering every status the four `/portal/*` endpoints can emit + defensive fallback that strips underscores and sentence-cases unknowns; new `humaniseStatus` export so the unit test locks the contract without going through React render; `project_pending` now reads as `Converted to project`. **F-Wave9-PORTAL-NO-ACTION-WIRING-01 (PDF only)**: two new portal-api endpoints `GET /portal/invoices/:id` + `GET /portal/quotes/:id` returning header+lines+customer display name; Pattern B scoped with 6 new regression cases (cross-customer hits return 404, wrong-role hits return 404). New SPA `PortalInvoiceActions` + `PortalQuoteActions` components fetch the detail then hand to pdf-worker's existing `/pdf/render`. `customer_user` already had `pdf.document.render` cap so no role grant change required.

### Fixed

- **MCP apply_migration phantom version ID drift (no PR, direct SQL on prod + staging)**: agents for #156 + #157 used Supabase MCP `apply_migration` to push 0067 + 0068 to prod (to verify trigger behavior end-to-end before merging). MCP stamps timestamp-style version IDs (`20260526235238`, `20260527012938`) in `supabase_migrations.schema_migrations` instead of canonical numeric file IDs (`0067`, `0068`). After PR merge, `supabase db push` saw phantom remote versions and the migrate workflow turned red. Fixed via direct SQL rename on the history table (UPDATE version=NNNN where version matches `^\d{14}$`). The same drift was then discovered on staging going back to 0047 (10 phantom rows + 1 duplicate of 0003); staging history cleaned with the same pattern. Process rule recorded as permanent memory at `memory/mcp_apply_migration_phantom_version.md`: agents apply migrations to STAGING only via MCP; let the post-merge workflow ship to prod via file-based push.

### Filed (next session)

- `F-Wave9-COWORK-SMOKE-02` (P1): `provision_organization()` does NOT stamp `kitstak_org_id` + `kitstak_org_role` on owner's `auth.users.raw_app_meta_data`. Fresh users land in NO_ACTIVE_ORG state on first sign-in. Fix: mirror PR #150's claim-stamp pattern.
- `F-Wave9-COWORK-SMOKE-05` (P1): entity creates (`customer.created`, `item.created`, `quote.created`, `project.created`, `invoice.created`) NOT in audit_log. Only state transitions + 1 line-item insert fire. Mirrors the deferred `F-Wave9-AUDIT-CREATED-SYMMETRY-01` from 2026-05-22.
- `F-Wave9-COWORK-SMOKE-06` (P1): plugin bundle gates partially wired. With `plugins.three_pl=false`, entire `/3pl-operations/*` surface works end-to-end. Constitution says "Plugin bundle gates return 404."
- `F-Wave9-COWORK-SMOKE-03` (P2): NO_ACTIVE_ORG silent failure on dashboard; companion fix to SMOKE-02.
- `F-Wave9-COWORK-SMOKE-07` (P2): invoice stepper drift vs audit_log (stepper shows PENDING filled but state never transitioned through PENDING).
- `F-Wave9-COWORK-SMOKE-08` (P2): `/admin/members` Name column renders org's display_name instead of user's name; root in `provision_organization()` writing `profiles.display_name = <org display_name>`.
- `F-Wave9-COWORK-SMOKE-01` (P3): `numbering_sequences` count off by one (plan expected 10, actual 11).
- `F-Wave9-COWORK-SMOKE-04` (P3): Cowork E2E plan has route/state/signature drift vs shipped chassis (small doc PR to reconcile).
- `F-Wave9-COWORK-SMOKE-09` (P3): dashboard PILLARS hard-renders 3 cards regardless of flag state; constitution declares 5 pillars.
- `F-Wave9-PORTAL-DETAIL-VIEWS-01`: portal row drill-in detail pages (beyond PDF download).
- `F-Wave9-PORTAL-PAY-INVOICE-01`: portal "Pay invoice" button; stacks on Stripe scoping.
- `F-Wave9-SUPABASE-MAIN-PREVIEW-RECOVER-01`: Supabase Branching `main` preview branch stuck in MIGRATIONS_FAILED since 2026-05-18; structural API limitation (cannot delete OR reset default branch); recovery requires disabling+re-enabling Branching at project level. Causes the persistent "Supabase Preview - Failing after 3s" red check on every push to main.

### Constitution

- 2 new capabilities added (`org.member.update`, `org.member.resend`) byte-mirrored across `_shared/capabilities.ts` and `apps/web/src/lib/capabilities.ts`.
- 1 new entity type added to `audit_log_entity_type_check` constraint: `org_membership`.

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
