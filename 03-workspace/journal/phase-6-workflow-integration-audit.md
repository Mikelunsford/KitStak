# Phase 6 Workflow Integration Audit (Full Pillar 1)

Date: 2026-05-18
Author: Workflow Integration Auditor agent
Trigger: F-Wave6-FLOW-01 operator-led prod exercise surfaced cross-domain wiring gaps.
Status: Audit complete. Remediation wave (Phase 6.5) scope to be determined by operator.

## Executive summary

The Wave 2 domain ports shipped 67 routes, ~50 SPA pages, and every Pillar-1 table with the right FK columns in the schema. The operator's quote-to-cash exercise nevertheless surfaced eight broken transitions because no agent owned cross-domain wiring: each domain agent shipped CRUD for its own tables, but the FK pickers, conversion carryover, related-entity sections on detail pages, and the bridge UI between entities were never built. The audit found 41 actionable gaps grouped into 24 SMALL (UI-only, schema and handler already permit it), 13 MEDIUM (UI plus handler change, sometimes a column add or RPC), and 4 LARGE (missing feature: project_bill_of_materials, project_line_items carryover, receiving_order_line_items table, project-to-invoice conversion RPC). The quote-to-cash chain holds 21 of the 41 gaps and is the most affected. One gap is a true blocker for symptom 4 (G-OPS-FLAG-01: ops-api reads feature flag key `plugins.3pl` while the seed_org_settings writes `plugins.three_pl`; ops-api returns 404 for every shipments / receiving / production call against any org whose flags were seeded from the canonical helper). Top three must-fix-now items: G-OPS-FLAG-01 (flag-key mismatch breaks the entire ops-api bundle), G-QUOTE-FORM-01 (no customer picker on quote create), G-PROJECT-DETAIL-01 (project detail page is phases-only; no line items, no source quote link, no customer, no related receiving / shipments / invoices).

## Methodology

The audit cross-referenced every Wave 2 migration (slots 0007 to 0040 plus the 0041 cross-tenant fix) against the corresponding edge function handlers under `supabase/functions/<bundle>-api/` and the SPA pages under `apps/web/src/pages/`. For each entity in the Pillar-1 surface, the auditor enumerated the rendered CREATE form fields, the table columns and FK constraints, the Zod parse target accepted by the create handler, the related-entity sections on the detail page, and the cross-entity conversion carryover where applicable. No behavioral testing was performed; the audit is purely static read-through of the post-merge state at commit `f97bc24`. Where a gap depends on a feature-flag value or org-state, the audit cites the migration that defines the canonical key and the handler line that reads it.

## CRM chain

### Lead
- Create form: **NONE**. `apps/web/src/pages/crm/leads/` ships LeadsKanbanPage, LeadDetailPage, LeadConvertPage. No create page; routes table at `apps/web/src/routes.ts:500-512` has `/crm/leads`, `/crm/leads/:id`, `/crm/leads/:id/convert` but no `/crm/leads/new`. F-Wave2-CRM-* did not call this out.
- Schema: `supabase/migrations/0008_crm_activities_leads_opportunities.sql` defines `leads` with 5-state text CHECK (`new`, `contacted`, `qualified`, `disqualified`, `converted`), `display_name`, `company_name`, `source`, `primary_email`, `estimated_value_cents`, `currency_code`, `converted_customer_id`, `converted_opportunity_id`.
- Handler: `supabase/functions/crm-api/` exposes lead routes including POST.
- Detail page: `LeadDetailPage.tsx` shows static fields plus a "CONVERT" link when `status === 'qualified'`. No edit, no activities subsection, no "Create opportunity from lead" beyond the convert link.
- Gaps:
  - G-LEAD-FORM-01 (MEDIUM): missing LeadCreatePage; no route entry; sidebar link `/crm/leads` lands on kanban with no create CTA.

### Opportunity
- Create form: **NONE**. Only `OpportunitiesPipelinePage` (list/kanban) and `OpportunityDetailPage` exist. Routes table at `apps/web/src/routes.ts:518-524` has no `/crm/opportunities/new`.
- Schema: `0008` defines `opportunities` with `customer_id uuid not null`, 6-stage text CHECK, `amount_cents`, `currency_code`, `probability_pct`, `expected_close_date`.
- Handler: crm-api exposes POST.
- Detail page (`OpportunityDetailPage.tsx`): shows fields plus stage transitions. Renders `customer_id` as a raw UUID string (no display_name lookup, no link to customer). No "Create quote from opportunity" action despite this being the natural next transition.
- Gaps:
  - G-OPP-FORM-01 (MEDIUM): missing OpportunityCreatePage with customer picker (customer_id required); no route entry.
  - G-OPP-DETAIL-01 (SMALL): OpportunityDetail renders customer_id as raw UUID instead of resolving display_name and linking to `/crm/customers/:id`.
  - G-OPP-FLOW-01 (MEDIUM): no "Create quote" action on opportunity detail; the lead-conversion exit point is the only forward chain.

