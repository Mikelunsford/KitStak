# Wave 2 Closeout: Domain Ports

Date: 2026-05-18
Wave: 2 (Phase 2 of the parallel build orchestration)
Status: Closed
Branch: `claude/phase-2-domain-ports`

## Wave summary

Six parallel sub-agents ran end-to-end in disjoint write zones to port every domain table, edge function bundle, and SPA surface needed to light Pillar 1 (3PL Operations) and plumb Pillars 2 to 3. Migration slots 0004 through 0040 are now claimed and forward-only. Twenty-one new edge function bundles (plus the two scheduled functions from Wave 1) ship the API surface. Eighteen byte-identical side-car canon pairs (six domains times three kinds: types, workflow, capabilities) keep the parity discipline intact without forcing the singular files to absorb every new contribution. Audit triggers cover all fourteen state machines plus the organization machine seeded in Wave 1, verified by a coverage probe in migration 0037.

## Deliverables

### Migrations (37 total, slots 0004 to 0040, forward-only)

- **Identity (Agent A · slots 0004 to 0006)**: 0004_identity_extensions ships org_settings, org_domains, numbering_sequences, next_doc_number RPC with `pg_advisory_xact_lock`, identity_providers. Slots 0005 and 0006 unused (no further material DDL beyond what 0002 + 0004 cover).
- **CRM (Agent B · slots 0007 to 0010)**: customers, contacts, activities, leads (5-state text CHECK), opportunities (6-stage), convert_lead SECURITY DEFINER atomic RPC, audit state-change triggers.
- **Sales (Agent C · slots 0011 to 0017)**: currencies, exchange_rates (Pattern C global), taxes, payment_methods, pricing_tiers, customer_pricing_overrides, items, units, item_categories, value_added_services, job_types, quotes (6-state), quote_line_items, quote_versions (SECURITY DEFINER snapshot), quote_approvals, quote_templates, projects (6-state), project_phases (4-state), convert_quote_to_project RPC, recompute_quote_totals trigger, set_default_tax / set_default_payment_method atomic-flip RPCs.
- **Finance (Agent D · slots 0018 to 0024)**: invoices (9-state, balance_cents GENERATED ALWAYS AS), invoice_line_items, invoice_versions, payments, payment_allocations, credit_notes (4-state), credit_note_allocations, chart_of_accounts plus seed_org_chart_of_accounts, journal_entries (3-state), journal_entry_lines, check_journal_balance invariant, post_journal_entry RPC, period_close (text CHECK 4-state, not pg enum), close_period / reopen_period RPCs, tg_je_reject_closed_period raising SQLSTATE P0001 with period_closed prefix, three auto-JE triggers (invoice send, payment create, credit note allocate) all EXISTS-guarded and flag-gated.
- **Vendors / Inventory / Ops (Agent E · slots 0025 to 0033)**: vendors, purchase_orders (7-state), po_line_items, recompute_purchase_order_totals, vendor_bills (7-state, balance_cents GENERATED), vendor_bill_payments, recompute_vendor_bill_paid, expenses (6-state), expense_categories, three auto-JE triggers (vendor bill approved, vendor bill paid, expense paid) all EXISTS-guarded and flag-gated, warehouses, stock_levels (quantity_available GENERATED), stock_movements, seed_org_default_warehouse, recompute_stock_level, bom_items, receiving_orders (4-state), production_runs (4-state), shipments (4-state), three stock-movement-emitter triggers, ops audit state-change triggers.
- **Cross-cutting (Agent F · slots 0034 to 0040)**: attachments (polymorphic), Storage bucket `attachments`, comments, saved_views, notifications, audit_log entity_type CHECK extended to 30 types, audit_trigger_coverage_gaps() verifier (coverage all 14 state machines confirmed across Agents B / C / D / E plus organization from Wave 1), seed_org_numbering, quote_attachments VIEW over generic attachments, seed_org_settings with 10 default feature-flag rows.

### Edge function bundles (21 new plus 2 scheduled from Wave 1)

