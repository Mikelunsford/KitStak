# Wave 6.5 · Workflow Integration Remediation

Date: 2026-05-18
Branch: `claude/phase-6-5-workflow-wiring`
Status: Closed (subject to PR merge)
Trigger: Phase 6 workflow integration audit at `03-workspace/journal/phase-6-workflow-integration-audit.md` identified 41 actionable cross-domain wiring gaps surfaced by the operator's `F-Wave6-FLOW-01` quote-to-cash exercise on prod.

## What shipped

39 of 41 audited gaps closed (the 2 LARGE line-normalization gaps `G-RECV-LINES-01` and `G-SHIP-LINES-01` deferred to Phase 7 per operator decision; payload-JSON editors ship in 6.5 as a workable interim).

### Schema (5 migrations, slots 0042 to 0046)

- `0042_backfill_org_settings.sql`. One-shot data backfill that calls `seed_org_settings()` for every org missing from `org_feature_flags`. Closes the gap left by orgs provisioned before migration 0040 shipped the seed function. Idempotent.
- `0043_provision_organization_calls_seed_org_settings.sql`. Redefines `provision_organization` so it calls `seed_org_settings(v_org_id)` after the status transition to `active`. Closes the forward path; future orgs self-heal.
- `0044_project_line_items.sql`. New `project_line_items` table with FKs to `projects` and optional `source_quote_line_item_id`. RLS Pattern A. Audit trigger. Capability set added to `_shared/capabilities/sales.ts` side-car. `convert_quote_to_project` RPC redefined to copy `quote_line_items` into `project_line_items` while preserving position and the `p_caller_org_id` signature from migration 0041 (closes `G-CONVERT-01`).
- `0045_convert_project_to_invoice.sql`. New `convert_project_to_invoice` RPC. SECURITY DEFINER. Validates project state in `{completed, shipped}` via SQLSTATE before creating the draft invoice. Carries customer_id / project_id / quote_id / currency from project. Copies `project_line_items` into `invoice_line_items` preserving position. Idempotent: returns existing draft invoice id if one already exists for the project. Exposed via `projects-api POST /projects/:id/convert-to-invoice`. Closes `G-COMPLETE-AUTO-01`.
- `0046_fk_hardening_sweep.sql`. ADD CONSTRAINT for 7 previously-bare FKs (`quotes.customer_id`, `projects.{customer_id,quote_id}`, `invoices.{customer_id,project_id,quote_id}`, `payments.customer_id`). Adds nullable `project_id` columns to `receiving_orders`, `shipments`, `expenses` (closes `G-RECV-FK-01`, `G-SHIP-FK-01`, `G-EXP-FK-01`). All wrapped in idempotent do-blocks.

### Side-car canon extensions (byte-mirrored pairs)

- `_shared/types/sales.ts` + `apps/web/src/lib/types/sales.ts`: +61 lines each. New schemas for `ProjectLineItemSchema`, `CreateProjectLineItemRequestSchema`, `UpdateProjectLineItemRequestSchema`, `ConvertProjectToInvoiceResponseSchema`.
- `_shared/capabilities/sales.ts` + `apps/web/src/lib/capabilities/sales.ts`: +12 lines each. New `project.line_item.{create,read,update,delete}` capabilities added to `SALES_CAPABILITIES_BY_ROLE`. All 8 roles seeded with appropriate access (org_owner / org_admin / sales: full; ops: read+update; accounting / viewer: read).

Canon Steward verification: all 22 byte-mirror pairs `diff -q` clean.

### Edge function

- `supabase/functions/projects-api/index.ts` (+150 lines). New routes:
  - `GET /projects/:id/line-items` (cap `project.line_item.read`)
  - `POST /projects/:id/line-items` (cap `project.line_item.create`, `Idempotency-Key` required)
  - `PATCH /projects/:id/line-items/:lineId` (cap `project.line_item.update`, `Idempotency-Key` required)
  - `DELETE /projects/:id/line-items/:lineId` (cap `project.line_item.delete`, `Idempotency-Key` required)
  - `POST /projects/:id/convert-to-invoice` (returns `{ invoice_id }`, `Idempotency-Key` required)
  All gated via the per-bundle `requireProjectCap` shim (D-011 pattern).

### SPA

**5 reusable pickers** at `apps/web/src/components/ui/pickers/`:
- `CustomerPicker.tsx`, `ProjectPicker.tsx`, `InvoicePicker.tsx`, `ItemPicker.tsx`, `VendorPicker.tsx`
- Shared contract: `{ value, onChange, label?, required?, disabled?, placeholder?, filter? }`
- TanStack Query with `staleTime: 30_000`, `refetchOnWindowFocus: false`, `retry: 1` per constitution
- Consumed by 6 create pages plus 3 detail pages