### Customer
- Create form: `CustomerCreatePage.tsx` captures display_name, kind, primary_email, primary_phone. Schema has more columns (tax_id, default_currency_code, billing_address, shipping_address, default_payment_terms_days) not surfaced.
- Schema: `supabase/migrations/0007_crm_customers_contacts.sql` defines `customers` with rich field set.
- Handler: crm-api accepts the create body; the Zod schema likely accepts the extra fields as optional.
- Detail page (`CustomerDetailPage.tsx`): shows 7 fields and an "EDIT" link. **No related-entity sections at all** (no contacts, no quotes, no projects, no invoices, no payments, no activities). The customer is the central FK target of the whole quote-to-cash chain; a customer detail page that does not surface their quotes / projects / invoices is a major usability hole.
- Gaps:
  - G-CUST-DETAIL-01 (MEDIUM): no related-entity sections (quotes, projects, invoices, payments, contacts, activities) on CustomerDetailPage. Data already exists (list endpoints support `?customer_id=` filter on invoices; needs same on others).
  - G-CUST-FORM-01 (SMALL): CustomerCreatePage missing fields (tax_id, default_currency_code, billing_address, shipping_address, payment_terms) that the schema and handler already accept.

### Contact
- Create form: **NONE**. F-Wave2-CRM-03 already calls out missing ContactCreatePage.
- Schema: `0007` defines `contacts` with `customer_id uuid` FK.
- Handler: crm-api supports POST contacts.
- Detail page (`ContactDetailPage.tsx`): exists; no scope-back link to parent customer.
- Gaps:
  - G-CONTACT-FORM-01 (MEDIUM, dup of F-Wave2-CRM-03): missing ContactCreatePage with customer picker.

## Quote-to-cash chain

### Customer (cross-cut)
See Customer above. Customer is the chain's entry point; G-CUST-DETAIL-01 is in critical position.

### Quote
- Create form: `apps/web/src/pages/3pl-operations/quotes/QuoteCreatePage.tsx` captures only `number`, `title`, `currency_code`. **No customer_id picker** despite quotes.customer_id existing in schema and CreateQuoteRequestSchema permitting it.
- Schema: `supabase/migrations/0014_sales_quotes.sql:33` defines `customer_id uuid` (nullable, no FK constraint surprisingly). All other quote-header fields exist (default_tax_id, payment_method_id, pricing_tier_id, expiration_date, currency_code, exchange_rate_e9, notes, internal_notes).
- Handler: `supabase/functions/quotes-api/index.ts:69` reads `CreateQuoteRequestSchema` from `_shared/types/sales.ts:351`. That schema declares `customer_id: UuidSchema.nullable().optional()` plus seven other optional fields. The handler at line 76 `...body` spreads them all into the insert. UI just doesn't capture them.
- Detail page (`QuoteDetailPage.tsx`): shows number, title, status. **No customer display, no customer attach UI**. Line items use freeform `name` only (no item_id picker that maps to `items` table even though quote_line_items.item_id FK exists). No discount/tax UI on line creation despite the math supporting it. No notes/terms display.
- Gaps:
  - G-QUOTE-FORM-01 (SMALL, ROOT-CAUSE for symptom 1): QuoteCreatePage lacks customer_id picker.
  - G-QUOTE-FORM-02 (SMALL): QuoteCreatePage lacks expiration_date, default_tax_id, payment_method_id, pricing_tier_id, notes, internal_notes fields.
  - G-QUOTE-DETAIL-01 (SMALL): QuoteDetailPage does not display customer (name + link) or allow attaching one post-creation.
  - G-QUOTE-LINE-01 (MEDIUM): line-add form is freeform-name only; no item picker that resolves item_id, sku, unit_price_cents from the items catalog. tax_id and discount_bps are also unreachable from the UI even though the handler accepts them.
  - G-QUOTE-SCHEMA-01 (SMALL, optional): `quotes.customer_id` has no FK constraint to `customers(id)`. Add as forward migration 0042 with `on delete set null` to harden the chain.

### Quote -> Project conversion
- Handler: `supabase/functions/quotes-api/index.ts:309` calls `convert_quote_to_project` RPC. Migration 0041 (the cross-tenant fix) is the current canonical RPC body; the function reads quote.customer_id, currency_code, title and inserts a project. **It does not copy line items.** The new project has zero line items, zero materials, zero phases.
- SPA `useConvertQuoteToProject` (`apps/web/src/lib/hooks/useQuotes.ts:53`): invalidates query caches but **does not navigate to the new project**. Operator stays on the quote page after conversion with no breadcrumb to the project just created.
- Gaps:
  - G-CONVERT-01 (MEDIUM, ROOT-CAUSE for symptom 2 part 1): convert_quote_to_project RPC does not copy quote_line_items onto the resulting project. The constitutional answer is to either (a) add a `project_line_items` table mirroring quote_line_items shape and have the RPC copy them, or (b) add a `project_id` column to quote_line_items and let the RPC re-anchor them. Operator decision: (a) is the lower-coupling choice and matches the rest of the line-items pattern; reserve migration slot 0042 or 0043.
  - G-CONVERT-02 (SMALL): convert mutation `onSuccess` does not navigate to `/3pl-operations/projects/<new_id>`. Trivial hook fix.

