# EntityPicker inline quick-create and items.supply_source. Implementation plan

Date: 2026-06-17
Type: Feature. UX plus schema plus costing
Status: PLANNED. Awaiting build go-ahead
Source ticket: ticket-inline-entitypicker.md (2026-06-17 smoke run)

## Goal

Let a user create a referenced record (customer, item, vendor, project, channel) inline
from the picker, without navigating away, with the new record auto-selected on return and
the in-progress draft preserved. Add a supply-source dimension to items so the picker can
filter by it and cost roll-ups treat customer-supplied material as zero cost to the org.

## Locked decisions (operator, 2026-06-17)

1. Picker UX: full hand-rolled typeahead combobox. Replaces the native selects, carries a
   persistent "+ New {entity}" row in the dropdown. This is the ticket's stated vision and
   the larger build. Accessibility of the hand-rolled ARIA combobox is the primary risk.
2. Quick-create surface: centered modal. Extract one reusable Modal primitive first; the
   parent form stays mounted behind it, so the draft is preserved by construction.
3. supply_source grain: item-level default plus optional per-line override. The item sets
   the default; cost-bearing consumption lines may override. This is the heavier costing
   scope and touches every consumption line schema.
4. Quick-create form factoring: bespoke per-entity modals (five). The item modal also
   carries the supply_source control.

### Phase 3 money-logic decisions (operator, 2026-06-17)

5. vendor_consigned is costed at normal (captured) cost to the org. Only the
   not-org-owned sources roll up as zero.
6. Four supply sources, not three: in_house, customer_supplied, vendor_consigned, and a
   new third_party_consigned. third_party_consigned is material the org neither owns nor
   pays for, so it rolls up as zero org cost like customer_supplied (flagged for operator
   confirm at the merge halt).
7. Zeroing predicate: effective source IN ('customer_supplied', 'third_party_consigned').
   in_house and vendor_consigned keep normal cost.
8. The KitCost project-margins fold over the stock_movements ledger keys its zeroing off
   items.supply_source (the item default). The per-line override applies on the explicit
   consumption-line schemas (receiving, shipment, manufacturing-consumed, kitting-consumed,
   job-run-consumed), which is where captured cost and the job-profitability view read.
9. Build all phases on one branch; open a single PR for the whole feature when done.

Phases 0 through 2 are SHIPPED on the feature branch and green (typecheck, lint, 950 unit
tests). Phase 3 follows below.

## Root cause, confirmed in code

Both ticket hypotheses are confirmed.

- Pickers are native select wrappers with no create affordance. Six exist under
  `apps/web/src/components/ui/pickers/` (CustomerPicker, ProjectPicker, ItemPicker,
  VendorPicker, QuotePicker, InvoicePicker). Channel has no picker; `SalesOrderCreatePage`
  binds a raw `Select`. ItemPicker already exposes `onChange(id, item)` returning the full
  record, which is exactly what auto-select-on-return needs.
- Create screens are full-page routes with local `useState` drafts and no draft
  persistence. Navigating away unmounts the parent and the draft is lost.

Refinement that simplifies the fix: a modal mounted inside the parent page is not a route,
so the parent never unmounts and the draft survives without URL or storage machinery. On
save the modal returns the new record, the parent calls `onChange(newId, record)`, and the
list query is invalidated.

## What already exists and is reused

- Create registry: `CREATE_ACTIONS` plus `visibleCreateActions(can, flags)` in
  `apps/web/src/components/shell/createMenuActions.ts`. Pure and tested. Reuse for labels,
  caps, and plugin gates instead of duplicating.
- Modal pattern: hand-rolled only (Radix and shadcn are banned). Closest templates are
  `ReceivePaymentModal` and `ConfirmDialogHost`. No reusable Modal primitive exists yet.
- Create endpoints all enforce Idempotency-Key (apiClient mints `crypto.randomUUID()` on
  every non-GET), force `org_id` from the JWT, write one audit row, and call `requireCap`.
  Minimal required fields: customer `display_name`. vendor `display_name`. item `sku` plus
  `name`. project `number` plus `name`. channel `name`.
- Correct cents input: `apps/web/src/components/forms/DollarInput.tsx` (lexical parse plus
  `roundHalfEven`). Reuse it. The ticket's 100x receiving bug was not reproduced in current
  code; verify the receiving cost field rather than copy it.
- Capabilities (server, plus byte-mirrored SPA `useCapabilities().can()`):
  customer `crm.customers.write`, item `items.item.write`, vendor `vendors.vendor.create`,
  project `projects.project.write`, channel `copack.channel.write`. The viewer role holds
  none of the five, so the server-refusal acceptance criterion already holds.

