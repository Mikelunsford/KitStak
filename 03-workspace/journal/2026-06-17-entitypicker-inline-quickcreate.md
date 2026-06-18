# Inline quick-create EntityPicker and items.supply_source (PR #327)

Date: 2026-06-17
Ticket: Inline quick-create from reference pickers (EntityPicker) plus item supply-source (2026-06-17 smoke run)
Plan: `03-workspace/specs/2026-06-17-entitypicker-inline-quickcreate-and-item-supply-source-plan.md`
Status: SHIPPED and LIVE on prod. CHANGELOG `0.24.0`. Prod at migration `0122`.

## What shipped

One feature in three phases, merged as PR #327 (squash `0e4d0b2`) and live on prod after the
migrate, deploy-functions, and deploy-prod workflows all went green.

Phase 0 to 2 (SPA, presentation and create flow):
- `Modal`: a reusable hand-rolled dialog primitive (focus trap, body scroll lock, focus
  restore) that standardizes the prior ConfirmDialogHost and ReceivePaymentModal one-offs.
- `EntityPicker`: a hand-rolled typeahead combobox (listbox ARIA, arrow and Home and End and
  Enter and Escape, outside-pointerdown close) with an optional capability-gated "+ New" row.
  The load-bearing filter and keyboard-index logic is split into `entityPickerModel` with a
  unit test, since the repo runs Vitest without jsdom.
- Five bespoke quick-create modals (customer, item, vendor, project, channel). Each posts
  through the existing service (Idempotency-Key minted by apiClient, org from the JWT) and
  hands the new record back. Because the modal mounts inside the parent form, the parent
  never unmounts, so the in-progress draft survives by construction and the new record
  auto-selects. A just-created record is merged ahead of the list refetch to avoid a label
  flash.
- Customer, Item, Vendor, Project pickers re-skinned onto EntityPicker with their public
  props unchanged, so every call site picked up the new behavior with no edit. A new
  ChannelPicker replaced the last raw select on the sales-order create form.

Phase 3 (items.supply_source, money):
- Migration `0120` adds `items.supply_source` (in_house, customer_supplied, vendor_consigned,
  third_party_consigned), NOT NULL default in_house (TEXT plus CHECK, the house style).
- Migration `0121` adds a nullable supply_source override to the five consumption-line tables
  (receiving, shipment, manufacturing-consumed, kitting-consumed, job-run-consumed); null
  inherits the item default.
- Migration `0122` rewrites `view_job_profitability` so actual material zeroes any consumed
  line whose effective source COALESCE(line, item) is customer_supplied or
  third_party_consigned. in_house and vendor_consigned keep captured cost. security_invoker
  carried over; a LEFT JOIN to items so an RLS-hidden item never drops a row or silently
  zeros cost.
- Byte-identical canon: ItemSupplySourceSchema in both sales.ts mirrors; supply_source on
  ItemSchema and ItemCreateSchema; the inline ItemWriteSchema in sales-config-api accepts it.
- Edge: both KitCost dashboard folds (inventory value and project margins) zero not-org-owned
  material, keyed off the item default per the ledger-grain decision.
- SPA: supply_source control on item create, edit, and quick-create; ItemPicker shows the
  source in the option label and filters by it; the item detail page shows the source and
  flags zero org material cost. A shared `supplySource` module carries the humanized labels
  and the zero-cost predicate (unit tested).

## Decisions taken

The operator picked the full-vision option on all four design forks: a real typeahead
combobox (not an adjacency button), a centered modal (not a drawer), the item-default plus
per-line override grain (not item-level only), and bespoke per-entity modals (not a shared
primitive).

Four money-logic decisions were locked before Phase 3 code: vendor_consigned costed at normal
cost; a fourth source third_party_consigned added; third_party_consigned rolls up as zero org
cost alongside customer_supplied (so the predicate is the two not-org-owned sources); and the
project-margins fold over the stock_movements ledger keys its zeroing off the item default
because the ledger carries no per-line override.

## Verification

- typecheck, lint (0 warnings), unit, regression (including the new `db-supply-source`
  migration test), contract parity, and the production build all green before merge.
- Migrations applied to staging via `execute_sql` (not `apply_migration`, to avoid
  phantom-version stamps) and verified: column shape, all existing items backfilled to
  in_house, the override column on 5/5 line tables, the view executes, no new advisors.
- After merge the migrate workflow stamped `0120-0122` canonically on prod and staging.
  Prod re-verified: supply_source NOT NULL default in_house, 17 items backfilled to in_house,
  override column on 5/5 line tables, the view carries the zeroing predicate.

## Acceptance criteria met

From New Quote a user creates a customer and an item inline without leaving the page (both
auto-select, draft intact); the same EntityPicker is on the quote, invoice, and sales-order
forms; the item quick-create sets supply_source and the item picker filters by it; a
customer_supplied item rolls up zero material cost in the KitCost folds and the
job-profitability view; quick-create sends an Idempotency-Key and a viewer does not see the
"+ New" row and is refused server-side; brand-clean copy, no new console errors.

## Follow-up

`F-UIUX-ENTITYPICKER-LINE-OVERRIDE-01`: the per-line override is live at the DB and the
job-profitability view. Its operator-facing surfaces are the tracked follow-up: the override
controls on the five consumption-line editors, the edge write acceptance for the override on
those line handlers, receiving cost-input disabling when the effective source is not org
owned, and the manufacturing, kitting, and shipment consumed-cost edge zeroing. The headline
item-level path meets all acceptance criteria without these.