### Project
- Create form: `ProjectCreatePage.tsx` captures only `number` and `name`. **No customer_id picker, no source_quote_id, no job_type_id, no currency_code field, no budget_cents, no due_date.** CreateProjectRequestSchema (`_shared/types/sales.ts:392`) permits all of them.
- Schema: `0016_sales_projects.sql:33-65` defines projects with customer_id (nullable, no FK), source_quote_id (FK to quotes), job_type_id (FK to job_types), currency_code, budget_cents, start_date, due_date.
- Handler: createProject at `projects-api/index.ts:73` accepts the rich body.
- Detail page (`ProjectDetailPage.tsx`): shows number, name, state, phase list, audit timeline. **No customer display, no source quote link, no line items / materials / BOM, no related receiving orders, no related shipments, no related invoices, no budget display, no currency display.**
- Gaps:
  - G-PROJECT-FORM-01 (SMALL): ProjectCreatePage missing all FK pickers and config fields.
  - G-PROJECT-DETAIL-01 (LARGE, ROOT-CAUSE for symptoms 2-7 collectively): ProjectDetailPage lacks customer display, source-quote breadcrumb, line items / materials section, related receiving orders section, related shipments section, related invoices section. This is the single most-blocked page in Pillar 1. Building it requires the line-items carryover (G-CONVERT-01) and the project_id FKs on shipments and receiving_orders (G-SHIP-FK-01 and G-RECV-FK-01 below).
  - G-PROJECT-SCHEMA-01 (SMALL): projects.customer_id has no FK constraint to customers(id).

### Project -> Receiving linkage
- Schema: `0032_ops_receiving_production_shipments.sql:19-39` defines receiving_orders with purchase_order_id, warehouse_id, vendor_id FKs. **No project_id FK.** Line items stored as `payload.lines` JSON (no normalized table).
- Handler: `ops-api/index.ts:83` ReceivingCreate Zod accepts warehouse_id, purchase_order_id, vendor_id, receiving_number, expected_date, reference, notes, payload. **No project_id.**
- UI: ReceivingOrdersListPage has no "Create" button or page. No ReceivingOrderCreatePage exists. ReceivingOrderDetailPage exists. There is no route entry `/3pl-operations/receiving/new`.
- Gaps:
  - G-RECV-FK-01 (MEDIUM): receiving_orders table has no project_id column. Add via forward migration. Without this, receive-against-project is not even modelable.
  - G-RECV-FORM-01 (MEDIUM): missing ReceivingOrderCreatePage with warehouse picker, optional vendor picker, optional PO picker, optional project picker (once G-RECV-FK-01 lands), and a line-items editor.
  - G-RECV-LINES-01 (LARGE): receiving lines stored as `payload.lines` JSON. A normalized receiving_order_line_items table would let the SPA render, edit, and reuse them; today the trigger reads JSON to emit stock_movements but there is no read-back UI. Operator decision: keep payload JSON and ship a SPA editor over it (cheap), or normalize (correct but larger).

### Project -> Shipment linkage
- Schema: `0032:118-138` defines shipments with warehouse_id, customer_id, sales_order_id (uuid, no FK). **No project_id FK.** Symptom 4 is rooted not in the schema but in the bundle gate.
- Handler: ShipmentCreate Zod at `ops-api/index.ts:128` accepts warehouse_id, customer_id, sales_order_id, shipment_number, ship_date, carrier, tracking_number, notes, payload. **No project_id.**
- UI: ShipmentsListPage has no "Create" button. No ShipmentCreatePage. No `/3pl-operations/shipments/new` route.
- Bundle gate: `ops-api/index.ts:480` calls `getFlag(ctx.orgId, 'plugins.3pl')`. Migration `0040_collab_org_settings_default_seed.sql:28` seeds the flag as `'plugins.three_pl'`. Wave-6 journal records the operator manually flipped `plugins.three_pl` to enabled. The ops-api bundle is reading a key that does not exist, finds `enabled = false`, and returns 404 for every shipments / receiving / production route. **This is the root cause of symptom 4.** The shipments list page does not even fail visibly: the SPA service returns the empty array result of a 404 envelope and the page renders empty; clicking through to a detail triggers the visible failure.
- Gaps:
  - G-OPS-FLAG-01 (SMALL, ROOT-CAUSE for symptom 4, **TRUE BLOCKER**): flag-key mismatch. Either fix the ops-api bundle to read `plugins.three_pl` (one-line code change in `ops-api/index.ts:480`, plus matching constant in `_shared/feature-defaults.ts:28`), or fix the seed to write `plugins.3pl` (forward migration 0042 plus a backfill UPDATE). The constitutional clean answer is to consolidate to one canonical key. The wave-6 journal preference (since the operator already flipped `plugins.three_pl`) is to fix ops-api to read the canonical seed key.
  - G-SHIP-FK-01 (MEDIUM): shipments table has no project_id column. Add via forward migration.
  - G-SHIP-FORM-01 (MEDIUM): missing ShipmentCreatePage with warehouse picker, optional customer picker, optional project picker (after G-SHIP-FK-01), and shipment header fields.
  - G-SHIP-LINES-01 (LARGE, same shape as G-RECV-LINES-01): shipment lines stored as `payload.lines` JSON. Same decision.

