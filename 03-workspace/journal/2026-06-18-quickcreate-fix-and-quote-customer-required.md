# Inline quick-create repaired end to end; a quote now requires a customer

Date: 2026-06-18
CHANGELOG: `0.27.0`
PRs: #337, #338, #339 (all merged to prod)

## Scope

The operator reported that on the New Quote form, clicking "+ New customer", filling the name, and clicking "Save customer" did nothing: the customer was not created, not added to the quote, and not added to the customer list. He also asked to change the customer field from a dropdown to a search field with a "+ New Customer" button to the side, across all five quick-create pickers.

What surfaced was two structural bugs stacked on top of each other, plus a product gap (quotes could be created with no customer at all). All three are now closed.

## Bug 1: inline quick-create never persisted (PR #337)

Root cause: `Modal` rendered inline (no portal), so a quick-create modal's `<form>` ended up nested inside the host page's own `<form>` (for example `QuoteCreatePage`'s form). Nested `<form>` elements are invalid HTML; the browser breaks the inner form's `form="..."`-attribute submit association, so the modal's `onSubmit` never ran and `createCustomer` was never called. Confirmed against prod: zero customers had ever been created this way. The standalone `/crm/customers/new` page was unaffected (its form is not nested).

Fix: `Modal` now renders through `createPortal(..., document.body)`, guarded with a `typeof document === 'undefined'` check for the no-jsdom test environment. One change repaired quick-create for all five pickers (customer, item, vendor, project, channel) and every host create form (quote, invoice, project, payment, credit-note). `Modal` is used only by the five quick-create modals, so the change is contained.

UX (same PR): `EntityPicker` moved the create action from a row inside the listbox to a "+ New X" button beside the search field, added a leading search icon, and the five EntityPicker-based pickers now read "Search X." The native-select `QuotePicker` and `InvoicePicker` were left unchanged (relabeling them "search" would misrepresent the affordance). The pickers needed no structural change because the button is driven by the existing `allowCreate` / `createLabel` / `onCreate` props.

## Bug 2: quick-create also fired the host form (PR #338)

After the portal fix, saving a customer from the New Quote form created the customer AND an empty, customer-less quote, then navigated to it (the "Quote Q-... created" toast was the proof).

Root cause: portaling moves the modal out of the host `<form>` in the DOM, but React event propagation follows the component tree, not the DOM. The modal is still a React child of the host page (itself a `<form>`), so the modal's submit bubbled through the React tree to the host form's `onSubmit` and fired it. `customer_id` was still null at that instant, hence the empty quote.

Fix: `Modal` stops submit propagation at the dialog boundary (`onSubmit` to `stopPropagation`). The modal's own `onSubmit` has already run by the time the event reaches the dialog, so quick-create still creates and selects the record while the host form no longer fires. One central change covers all five pickers and every host form.

## Gap: quotes could be created with no customer (PR #339)

Even with the bug fixed, the New Quote form still allowed submitting with no customer (the picker was not required) and `quotes-api` accepted a null `customer_id` (it only validated the customer ref when one was present). That is how the customer-less draft quotes existed.

Fix: the New Quote customer picker is now `required`, and `quotes-api` createQuote rejects a missing or empty `customer_id` with a 422 before the insert. `CreateQuoteRequestSchema` stays nullable so the shared partial (PATCH) path is unaffected; the create handler is the single enforcement point. The patch handler keeps validating the customer ref only when provided. No byte-mirror canon change, no schema or migration change.

## Data cleanup

The two stray draft quotes the bug produced in the Kitstak org (`Q-2026-00009`, `Q-2026-00010`, both `draft`, null customer, $0, no lines) were hard-deleted via a guarded statement (by id, only if still a $0 draft with no customer and no line items). The four older customer-less quotes from earlier testing (May, plus a `Q-2099-99999`) were left in place; they predate this work.

## Verification

- Every PR cleared the full gate set locally before merge: typecheck, lint (max-warnings 0), 751 unit and regression tests, build, and bundle-budget. PR #339 also passed `deno check` on the changed `quotes-api` bundle.
- CI on all three PRs was green (build, CodeQL, both Analyze jobs, Vercel); each merged on green and the prod deploy was watched to completion.

## Constitutional invariants

- SPA presentation plus one edge validation guard. No schema, migration, RLS, money, idempotency, `audit_log`, capability, or byte-mirror contract change across the three PRs.
- No new dependency: `createPortal` is from the existing `react-dom`.
- The new 422 is a per-route validation error, distinct from the plugin-gate 404 and the feature-flag 403; it does not touch the cross-tenant 404 contract.

## Follow-ups

- No automated test covers the modal submit path: the repo runs Vitest without jsdom, so there is no render seam for form submission. The pure `entityPickerModel` tests remain green; the create and no-host-fire behavior was verified by the operator on prod.
- Pre-existing and unrelated: two scheduled crons are failing on main (`notifications-drain`, `audit-chain-verify`); flagged separately for a dedicated look.
