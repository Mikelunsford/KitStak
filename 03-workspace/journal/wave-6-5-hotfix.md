# Wave 6.5 Hotfix (PR #21)

Date: 2026-05-19
Branch: `claude/phase-6-5-hotfixes`
Status: Closed (merged at `3322db3`)
Trigger: Operator F-Wave6-FLOW-01 re-test against post-Wave-6.5 prod surfaced three SPA regressions in rapid succession.

## What broke

Operator opened a fresh `www.kitstak.com` session after Wave 6.5 (PR #20) merged and deploys completed, attempted the prod quote-to-cash exercise, and surfaced:

1. **Cannot convert quote to project.** Button click did nothing visible. No navigation, no error toast, no spinner.
2. **Project detail page broken.** The ErrorBoundary fallback rendered ("something is wrong" with a red refresh button) instead of the project detail.
3. **Cannot add opportunities.** OpportunitiesPipelinePage loaded but had no "New opportunity" button anywhere.

## Root causes

### Issue 1: convert silent

`apps/web/src/lib/hooks/useQuotes.ts` `useConvertQuoteToProject` mutation had only an `onSuccess` handler. Any error (STATE_CONFLICT if the source quote was not yet in `approved` state, NOT_FOUND on cross-tenant, network error, etc.) silently swallowed because no `onError` and no inline error display on QuoteDetailPage.

The most likely actual failure mode given the operator's exercise pattern was `STATE_CONFLICT: quote not in approved state (was sent)` from `convert_quote_to_project` RPC. The button renders when `canTransition(QUOTE_FSM, state, 'project_pending')` returns truthy, which the local FSM permits from `sent`, but the RPC requires `approved` per migration 0044.

### Issue 2: project detail crash

The real root cause. `apps/web/src/lib/hooks/useProjects.ts` shipped with two placeholder interfaces authored by Agent 6.5-A:

```typescript
// TODO 6.5-A: this placeholder shape covers project_line_items rows until
// Agent 6.5-B ships `ProjectLineItem` in `_shared/types/sales.ts` ... The
// Canon Steward pass replaces `ProjectLineItemPlaceholder` with the real
// schema's `z.infer<typeof ProjectLineItemSchema>` import.
export interface ProjectLineItemPlaceholder {
  ...
  quantity_e3: number | string;
  discount_bps: number;
  line_subtotal_cents: number | string;
  line_discount_cents: number | string;
  line_tax_cents: number | string;
  line_total_cents: number | string;
}
```

The placeholder fields were modeled on the **quote_line_items** schema (the one Agent 6.5-A had already worked with on QuoteDetailPage). 6.5-B's actual `ProjectLineItem` schema in `_shared/types/sales.ts` has different field names per migration 0044:

```typescript
export const ProjectLineItemSchema = z.object({
  ...
  quantity: z.union([z.number(), z.string()]),
  unit_price_cents: CentsSchema,
  discount_percent: z.union([z.number(), z.string()]),
  // No line_total_cents, no line_subtotal_cents, no precomputed totals
});
```

`ProjectDetailPage` used the placeholder field names. When the page tried to render real rows from the API, `l.line_total_cents` was `undefined`. `formatCents(undefined, currency)` throws `"Invalid cents value"` (the function's own input guard). React unwound to the global ErrorBoundary; "something is wrong" rendered.

**The Canon Steward consolidation pass missed the marker.** The Wave 6.5 PR opened with the placeholder still in place. The byte-mirror parity test passed because the placeholder lives in `apps/web/src/lib/hooks/`, not in a side-car canon file. Typecheck passed because the placeholder is a structurally consistent TS interface; the runtime mismatch surfaces only when real data hits it.

Bonus mismatch: `useConvertProjectToInvoice` return type was `{ id }` but the actual `projects-api POST /:id/convert-to-invoice` handler returns `created({ invoice_id: data })` per `supabase/functions/projects-api/index.ts:465`. The "Create invoice" button on a completed project would have navigated to `/invoicing/invoices/undefined`.

### Issue 3: missing list page CTAs

Agents 6.5-A, 6.5-C, and 6.5-D shipped 9 new create pages and registered 6 routes in `apps/web/src/routes.ts`. None of them patched the corresponding list pages to add navigation. The only Wave 2 list page that had a "New X" button was `VendorBillsListPage` (added in a Wave 2 hotfix). Operator landed on every other list page and saw no path forward.

The audit captured create-page existence as G-OPP-FORM-01, G-LEAD-FORM-01, etc. The audit did NOT capture operator-side reachability (the list-page CTA). Phase 6.5 closed the form-existence gaps and missed the discoverability gap.

## What shipped

11 files patched in one commit:

**Hook + page (Issue 2):**
- `apps/web/src/lib/hooks/useProjects.ts`: deleted `ProjectLineItemPlaceholder` + `CreateProjectLineItemBody` + `ConvertProjectToInvoiceResult.id` interfaces. Imports `ProjectLineItem`, `CreateProjectLineItemRequest` from `@/lib/types/sales`. `ConvertProjectToInvoiceResult` now `{ invoice_id }`.
- `apps/web/src/pages/3pl-operations/projects/ProjectDetailPage.tsx`: uses real field names (`l.quantity`, `l.unit_price_cents`, `l.discount_percent`); computes line subtotal client-side as `qty * unit * (1 - discount / 100)` rounded to cents; material-add form sends `quantity` plus required `discount_percent: 0`; convert-to-invoice click handler reads `result.invoice_id`.

**Mutation + page (Issue 1):**
- `apps/web/src/pages/3pl-operations/quotes/QuoteDetailPage.tsx`: convert button disables while `convert.isPending`, shows "Converting." label, renders `convert.error` inline below the action row when the mutation errors.

**List page CTAs (Issue 3):**
- 8 list pages get accent-styled Link CTAs in their header:
  - OpportunitiesPipelinePage -> `/crm/opportunities/new` "New opportunity"
  - LeadsKanbanPage -> `/crm/leads/new` "New lead"
  - ContactsListPage -> `/crm/contacts/new` "New contact" (carries `customer_id` query string when present)
  - ReceivingOrdersListPage -> `/3pl-operations/receiving/new` "New receiving order" (also fixes broken pre-existing "Refresh" link that pointed to `/3pl-operations/receiving`)
  - ShipmentsListPage -> `/3pl-operations/shipments/new` "New shipment"
  - PaymentsListPage -> `/3pl-operations/payments/new` "New payment"
  - CreditNotesListPage -> `/3pl-operations/credit-notes/new` "New credit note"
  - JournalEntriesListPage -> `/finance/journal-entries/new` "New journal entry"

## Constitutional invariants verified

- Singular `_shared/{types,workflow,capabilities,money}.ts` untouched.
- Byte-mirror parity intact across 22 pairs (`test:contract` 25 / 25).
- Schema and migrations untouched.
- All copy clean (no em dashes, no double hyphens, no emojis); lucide-react icons only; "New X" verb-noun shape on CTAs.
- TS1 read-only zone untouched.
- Bundle 28.9 kB / 40 kB (unchanged from Wave 6.5 close).

## Gates

| Gate | Result |
|---|---|
| `pnpm typecheck` | 0 errors |
| `pnpm lint` | 0 warnings, 0 errors |
| `pnpm test` | 5 / 5 |
| `pnpm test:contract` | 25 / 25 |
| `pnpm build` | clean, 6.74s |
| `pnpm bundle-budget` | 28.9 kB / 40 kB |

## Risks closed

- ProjectDetailPage runtime crash (Canon Steward miss).
- `useConvertQuoteToProject` silent-failure UX bug.
- 8 missing-CTA list pages.
- ReceivingOrdersListPage pre-existing broken "Refresh" link.

## Follow-ups spawned

- **`F-Wave7-CANON-STEWARD-01`**: pre-commit grep guardrail. Fail the diff if a `Placeholder` / `TODO 6.5-*` / `TODO Canon Steward` marker is introduced or left in code. The placeholder pattern (parallel agents stub each other's types so neither blocks) remains useful; the resolution step needs the guardrail.
- **`F-Wave7-MUTATION-ERRORS-01`** (proposed): sweep all mutations across the SPA for missing `onError` handlers. The convert-silent issue is likely not isolated; other mutations (approve, send, transition, etc.) may share the same UX gap.
- **`F-Wave7-LIST-CTA-AUDIT-01`** (proposed): expand the workflow integration audit pattern from "does the create page exist?" to "does an operator have a discoverable path to the create page?" Cross-domain reachability is its own audit dimension.

## Lessons

1. **Canon Steward consolidation needs a grep step.** "Verify byte-mirror parity" was on the checklist; "grep for unresolved placeholder markers" was not. The Wave 6.5 close was declared at byte-mirror green, but a placeholder in a non-canon file (a hook) carried through silently. The pre-commit guardrail in `F-Wave7-CANON-STEWARD-01` should sit at the orchestrator boundary, not the agent boundary, since agents are licensed to use the placeholder pattern.
2. **The audit framework needs to expand.** The Phase 6 workflow audit captured 41 gaps but missed the meta-gap that even if every create page exists, the operator cannot find them without a CTA from the list view. Future cross-domain audits should explicitly enumerate the discovery surface (list -> create, detail -> related-entity create, header CTA, sidebar entry).
3. **Mutation onError is a default, not an exception.** Every TanStack mutation that the operator can trigger should have either an inline error display (preferred) or a toast handler. The convert-mutation pattern bypassed this; sweep needed.

Phase 6.5 is now fully landed on prod. Only outstanding Phase 6 work is the operator re-running `F-Wave6-FLOW-01` against the deployed hotfix.