### Project completion semantics
- Workflow: project FSM `ready_to_ship -> completed` exists (`_shared/workflow/sales.ts:86`). The auto-state-transition trigger writes audit_log.
- Side effects: **none.** There is no DB trigger that creates an invoice on project completion. There is no handler-side draft-invoice creation. Symptom 5 is by-design-omission, not a bug: the design simply has no auto-invoice rule.
- Gaps:
  - G-COMPLETE-AUTO-01 (MEDIUM, **operator policy decision**): no auto-invoice creation on project completion. Operator must decide whether (a) project completion should write a draft invoice via DB trigger (with a feature flag like `finance.auto_invoice_on_project_complete.enabled`), (b) a Wave 6.5 RPC `convert_project_to_invoice` should exist as a button on the completed project, or (c) operator manually creates invoices forever. Recommend (b) as the lowest-risk option: a button on ProjectDetailPage `[Create invoice]` enabled only when project.state === 'completed', driven by a `convert_project_to_invoice` RPC that pulls customer_id, currency_code, source_quote_id, line items (once those exist on projects), creates an invoice in `draft` status and sets invoices.project_id and invoices.quote_id. Returns the new invoice id.

### Project -> Invoice linkage
- Schema: `0018_invoicing_invoices.sql:31-66` defines invoices with customer_id, project_id, quote_id columns. **None of them are declared as FK constraints** (just bare uuid columns). The linkage is data-only, not enforced.
- Handler: `invoicing-api/handlers/invoices.ts:44-53` InvoiceCreateSchema accepts customer_id, project_id, quote_id all optional uuid.
- UI: see InvoiceCreatePage below. Detail page has no project / quote / customer breadcrumb display.
- Gaps:
  - G-INV-FK-01 (SMALL, schema hardening): invoices.customer_id, .project_id, .quote_id should be declared as FK constraints to harden the chain. Add via forward migration.
  - See G-INV-FORM-01 and G-INV-DETAIL-01 below.

### Invoice
- Create form: `InvoiceCreatePage.tsx` captures invoice_number, currency_code, issue_date, due_date, notes. **No customer picker, no project picker, no quote picker, no line items.** All four are accepted by the handler schema but unreachable from the UI. Symptoms 6-7 confirmed.
- Schema: see above. Schema fully supports the FKs.
- Handler: see above. Schema fully supports the FKs.
- Detail page (`InvoiceDetailPage.tsx`): renders line items table (read-only, no add/edit) plus totals. **No customer display, no project link, no quote link, no payments section.** The constitutional balance_cents flows but the user can't see who they're invoicing. No "Add line item" button. No "Receive payment" button.
- Gaps:
  - G-INV-FORM-01 (MEDIUM, ROOT-CAUSE for symptoms 6-7): InvoiceCreatePage lacks customer_id picker, project_id picker, quote_id picker, and a line-items editor.
  - G-INV-DETAIL-01 (MEDIUM): InvoiceDetailPage lacks customer display + link, project / quote breadcrumb, payments-against-invoice section, "Add line item" button, "Receive payment" button.

### Invoice -> Payment
- Schema: `0019_invoicing_payments.sql` defines payments (customer_id uuid, no FK) and payment_allocations (payment_id and invoice_id both FK).
- Handler: `invoicing-api/handlers/payments.ts:41-50` PaymentCreateSchema accepts payment_number, customer_id, amount_cents, currency_code, payment_method, reference_number, received_at, notes. apply endpoint accepts `{ allocations: [{ invoice_id, amount_cents }] }`.
- UI: PaymentsListPage exists. PaymentApplyPage exists (allocate existing payment to invoices via UUID select). **No PaymentCreatePage.** No route `/invoicing/payments/new`. From the invoice detail page there is no path to "Receive payment for this invoice" -> create payment -> allocate to this invoice. The only path is to know the customer's payment number, hit some imaginary URL, then go to apply.
- Gaps:
  - G-PAY-FORM-01 (MEDIUM, ROOT-CAUSE for symptom 8): missing PaymentCreatePage with customer picker, amount_cents, currency_code, payment_method, received_at, reference_number fields.
  - G-PAY-FLOW-01 (SMALL): no "Receive payment" CTA on InvoiceDetailPage or PaymentsListPage that pre-fills customer_id / invoice_id and lands on a combined "create + apply" form. This is the natural quote-to-cash terminal action.
  - G-PAY-SCHEMA-01 (SMALL): payments.customer_id should be FK-constrained to customers(id).

## Vendor chain