## Endpoint and service map

| Entity   | Edge route                         | Service fn (`apps/web/src/lib/services`) | Required fields      | Cap                       |
|----------|------------------------------------|------------------------------------------|----------------------|---------------------------|
| Customer | POST `/crm-api/customers`          | `createCustomer`                         | display_name         | crm.customers.write       |
| Item     | POST `/sales-config-api/items`     | `createItem`                             | sku, name            | items.item.write          |
| Vendor   | POST `/vendors-api/vendors`        | `createVendor`                           | display_name         | vendors.vendor.create     |
| Project  | POST `/projects-api/projects`      | `createProject`                          | number, name         | projects.project.write    |
| Channel  | POST `/copack-api/sales-channels`  | `createSalesChannel`                     | name (kind manual)   | copack.channel.write      |

## Build plan

### Phase 0. Shared primitives (SPA only, safe)

- `components/ui/Modal.tsx`. Hand-rolled, `role="dialog"`, `aria-modal`, labelled by title,
  focus trap, Escape to close, backdrop click to close, body scroll lock, focus restore to
  the trigger on close. Improves on the inconsistent ReceivePaymentModal and
  ConfirmDialogHost patterns. Axe-clean.
- `components/ui/EntityPicker.tsx`. Hand-rolled typeahead combobox primitive:
  `role="combobox"` input plus `role="listbox"` results, `aria-activedescendant` roving
  selection, ArrowUp and ArrowDown and Home and End and Enter and Escape, type-to-filter,
  a persistent "+ New {entity}" row at the foot of the list gated by `can(cap)`. Generic
  over option shape via props: `items`, `getOptionLabel`, `value`, `onChange(id, record)`,
  `onQuickCreate`, `createLabel`, `createCap`, loading and disabled states. The Cmd-K
  CommandBar listbox in `components/shell/CommandBar.tsx` is the closest existing reference
  for the keyboard and ARIA shape.

### Phase 1. EntityPicker plus quick-create for customer and item, on the highest-traffic forms

- Re-skin CustomerPicker and ItemPicker on top of EntityPicker. Preserve current prop
  contracts, including ItemPicker's `onChange(id, item)` dual argument.
- Build `QuickCreateCustomerModal` and `QuickCreateItemModal` (bespoke). Each posts via the
  existing service (Idempotency-Key automatic), then returns the created record.
- Wire into QuoteCreatePage, InvoiceCreatePage, SalesOrderCreatePage. On create success:
  `queryClient.invalidateQueries({ queryKey: entityKeys.all })` plus
  `onChange(newId, record)` so the new row is auto-selected and the draft is untouched.
- Gate the "+ New" row with `useCapabilities().can(cap)`. Server stays the authority.

### Phase 2. Extend to vendor, project, channel

- Re-skin VendorPicker and ProjectPicker on EntityPicker. Build a new `ChannelPicker`
  (none exists today) and replace the raw `Select` in SalesOrderCreatePage.
- Build `QuickCreateVendorModal`, `QuickCreateProjectModal`, `QuickCreateChannelModal`.
- Channel create only accepts `kind = 'manual'` server-side; the modal offers no kind
  control.

### Phase 3. items.supply_source plus per-line override plus costing (money-sensitive. HALT before merge)

This phase touches money math and a numbered SQL view. Per the constitution it stops for
operator confirmation before merge.

DB, forward-only and idempotent:

- `0120_item_supply_source.sql`. `ALTER TABLE public.items ADD COLUMN IF NOT EXISTS
  supply_source text NOT NULL DEFAULT 'in_house' CHECK (supply_source IN ('in_house',
  'customer_supplied', 'vendor_consigned'))`. The NOT NULL DEFAULT backfills existing rows
  to `in_house`. RLS untouched: items already has Pattern A covering all columns (0012).
- Per-line override columns on the cost-bearing consumption lines (nullable text, same
  CHECK, null means inherit the item default): receiving order line items, shipment line
  items, manufacturing run consumed line items, job run daily log consumed line items.
  Revenue lines (quote, invoice) do not get the override; they are not material-cost inputs.
- `0121_job_profitability_supply_source.sql`. `CREATE OR REPLACE VIEW
  public.view_job_profitability` so `actual_material_cents` zeroes any consumed line whose
  effective source (COALESCE(line override, item default)) is `customer_supplied`. Forward
  migration. Does not edit 0104.