- Identity: `auth-api`, `tenants-api`, `settings-api`, `admin-console-api` (bundle-gated on `platform_admin.enabled` returning 404 when off).
- CRM: `crm-api` (26 routes).
- Sales: `sales-config-api`, `quotes-api`, `projects-api`.
- Finance: `invoicing-api`, `finance-api`.
- Vendors / Inventory / Ops: `vendors-api`, `inventory-api`, `ops-api` (bundle-gated on `plugins.3pl` returning 404 when off).
- Cross-cutting: `collaboration-api`, `search-api`, `customer-portal-api` (Pattern B RLS, customer_user role only), `dashboard-api`, `exports-api`, `imports-api`, `notifications-worker` (verify_jwt false, X-Worker-Secret), `pdf-worker` (501 PDF_NOT_YET_AVAILABLE stub pending operator-approved JS PDF dep).

Every state-changing handler enforces `respondWithIdempotency` plus `requireCap` (or a local `requireXxxCap` shim composing the side-car capabilities tuple until Canon Steward folds them into master).

### Side-car canon (18 byte-identical pairs)

Each domain ships `_shared/{types,workflow,capabilities}/<domain>.ts` paired with `apps/web/src/lib/{types,workflow,capabilities}/<domain>.ts`. The byte-identity is asserted by an extended `apps/web/test/contract/parity.test.ts` that now covers 22 file pairs (4 singular plus 18 side-cars). Singular canon files unchanged this wave.

- identity, crm, sales, finance, vendors_inventory_ops, cross_cutting.
- `_shared/workflow/cross_cutting.ts` ships the `ALL_STATE_MACHINES` union built from each domain's `_FSMS` aggregator. The Deno `.ts` import suffix required `allowImportingTsExtensions: true` in `apps/web/tsconfig.json` (the one Canon Steward edit).

### SPA pages (50+)

- Admin: SettingsPage, BrandingSettingsPage, FeatureFlagsAdminPage, NumberingAdminPage.
- CRM: customers / contacts / activities / leads / opportunities list, detail, create, kanban, pipeline (13 pages).
- 3PL Operations pillar:
  - items, sales-config (taxes, currencies, FX, payment methods, pricing tiers), vas.
  - quotes (list, detail, create, send), projects (list, detail with phase reorder, create).
  - invoicing (list, detail, create, send), payments (list, apply), credit-notes (list, detail, apply).
  - vendors, purchase-orders, vendor-bills, expenses, warehouses, stock (levels grouped by warehouse, movements), receiving, production, shipments.
- Finance: ChartOfAccountsPage, JournalEntriesListPage, JournalEntryDetailPage, PeriodClosePage.
- Cross-cutting: PortalSignInPage, PortalDashboardPage, PortalInvoicesPage, PortalQuotesPage, PortalProjectsPage, GlobalSearchResultsPage, DashboardSummaryPage, ImportWizardPage, ImportHistoryPage, ExportsPage.

All forms use `useState` plus `zod.safeParse`. All money input via cents per the constitution. Charts hand-rolled SVG (no chart library per ban list).

### SPA scaffolding (services + queryKeys + hooks)

One service file per primary entity, matching `queryKeys` and `hooks`. Cross-cutting hooks (`useMe`, `useBranding`, `useCapabilities`, `useSwitchOrg` from Wave 1) plus domain hooks for every CRUD + state transition + flag-gated operation.

### Routes registration

`apps/web/src/routes.ts` extended via per-agent marker blocks (`// === Agent X: ... routes ===` / `// === End Agent X ===`). 67 total route specs in the flat `RouteSpec[]` table. Guards: `protected` (signed-in staff), `admin` (org_owner / org_admin), `portal` (customer_user), `public` (sign-in, resolve-host fallback).

### Capability matrix

~120 capabilities partitioned across 6 side-car files:
- `identity.*`, `tenancy.*`, `branding.*`, `settings.*`, `flags.*`, `admin.*` (23 caps · Agent A).
- `crm.*` (17 caps · Agent B).
- `items.*`, `taxes.*`, `currencies.*`, `quotes.*`, `projects.*`, `vas.*` (Agent C).
- `invoices.*`, `payments.*`, `credit_notes.*`, `coa.*`, `journal_entries.*`, `period_close.*` (Agent D).
- `vendors.*`, `purchase_orders.*`, `vendor_bills.*`, `expenses.*`, `warehouses.*`, `stock.*`, `receiving.*`, `production.*`, `shipments.*` (~42 caps · Agent E).
- `audit_log.read`, `attachments.*`, `comments.*`, `notifications.*`, `search.*`, `dashboard.*`, `imports.*`, `exports.*`, `portal.*`, `pdf.render` (Agent F).