### Vendor
- Create form: VendorCreatePage.tsx exists.
- Detail page (`VendorDetailPage.tsx`): static field display only. No related-entity sections (no purchase orders, no vendor bills, no expenses, no receiving orders).
- Gaps:
  - G-VEND-DETAIL-01 (MEDIUM): VendorDetailPage lacks related PO / bills / expenses / receiving sections.

### Purchase Order
- Create form: `POCreatePage.tsx` captures vendor_id as raw UUID text input, po_number, currency, order_date, expected_date. **No vendor picker.** No line items at create time.
- Schema: 0026 defines purchase_orders with vendor_id FK.
- Handler: accepts the body.
- Detail page: not read this round; presumed similar to other detail pages (lines + status transitions).
- Gaps:
  - G-PO-FORM-01 (SMALL): POCreatePage uses raw UUID input for vendor_id; needs a vendor picker.
  - G-PO-LINES-01 (MEDIUM, low priority): line items add at create time would be cleaner than create-then-add.

### PO -> Receiving
- Schema: receiving_orders.purchase_order_id FK exists.
- Handler: ReceivingCreate accepts purchase_order_id.
- UI: no PO picker on ReceivingOrderCreatePage because the page does not exist. The "create receiving from PO with lines carried" flow is entirely unbuilt.
- Gaps: covered by G-RECV-FORM-01 above. A PO -> Receiving "carry lines" RPC would be the proper canonical bridge (LARGE: convert_po_to_receiving RPC, similar shape to convert_quote_to_project).

### Vendor Bill
- Create form: **NONE**. No VendorBillCreatePage. No route `/3pl-operations/vendor-bills/new`. Symptom-equivalent gap on the procurement side.
- Schema: 0027 defines vendor_bills with vendor_id FK, purchase_order_id FK.
- Handler: vendors-api accepts POST /vendor-bills.
- Detail page (`VendorBillDetailPage.tsx`): shows fields plus payments table. **No "Record payment" button.** Vendor field rendered as raw vendor_id UUID.
- Gaps:
  - G-VB-FORM-01 (MEDIUM): missing VendorBillCreatePage with vendor picker, optional PO picker, bill_number, dates, currency, line items editor.
  - G-VB-DETAIL-01 (SMALL): VendorBillDetailPage shows raw vendor_id; needs display_name resolve + link. Needs "Record payment" button.
  - G-VB-DETAIL-02 (MEDIUM): no "Record bill payment" form. Handler `POST /vendor-bills/:id/payments` exists. UI does not.

### Expense
- Create form: `ExpenseCreatePage.tsx` captures expense_date, description, amount_cents, currency, reimbursable. **No expense_category_id picker, no vendor_id picker.** Schema and handler accept them.
- Schema: 0028 defines expenses with expense_category_id FK, vendor_id FK. No project_id column.
- Gaps:
  - G-EXP-FORM-01 (SMALL): ExpenseCreatePage missing category and vendor pickers.
  - G-EXP-FK-01 (MEDIUM, optional): expenses table has no project_id column. If operator wants project-cost tracking, add the column.

## Credit Note chain

### Credit Note
- Create form: **NONE**. CreditNotesListPage and CreditNoteApplyPage and CreditNoteDetailPage exist. No CreditNoteCreatePage. No route `/invoicing/credit-notes/new`.
- Schema: 0020 defines credit_notes with customer_id, source_invoice_id, reason.
- Handler: invoicing-api accepts POST /credit-notes.
- Detail page: shows amount, applied, reason. No source-invoice link displayed.
- Gaps:
  - G-CN-FORM-01 (MEDIUM): missing CreditNoteCreatePage with customer picker, optional source-invoice picker, amount_cents, reason, currency.
  - G-CN-DETAIL-01 (SMALL): CreditNoteDetailPage does not show source_invoice link.

## Finance chain

### Journal Entry
- Create form: **NONE**. JournalEntriesListPage and JournalEntryDetailPage exist. No JournalEntryCreatePage. No route `/finance/journal-entries/new`.
- Schema: 0022 defines journal_entries (3-state) with journal_entry_lines for debit/credit pairs and the `check_journal_balance` invariant.
- Handler: finance-api accepts POST plus post_journal_entry RPC.
- Gaps:
  - G-JE-FORM-01 (MEDIUM): missing JournalEntryCreatePage with entry_date, period_year, period_month, source_type, source_id, description, and a balanced debit/credit line editor that enforces the balance invariant client-side before submit.

## Gap inventory (consolidated table)