**9 new pages:**
- `apps/web/src/pages/3pl-operations/payments/PaymentCreatePage.tsx` (`G-PAY-FORM-01`)
- `apps/web/src/pages/3pl-operations/credit-notes/CreditNoteCreatePage.tsx` (`G-CN-FORM-01`)
- `apps/web/src/pages/3pl-operations/receiving/ReceivingOrderCreatePage.tsx` (`G-RECV-FORM-01`)
- `apps/web/src/pages/3pl-operations/shipments/ShipmentCreatePage.tsx` (`G-SHIP-FORM-01`)
- `apps/web/src/pages/3pl-operations/vendor-bills/VendorBillCreatePage.tsx` (`G-VB-FORM-01`)
- `apps/web/src/pages/crm/leads/LeadCreatePage.tsx` (`G-LEAD-FORM-01`)
- `apps/web/src/pages/crm/opportunities/OpportunityCreatePage.tsx` (`G-OPP-FORM-01`)
- `apps/web/src/pages/crm/contacts/ContactCreatePage.tsx` (`G-CONTACT-FORM-01`, also closes `F-Wave2-CRM-03`)
- `apps/web/src/pages/finance/JournalEntryCreatePage.tsx` (`G-JE-FORM-01`)

**14 patched pages:**
- Quote / Project / Invoice / PO / Expense / Vendor Bill / Customer / Opportunity / Credit Note detail and create pages all gained pickers, FK displays, related-entity sections, deep-link CTAs, or carry-through query-string handling.
- `ProjectDetailPage.tsx` was the LARGE rebuild (`G-PROJECT-DETAIL-01`): added customer + source quote display, line items / materials section with `ProjectLineItem` CRUD, related receiving / shipments / invoices sections, "Create invoice from project" button calling `convert_project_to_invoice` RPC.
- `VendorBillDetailPage.tsx` gained vendor display link (`G-VB-DETAIL-01`) plus "Record payment" form (`G-VB-DETAIL-02`).
- `CustomerDetailPage.tsx` gained 6 related-entity sections (Quotes / Projects / Invoices / Payments / Contacts / Activities), each with a "New X for this customer" CTA propagating `customer_id` via query string.

**Query-string carry-through wiring** (6 create pages): `QuoteCreatePage`, `ProjectCreatePage`, `InvoiceCreatePage`, `POCreatePage`, `ExpenseCreatePage`, plus the 3 new Stage-2 pages all read deep-link params (`customer_id`, `project_id`, `vendor_id`, `po_id`) from `useSearchParams()` on mount and prefill the appropriate picker.

**Routes registered** (6 paths) in `apps/web/src/routes.ts`, organized in 3 marker-bounded sections:
- `// === Agent 6.5-A: quote-to-cash routes ===`: payments/new, credit-notes/new, finance/journal-entries/new
- `// === Agent 6.5-C: ops + procurement routes ===`: receiving/new, shipments/new, vendor-bills/new
- `// === Agent 6.5-D: crm routes ===`: leads/new, opportunities/new, contacts/new

### Hooks

- `apps/web/src/lib/hooks/useProjects.ts` (+122 lines): `useProjectLineItems`, `useAddProjectLineItem`, `useRemoveProjectLineItem`, `useConvertProjectToInvoice`.
- `apps/web/src/lib/hooks/useQuotes.ts` (+10 lines): `useConvertQuoteToProject` mutation now navigates to the new project on success (`G-CONVERT-02`).

## Dispatch shape and what we learned about the multi-agent model

Phase 6.5 ran as Shape B from the audit: 4 specialized agents dispatched across 2 stages plus 2 finishers.

### Stage 1 (parallel, 2 agents)
- **Agent 6.5-A**: shared pickers + quote-to-cash UI. ~95% landed before a transient Anthropic API connection error after 84 tool uses.
- **Agent 6.5-B**: 5 migrations + side-car extensions + projects-api endpoints. ~95% landed before the same API error after 57 tool uses.

The simultaneous API error suggests an upstream blip rather than per-agent issues. Both agents' file writes were durable.

**Stage 1 finisher** picked up the worktree as-is, fixed 3 `exactOptionalPropertyTypes` typecheck drifts in the pickers (pitfall #5 from SESSION-CATALYST.md), shipped the 2 missing create pages (CreditNote, JournalEntry), patched CreditNoteDetailPage, and registered 3 routes. Returned green.

### Stage 2 (parallel, 2 agents)
- **Agent 6.5-C**: ops/procurement create pages and patches. Same API error after 80 tool uses. 3 new pages and 1 patch landed; 3 patches and 3 routes missed.
- **Agent 6.5-D**: CRM polish. Completed clean. All 7 CRM gaps closed.

**Stage 2 finisher** registered 6.5-C's missing routes, shipped the 3 missing patches (POCreatePage with line items, ExpenseCreatePage with pickers, VendorDetailPage with 4 related-entity sections), and wired query-string carry-through on 6 create pages (closes the deep-link contract from 6.5-D's "New X" CTAs). Returned green.

### Lessons codified