Types, byte-identical canon (`pnpm test:contract`):

- Add `ItemSupplySourceSchema = z.enum(['in_house', 'customer_supplied', 'vendor_consigned'])`
  to both `supabase/functions/_shared/types/sales.ts` and
  `apps/web/src/lib/types/sales.ts`. Add `supply_source: ItemSupplySourceSchema` to
  `ItemSchema` (after `barcode`, before `is_active`) and to `ItemCreateSchema`
  (`.default('in_house')`) so existing create calls keep working. Mirror the same default
  into the inline `ItemWriteSchema` in `sales-config-api/index.ts`. Add the nullable
  override field to the four consumption line schemas in `_shared/types` and their SPA
  mirrors.

Costing roll-up zeroing (strategy: zero at the roll-up site, preserve the stored cost so
data is not destroyed. vendor_consigned keeps normal cost):

| Site                         | Layer        | File                                                  | Change |
|------------------------------|--------------|------------------------------------------------------|--------|
| KitCost inventory value      | Edge         | `dashboard-api/index.ts` (~455 to 536)               | zero costByItem entries where item.supply_source = customer_supplied |
| KitCost project margins      | Edge         | `dashboard-api/index.ts` (~587 to 686)               | same, in the stock_movements cost fold |
| Job profitability material   | Postgres     | `0121_job_profitability_supply_source.sql`           | COALESCE(line override, item default), zero customer_supplied |
| Receiving line cost          | Edge plus SPA| ops-api receiving handlers, `ReceivingOrderDetailPage.tsx` | reject or zero cost for customer_supplied; SPA disables the cost input |
| Shipment line cost           | Edge         | ops-api shipment handlers                            | zero cost for customer_supplied |
| Manufacturing consumed cost  | Edge         | manufacturing-api consumed handlers                  | zero cost for customer_supplied |
| Item cost display            | SPA          | item detail and list                                 | show a supply_source badge; render org cost as zero for customer_supplied |

SPA surfacing:

- supply_source control in the item create and edit page and in QuickCreateItemModal.
- EntityPicker for items filters and groups by supply_source and shows it in the label.
- Per-line override control on the four consumption line editors, defaulting to inherit.

## Constitutional invariants honored

- Money is BIGINT cents with `roundHalfEven` only. Reuse DollarInput and money.ts. Never
  float. Do not copy the receiving cost field; verify it.
- Idempotency-Key on every quick-create (apiClient mints it). Org is taken from the JWT;
  the client never sends org_id.
- One hash-chained audit row per create, via the existing handler and trigger path.
- Byte-identical canon for types/sales.ts and capabilities.ts. `pnpm test:contract` is a
  release blocker.
- Migrations are forward-only, four-digit, idempotent, with the standard header.
- Capability gating is server-authoritative. The "+ New" row is button-hiding only.
- Brand-clean copy. No em dashes, no double hyphens, no emojis. Dollars in display, cents
  on the wire.

## Tests

- Contract: `pnpm test:contract` after every canon edit (types and capabilities parity,
  money parity).
- Unit: EntityPicker keyboard and ARIA behavior, "+ New" row hidden for viewer, modal focus
  trap and restore, each QuickCreate modal happy path and validation.
- Costing: dashboard inventory-value and project-margins folds zero customer_supplied,
  job-profitability view zeroes customer_supplied via effective source, per-line override
  beats item default.
- Accessibility: axe on the modal and the combobox.

## Risks and open items

- Hand-rolled combobox accessibility is the main risk. Budget for keyboard, focus, and axe
  passes at 320, 768, 1024, 1440.
- Per-line override expands Phase 3. stock_movements feeds the project-margins fold but is a
  ledger; decide in Phase 3 design whether the effective source is derived from the
  originating consumption line or from the item default only. Resolve before building the
  fold change.
- vendor_consigned is treated as normal cost to the org in this plan. Confirm that is the
  intended accounting treatment.
- A fourth supply source beyond the three (for example third-party consignment) is not
  included. Confirm three is enough.
- Receiving cost field 100x scaling: not reproduced in current code. Verify the edge handler
  and the SPA input during Phase 3 rather than assume.

## Follow-ups noted during research (pre-existing, not blockers)

- ProjectPicker and InvoicePicker filter client-side because the list endpoints lack
  `customer_id` and `project_id` query params. Server-side filter is a separate follow-up.
- QuoteCreatePage still exposes raw UUID inputs for default_tax_id, payment_method_id, and
  pricing_tier_id under a disclosure. Pickers for those three FK fields are out of scope here.