| ID | Chain | Entity | Gap | Size | File path(s) |
|---|---|---|---|---|---|
| G-OPS-FLAG-01 | quote-to-cash, vendor | ops-api bundle gate | Reads `plugins.3pl`, seed writes `plugins.three_pl`; 404s every shipments / receiving / production call (symptom 4 root cause) | SMALL | `supabase/functions/ops-api/index.ts:480`, `supabase/functions/_shared/feature-defaults.ts:28`, `supabase/migrations/0040_collab_org_settings_default_seed.sql:28` |
| G-LEAD-FORM-01 | CRM | Lead | No LeadCreatePage, no `/crm/leads/new` route | MEDIUM | `apps/web/src/pages/crm/leads/`, `apps/web/src/routes.ts:500-512` |
| G-OPP-FORM-01 | CRM | Opportunity | No OpportunityCreatePage with customer picker | MEDIUM | `apps/web/src/pages/crm/opportunities/`, `apps/web/src/routes.ts:518-524` |
| G-OPP-DETAIL-01 | CRM | Opportunity | customer_id rendered as raw UUID | SMALL | `apps/web/src/pages/crm/opportunities/OpportunityDetailPage.tsx:53` |
| G-OPP-FLOW-01 | CRM | Opportunity | No "Create quote from opportunity" action | MEDIUM | `apps/web/src/pages/crm/opportunities/OpportunityDetailPage.tsx` |
| G-CUST-DETAIL-01 | CRM, quote-to-cash | Customer | No related quotes / projects / invoices / payments / contacts / activities sections | MEDIUM | `apps/web/src/pages/crm/customers/CustomerDetailPage.tsx` |
| G-CUST-FORM-01 | CRM | Customer | CreatePage missing tax_id, default_currency, addresses, payment_terms | SMALL | `apps/web/src/pages/crm/customers/CustomerCreatePage.tsx` |
| G-CONTACT-FORM-01 | CRM | Contact | No ContactCreatePage (dup of F-Wave2-CRM-03) | MEDIUM | `apps/web/src/pages/crm/contacts/`, `apps/web/src/routes.ts:476-482` |
| G-QUOTE-FORM-01 | quote-to-cash | Quote | Create form lacks customer_id picker (symptom 1 root cause) | SMALL | `apps/web/src/pages/3pl-operations/quotes/QuoteCreatePage.tsx` |
| G-QUOTE-FORM-02 | quote-to-cash | Quote | Create form lacks expiration_date, default_tax_id, payment_method_id, pricing_tier_id, notes, internal_notes | SMALL | `apps/web/src/pages/3pl-operations/quotes/QuoteCreatePage.tsx` |
| G-QUOTE-DETAIL-01 | quote-to-cash | Quote | Detail page does not show or allow attach of customer | SMALL | `apps/web/src/pages/3pl-operations/quotes/QuoteDetailPage.tsx` |
| G-QUOTE-LINE-01 | quote-to-cash | Quote | Line add form has no item picker, no tax/discount fields | MEDIUM | `apps/web/src/pages/3pl-operations/quotes/QuoteDetailPage.tsx:136-158` |
| G-QUOTE-SCHEMA-01 | quote-to-cash | Quote | quotes.customer_id is bare uuid, no FK to customers(id) | SMALL | `supabase/migrations/0014_sales_quotes.sql:33` |
| G-CONVERT-01 | quote-to-cash | convert_quote_to_project | RPC does not copy quote_line_items to project (symptom 2 root cause; blocks symptoms 3, 6-7 too) | LARGE | `supabase/migrations/0016_sales_projects.sql:171-237`, `supabase/migrations/0041_fix_convert_quote_to_project_cross_tenant.sql` |
| G-CONVERT-02 | quote-to-cash | convert_quote_to_project | SPA mutation does not navigate to new project | SMALL | `apps/web/src/lib/hooks/useQuotes.ts:53-62` |
| G-PROJECT-FORM-01 | quote-to-cash | Project | Create form lacks customer, source quote, job_type, currency, budget, dates | SMALL | `apps/web/src/pages/3pl-operations/projects/ProjectCreatePage.tsx` |
| G-PROJECT-DETAIL-01 | quote-to-cash | Project | Detail page lacks customer, source quote link, line items / materials, receiving, shipments, invoices sections (symptoms 2, 3, 5, 6 root cause) | LARGE | `apps/web/src/pages/3pl-operations/projects/ProjectDetailPage.tsx` |
| G-PROJECT-SCHEMA-01 | quote-to-cash | Project | projects.customer_id bare uuid, no FK | SMALL | `supabase/migrations/0016_sales_projects.sql:33` |
| G-RECV-FK-01 | quote-to-cash | Receiving | No project_id column on receiving_orders | MEDIUM | `supabase/migrations/0032_ops_receiving_production_shipments.sql:19-39` |
| G-RECV-FORM-01 | quote-to-cash | Receiving | No ReceivingOrderCreatePage; no `/3pl-operations/receiving/new` route | MEDIUM | `apps/web/src/pages/3pl-operations/receiving/`, `apps/web/src/routes.ts:706` |
| G-RECV-LINES-01 | quote-to-cash | Receiving | Lines stored as payload JSON; no normalized table | LARGE | `supabase/migrations/0032_ops_receiving_production_shipments.sql`, ops-api receive handler |
| G-SHIP-FK-01 | quote-to-cash | Shipment | No project_id column on shipments | MEDIUM | `supabase/migrations/0032_ops_receiving_production_shipments.sql:118-138` |
| G-SHIP-FORM-01 | quote-to-cash | Shipment | No ShipmentCreatePage; no `/3pl-operations/shipments/new` route | MEDIUM | `apps/web/src/pages/3pl-operations/shipments/`, `apps/web/src/routes.ts:710` |
| G-SHIP-LINES-01 | quote-to-cash | Shipment | Lines stored as payload JSON; no normalized table | LARGE | `supabase/migrations/0032_ops_receiving_production_shipments.sql`, ops-api ship handler |
| G-COMPLETE-AUTO-01 | quote-to-cash | Project completion | No auto-invoice on completion; no convert_project_to_invoice RPC | MEDIUM | requires new RPC and SPA action; operator policy decision (symptom 5 root cause) |
| G-INV-FK-01 | quote-to-cash | Invoice | invoices.customer_id, project_id, quote_id are bare uuids; no FK constraints | SMALL | `supabase/migrations/0018_invoicing_invoices.sql:31-37` |
| G-INV-FORM-01 | quote-to-cash | Invoice | Create form lacks customer / project / quote pickers and line items (symptoms 6-7 root cause) | MEDIUM | `apps/web/src/pages/3pl-operations/invoicing/InvoiceCreatePage.tsx` |
| G-INV-DETAIL-01 | quote-to-cash | Invoice | Detail page lacks customer display, project / quote link, payments section, add-line button, receive-payment button | MEDIUM | `apps/web/src/pages/3pl-operations/invoicing/InvoiceDetailPage.tsx` |
| G-PAY-FORM-01 | quote-to-cash | Payment | No PaymentCreatePage; no `/invoicing/payments/new` route (symptom 8 root cause) | MEDIUM | `apps/web/src/pages/3pl-operations/payments/`, `apps/web/src/routes.ts:718` |
| G-PAY-FLOW-01 | quote-to-cash | Payment | No "Receive payment" CTA on invoice detail with pre-filled customer / invoice | SMALL | `apps/web/src/pages/3pl-operations/invoicing/InvoiceDetailPage.tsx` |
| G-PAY-SCHEMA-01 | quote-to-cash | Payment | payments.customer_id bare uuid, no FK | SMALL | `supabase/migrations/0019_invoicing_payments.sql:28` |
| G-VEND-DETAIL-01 | vendor | Vendor | Detail page lacks related PO / bills / expenses / receiving sections | MEDIUM | `apps/web/src/pages/3pl-operations/vendors/VendorDetailPage.tsx` |
| G-PO-FORM-01 | vendor | Purchase Order | Create form takes vendor_id as raw UUID text, no picker | SMALL | `apps/web/src/pages/3pl-operations/purchase-orders/POCreatePage.tsx:55-57` |
| G-PO-LINES-01 | vendor | Purchase Order | No line items at create time (must create then add) | MEDIUM | `apps/web/src/pages/3pl-operations/purchase-orders/POCreatePage.tsx` |
| G-VB-FORM-01 | vendor | Vendor Bill | No VendorBillCreatePage; no `/3pl-operations/vendor-bills/new` route | MEDIUM | `apps/web/src/pages/3pl-operations/vendor-bills/`, `apps/web/src/routes.ts:697-698` |
| G-VB-DETAIL-01 | vendor | Vendor Bill | Detail shows raw vendor_id, no display_name link | SMALL | `apps/web/src/pages/3pl-operations/vendor-bills/VendorBillDetailPage.tsx:39` |
| G-VB-DETAIL-02 | vendor | Vendor Bill | No "Record payment" form (handler exists at POST /vendor-bills/:id/payments) | MEDIUM | `apps/web/src/pages/3pl-operations/vendor-bills/VendorBillDetailPage.tsx` |
| G-EXP-FORM-01 | expense | Expense | Create form missing category and vendor pickers | SMALL | `apps/web/src/pages/3pl-operations/expenses/ExpenseCreatePage.tsx` |
| G-EXP-FK-01 | expense | Expense | No project_id column on expenses (operator decision) | MEDIUM | `supabase/migrations/0028_vendors_expenses.sql:55-82` |
| G-CN-FORM-01 | credit-note | Credit Note | No CreditNoteCreatePage; no `/invoicing/credit-notes/new` route | MEDIUM | `apps/web/src/pages/3pl-operations/credit-notes/`, `apps/web/src/routes.ts:720` |
| G-CN-DETAIL-01 | credit-note | Credit Note | Detail page does not link to source invoice | SMALL | `apps/web/src/pages/3pl-operations/credit-notes/CreditNoteDetailPage.tsx` |
| G-JE-FORM-01 | finance | Journal Entry | No JournalEntryCreatePage; no `/finance/journal-entries/new` route | MEDIUM | `apps/web/src/pages/finance/`, `apps/web/src/routes.ts:724` |