1. **Cross-domain wiring is not a free byproduct of disjoint-domain dispatch.** Wave 2's 6-agent model produced 6 working CRUD domains plus 0 cross-domain seams. Phase 6.5's Shape B explicitly chartered an agent for shared pickers (Agent 6.5-A) and a schema agent for cross-domain FK + RPC work (Agent 6.5-B), then dependent agents (C, D) for consuming UI. This is the model future multi-agent waves must use.
2. **Finishers as a first-class pattern.** When a Stage agent fails partway through (transient API issue, token budget, etc), a small follow-up finisher agent with the residual scope as its charter consistently closes the gap cleanly. The pattern: spawn finisher with the explicit list of missed deliverables and a tight gate; do not re-dispatch the full Stage agent.
3. **Picker contracts as shared API.** Stage 1 shipped 5 pickers with a documented props contract. Stages 2 and the finishers consumed those pickers across 12+ pages with zero coordination friction. The pattern (shared component in `components/ui/pickers/`, props contract documented in the dispatch prompt) generalizes to future shared-UI extraction.
4. **Same drift class as Wave 6 hotfix 2 (CORS allow-headers) re-surfaced in `G-OPS-FLAG-01` (ops-api flag key)**. The Phase 7 stabilization sweep should canonicalize string-literal constants that mean the same thing across boundaries: import from `_shared/` rather than duplicate.

## Risks closed

- 39 of 41 gaps from the workflow integration audit (full list in the gap inventory table at `03-workspace/journal/phase-6-workflow-integration-audit.md`).
- Backfill proposal (`F-Wave6-DATA-01` proposed) shipped as migration 0042 + 0043 combo per operator's Option A + B follow-up decision.

## Follow-ups spawned

- `F-Wave7-LINES-01` (proposed): normalize `receiving_order_line_items` and `shipment_line_items` to dedicated tables (G-RECV-LINES-01, G-SHIP-LINES-01 deferral). Today's payload-JSON editor works for the first operator but does not scale.
- `F-Wave7-LISTFILTER-01` (proposed): lift `customer_id` / `vendor_id` / `project_id` filters from client-side to server-side in the list services (currently CustomerDetailPage / VendorDetailPage filter client-side after pulling the full org list).
- `F-Wave7-CRM-SCHEMA-01` (proposed): extend `CreateCustomerRequestSchema` to include `default_payment_terms_days` (called out by audit, not in current side-car).
- `F-Wave7-EXPENSE-SCHEMA-01` (proposed): add `project_id` to `ExpenseSchema` side-car (column shipped in 0046 but Zod schema does not enumerate it; ExpenseCreatePage uses an explicit cast to send it).
- `F-Wave7-LITDRIFT-01` (proposed): sweep all bundle gates and per-route flags for string-literal drift (the `G-OPS-FLAG-01` and `F-Wave6-CORS-01` class of bug). Canonicalize as imported constants.

## Constitutional invariants verified

- Money rules: untouched. New `unit_price_cents`, `discount_percent`, `quantity` columns on `project_line_items` follow the cents-as-bigint discipline.
- RLS rules: `project_line_items` ships with RLS enabled and Pattern A policies from migration 0044. Cross-tenant `convert_project_to_invoice` follows the migration-0041 NOT_FOUND pattern.
- Migration rules: 5 forward-only migrations, all idempotent, all with constitutional headers.
- Zod canon: 4 byte-mirrored singular files untouched. 18 side-car pairs intact (parity test 25/25). Sales side-car extended for `ProjectLineItem` types and `project.line_item.*` caps.
- Idempotency: all new POST/PATCH/DELETE endpoints on `projects-api` require `Idempotency-Key`.
- Audit log: `project_line_items` ships with the auto-state-transition trigger pattern from `0044`.
- Capabilities: 4 new caps (`project.line_item.{create,read,update,delete}`) seeded across all 8 roles per the per-bundle shim pattern (D-011).
- Banned deps: none added.
- Brand discipline: zero violations on changed files. Display font for headings, Inter Tight body, lucide-react icons (no emoji), no em dashes, no double hyphens.
- TS1 read-only zone: untouched.

## Gates

| Gate | Result |
|---|---|
| `pnpm typecheck` | 0 errors |
| `pnpm lint` | 0 warnings, 0 errors (`--max-warnings 0`) |
| `pnpm test` | 5 / 5 |
| `pnpm test:contract` | 25 / 25 (parity intact across 22 pairs) |
| `pnpm build` | clean, 6.32s |
| `pnpm bundle-budget` | 29.25 kB / 40 kB |
| Canon Steward byte-mirror sweep | 18 / 18 pairs clean |
| Migration slot conflict check | 0042 to 0046 reserved; next slot is 0047 |

## What remains

- **`F-Wave6-FLOW-01`**: operator-led quote-to-cash exercise on prod (the original Phase 6 gate). Phase 6.5 closes the structural gaps that blocked the exercise; the actual end-to-end walkthrough is the verification step.
- Phase 7 stabilization scope per the follow-ups above.

Phase 6.5 gate met when this PR merges and the operator successfully exercises `F-Wave6-FLOW-01` on prod after the migrate + deploy-functions runs complete.