Per-domain role policy maps live in each side-car. A future Canon Steward step (deferred to a constitution-approved patch) merges these into the master `_shared/capabilities.ts` `CAPABILITIES_BY_ROLE` table; today, handlers use a local `requireXxxCap` shim per domain.

### Documentation

- `docs/api/identity.md`, `crm.md`, `sales.md`, `finance.md`, `vendors.md`, `inventory.md`, `ops.md`, `cross_cutting.md`.
- `docs/users/identity.md`, `crm.md`, `sales.md`, `finance.md`, `3pl-operations.md`, `portal.md`.

## Canon Steward work this wave

1. Verified all 18 side-car pairs byte-identical via `diff -q`.
2. Filled `ALL_STATE_MACHINES` in `_shared/workflow/cross_cutting.ts` and the SPA mirror, byte-identical.
3. Set `allowImportingTsExtensions: true` in `apps/web/tsconfig.json` so the SPA can write `from './identity.ts'` (required for byte-identity with the Deno-side `.ts` import suffix convention).
4. Extended `apps/web/test/contract/parity.test.ts` to assert byte-equality across the 18 side-car pairs plus the original 4 singular pairs. 25 / 25 tests pass.
5. Fixed 13 typecheck errors in Agent E's create pages: loosened local `Field` component signatures to `error?: string | undefined`, and normalized `undefined` -> `null` (or used conditional-spread) at the mutate boundary for nullable database columns.
6. Fixed 2 lint warnings (`react-hooks/exhaustive-deps` false positives from `typeof X.data` in a `useMemo` body) by extracting the dependency to a local variable before the hook.

## Gates verified

| Gate | Result |
|---|---|
| `pnpm install` (lockfile clean) | green |
| `pnpm --filter web typecheck` | zero errors |
| `pnpm --filter web lint` | zero errors, zero warnings |
| `pnpm --filter web test` | 5 / 5 |
| `pnpm --filter web test:contract` | 25 / 25 (4 singular + 18 side-car + 3 money) |
| `pnpm --filter web build` | succeeds |
| `pnpm --filter web bundle-budget` | **25.55 kB / 40 kB** |
| Brand validation greps | zero user-facing violations; internal-context hits acceptable per REBRAND-MAP §10 |
| TS1 read-only zone | untouched |
| Migration slot collisions | none (slot ranges reserved per agent) |
| Migration forward-only headers | every new migration carries the canon header |

## Pillar status at end of Wave 2

- **Pillar 1 · 3PL Operations**: lit. Receiving, production, shipments emit stock movements via triggers. Ops bundle gates on `plugins.3pl`. SPA pages render under `pages/3pl-operations/`.
- **Pillar 2 · Manufacturing**: plumbed. BOM table shipped; production_run schema ready; UI gated.
- **Pillar 3 · Co-Pack and Ecom**: plumbed. Quote-to-invoice-to-shipment flow shipped; pillar-specific UI deferred.
- **Pillar 4 · KitForce**: not in Phase 2 scope. Plumbing in a later wave.
- **Pillar 5 · KitCost**: not in Phase 2 scope. Plumbing in a later wave.

## Risks closed

- R-W2-AGENT-A-01 through 05 (Agent A): org_settings, org_domains, numbering_sequences, identity_providers, auth/tenants/settings/admin bundles.
- R-W2-CRM-01 through 12 (Agent B subset closed; 5 carry forward to Wave 3 as F-Wave2-CRM-01 through 05).
- R-W2-SALES-* (Agent C): money cents discipline, version snapshotting via SECURITY DEFINER, atomic convert-quote-to-project RPC.
- R-W2-FINANCE-* (Agent D): balance_cents GENERATED on invoices closes AUDIT.md row 72, period_close trigger raises SQLSTATE P0001, auto-JE triggers EXISTS-guarded plus flag-gated.
- R-W2-VIO-* (Agent E): all 6 state machines text CHECK, stock movements emitted by trigger.
- R-W2-CO-* (Agent F): audit_log entity_type extended, audit trigger coverage verified across all 14 state machines, customer portal enforces Pattern B + customer_id row filter.