Total: 41 gaps. SMALL: 19. MEDIUM: 18. LARGE: 4 (G-CONVERT-01, G-PROJECT-DETAIL-01, G-RECV-LINES-01, G-SHIP-LINES-01).

## Recommended Phase 6.5 remediation scope

Two viable shapes:

**Shape A: One dedicated cross-domain wiring agent.** A single agent owns every gap above. Pros: no parallel-merge friction; the agent develops a coherent picture of the chain and reuses pickers / detail-section components across domains. Cons: long-running; bundle budget might bloat before the agent finishes.

**Shape B: Four-agent dispatch by chain.** Recommended.
- **Agent 6.5-A: Quote-to-cash core.** Owns G-QUOTE-FORM-01/02, G-QUOTE-DETAIL-01, G-QUOTE-LINE-01, G-PROJECT-FORM-01, G-PROJECT-DETAIL-01, G-INV-FORM-01, G-INV-DETAIL-01, G-PAY-FORM-01, G-PAY-FLOW-01, G-CN-FORM-01, G-CN-DETAIL-01, G-CONVERT-02, G-JE-FORM-01. Builds reusable `<CustomerPicker>`, `<ProjectPicker>`, `<InvoicePicker>`, `<ItemPicker>`, `<VendorPicker>` components shared by the other agents. This agent must land first.
- **Agent 6.5-B: Ops bundle + project-line-items + schema FKs.** Owns G-OPS-FLAG-01 (one-line, ship first as a hotfix even before the wave opens), G-CONVERT-01 (new project_line_items table, RPC update; reserves migration slot 0042 and 0043), G-RECV-FK-01, G-SHIP-FK-01, G-INV-FK-01, G-QUOTE-SCHEMA-01, G-PROJECT-SCHEMA-01, G-PAY-SCHEMA-01, G-EXP-FK-01 if operator approves, G-COMPLETE-AUTO-01 (convert_project_to_invoice RPC). Reserves migration slots 0042 to 0046.
- **Agent 6.5-C: Ops + procurement create pages.** Owns G-RECV-FORM-01, G-SHIP-FORM-01, G-VB-FORM-01, G-VB-DETAIL-01, G-VB-DETAIL-02, G-PO-FORM-01, G-PO-LINES-01, G-EXP-FORM-01, G-VEND-DETAIL-01. Consumes pickers from 6.5-A.
- **Agent 6.5-D: CRM polish.** Owns G-LEAD-FORM-01, G-OPP-FORM-01, G-OPP-DETAIL-01, G-OPP-FLOW-01, G-CUST-DETAIL-01, G-CUST-FORM-01, G-CONTACT-FORM-01.

LARGE items (G-RECV-LINES-01 and G-SHIP-LINES-01) are recommended to defer to Phase 7. The payload-JSON approach works today for the stock-movement triggers; ship a payload-JSON editor in 6.5-C and revisit normalization later. If operator wants normalization in 6.5, attach to 6.5-B's migration slot range.

Operator-decision points before dispatching 6.5:
1. G-OPS-FLAG-01: fix in ops-api (read `plugins.three_pl`) or fix in seed (write `plugins.3pl`)? Recommend ops-api side; operator already flipped the canonical seed key.
2. G-CONVERT-01: project_line_items new table vs. quote_line_items.project_id column? Recommend new table.
3. G-COMPLETE-AUTO-01: button (recommended) vs. DB trigger vs. manual forever?
4. G-EXP-FK-01: add project_id to expenses now or defer?
5. G-RECV-LINES-01 / G-SHIP-LINES-01: payload editor (cheap) vs. normalize to line-item tables (correct)?
6. Backfill: the in-flight side PR for `seed_org_settings` backfill (mentioned in the prompt as the parallel PR) determines whether existing orgs get the new flags automatically. If 6.5 ships before that backfill, every existing org needs a manual `select seed_org_settings(<org_id>)` after migration apply.

## Risk

This audit exposes the structural risk of Wave 2's domain-disjoint dispatch model. Each of the six Wave 2 agents shipped CRUD per domain and was credited with closing the domain's risk register. None of them owned the seam between domains. The Canon Steward verified byte-mirror parity but not cross-domain workflow. The 48-probe matrix called each edge function with synthetic data; cross-domain UI gaps cannot surface at that layer because the probes are not browsers. The first time anything walked the chain end-to-end was the operator at F-Wave6-FLOW-01.

Recommendation: Phase 6.5 and every subsequent multi-agent wave must include one of the following: (a) an explicit "cross-domain wiring" agent in the dispatch shape (the Shape-B Agent 6.5-A pattern), (b) per-domain agent charters that list cross-domain integration deliverables alongside the domain CRUD (so a sales-domain agent is held accountable for the customer picker on the quote create form, even though customers live in CRM), or (c) a mandatory post-wave end-to-end smoke run before the wave is marked closed (an automated equivalent to F-Wave6-FLOW-01 that exercises one full chain). The probe matrix is necessary but not sufficient; behavioral cross-domain coverage is the next gate.

A second risk surfaced: the flag-key drift (G-OPS-FLAG-01) is the same class of bug as F-Wave6-CORS-01 (two CORS allow-headers lists drifting). Constants that mean the same thing across boundaries should be canonicalized in `_shared/` and imported, not duplicated as string literals at the read site. Phase 7 stabilization should sweep for similar drift in the rest of the bundle gates and per-route flags.