## Follow-ups (Wave 3 and beyond)

- **F-Wave2-AGENT-A-04**: orchestrator-driven contract test of side-car pairs. **Done this wave by Canon Steward.**
- **F-Wave2-AGENT-A-05**: compose domain side-car capabilities into master `_shared/capabilities.ts`. **Deferred** to a separate operator-approved patch so the singular byte-mirror is touched only once.
- **F-Wave2-AGENT-A-06**: set `verify_jwt = false` on `tenants-api` route `resolve-host`. **Deferred** to Phase 5 (probes / observability) or to operator's first deploy of tenants-api.
- **F-Wave2-CRM-01 through 04**: kanban drag-to-transition; cursored "load more" service; ContactCreatePage; ActivityDetailPage. Wave 3 polish.
- **F-Wave2-CRM-05**: Canon Steward role-type unification (local `CrmRoleCode` cast). Wave 3 cleanup.
- **F-Wave2-CO-01**: pdf-worker render endpoint. Requires operator-approved JS PDF dep (pdfkit or jsPDF, both BSD).
- **F-Wave2-CO-02**: search-api tsvector + GIN migration. Performance refit on the ILIKE fallback.
- **F-Wave2-CO-03**: imports-api async + job ledger. Sync-only at v1.
- **F-Wave2-CO-04**: notifications-worker real email / webhook transports. Logs and marks delivered today.
- **F-Wave2-DNDKIT-01**: `dnd-kit` is referenced by the canon (`00-canon/01-architecture.md`) and was used by Agent C's project-phase reorder spec, but the package is not in `apps/web/package.json`. Phase 1 oversight. Project phase reorder shipped as up / down buttons. Add `dnd-kit` (`@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/utilities`) as a Wave 3 dep change after operator review of the bundle-budget impact.
- **F-Wave2-DOC-01**: pull `docs/api/sales.md` reference to "TS1's pricing_menu" out into an ADR if any reader confusion surfaces. Today the file is internal-context engineering docs.

## Constitutional invariants verified

- Money: BIGINT cents everywhere; `_cents` suffix; `tax_rate_snapshot` captured per line; `balance_cents` GENERATED ALWAYS AS on invoices and vendor_bills (the AUDIT.md asymmetry from row 72 closed); FX and zero-decimal currencies preserved.
- RLS: Pattern A on every new tenant-scoped table; Pattern B on customer-portal-api; Pattern C on global `currencies`, `exchange_rates`, `roles`.
- Migrations: forward-only; numbered headers complete; idempotent DDL.
- Audit log: hash chain active per migration 0002; auto-state-transition triggers on every state machine; entity_type CHECK extended to 30 types in 0036; coverage verified by 0037 `audit_trigger_coverage_gaps()`.
- Idempotency: PK `(key, user_id, org_id, route_hash)` per D-010; UUID v4; `Idempotent-Replay: true` header on replay; same-key-different-body returns 409.
- Capabilities: every state-changing handler calls a `requireXxxCap` per its domain; server is authority; SPA mirror for button hiding only.
- Workflow: 14 state machines text CHECK (not pg enum); paired `<state>_at timestamptz` columns stamped by trigger; `canTransition` shared between SPA and edge via byte-identical side-cars.
- Period close: enforced at the trigger layer via SQLSTATE P0001 with `period_closed:` prefix mapped to 422.
- Branding: zero "Built to Deliver", zero "Team 1" or "TS1" in product copy. SQL line-comment `--` syntax and internal documentation citations to TS1 (the reference codebase) are acceptable per REBRAND-MAP §10.
- Bundle budget: 25.55 kB gzip against the 40 kB cap.
- Zod canon: byte-mirror parity intact across 4 singular + 18 side-car pairs.
- JWT claim shape: `kitstak_org_id` / `kitstak_org_role` (no `team1_*`).
- No banned dependencies introduced.
