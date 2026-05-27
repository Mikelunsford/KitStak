# Portal UX polish bundle (2026-05-27)

Wave: F-Wave9 carry-over.
Scope: customer-portal UX polish surfaced by the 2026-05-26 prod smoke walk.
Operator-visible posture: prod customer-portal chassis was correct but ugly.
This PR makes it shippable for paying customers.

## Risks closed (4)

1. **F-Wave9-PORTAL-NAV-01** — section nav.
   The standalone `/portal/invoices`, `/portal/quotes`, `/portal/projects`
   pages existed but were unreachable from the SPA. Added a
   `PortalTopbar` component that renders the persistent
   `Dashboard | Invoices | Quotes | Projects` nav plus Sign out, with
   the active route emphasised by an accent underline. Mounted at the
   top of all four portal pages. The dashboard's three section headers
   (INVOICES, QUOTES, PROJECTS) are now `<Link>` components that drill
   into the dedicated list, and each section table now has a
   "View all ..." anchor underneath pointing at the same list page.
   The dashboard tables are capped at 5 rows so the dashboard remains
   a landing summary rather than a duplicate of the standalone list.

2. **F-Wave9-PORTAL-NULL-PLACEHOLDER-01** — empty dates rendered as ".".
   Root cause: `formatDateMedium(null)` returned the literal string
   `"."` in `apps/web/src/lib/dates.ts`, which read as stray
   punctuation in the portal data tables (the operator-side smoke
   walk specifically caught the Quote 1414141 Issued column rendering
   as a single dot). Replaced the marker with the centered dot
   `·` (U+00B7) via the new exported constant `NULL_DATE_PLACEHOLDER`.
   Both `formatDateMedium` and `formatDateShort` use the constant.
   The choice of `·` over `—` was forced by the Kitstak constitution
   (em dashes banned on disk); the centered dot reads as "empty" in
   tabular layouts without looking like an accidental period.

3. **F-Wave9-PORTAL-STATUS-LABEL-HUMANIZE-01** — raw enums leaked to customers.
   `StatusBadge` previously fell back to `status[0].toUpperCase() +
   status[1..]` for any unmapped status, which leaked
   `Project_pending` (and the lowercase variant `project_pending`) to
   the customer. Rewrote with a full `LABEL_MAP` covering every status
   the four portal endpoints can emit today plus a sensible defensive
   fallback (lowercase, strip underscores, sentence-case). New exports
   `humaniseStatus` and `statusColorClass` so the unit test can lock
   the contract without going through the React render path. Notable
   customer-facing label: `project_pending` -> `Converted to project`
   (clearer for a non-technical reader than the raw state-machine
   value). Lookup is case-insensitive so a stray Pascal-snake-case
   row in the database still renders as the humanised label.

4. **F-Wave9-PORTAL-NO-ACTION-WIRING-01** (partial: PDF download only).
   Two new portal-api endpoints — `GET /portal/invoices/:id` and
   `GET /portal/quotes/:id` — return the invoice / quote header, full
   line item list, and customer display name. Both are Pattern B
   scoped: the existing portal `gatePortal` plus per-route
   `.eq('customer_id', customerId)` constraint means a cross-customer
   id returns 404 (not 403), and a staff-role caller hits the bundle's
   404 (not the row 404), so existence is hidden both ways. The SPA
   has two new components (`PortalInvoiceActions`,
   `PortalQuoteActions`) that fetch the detail endpoint, then call
   the existing `/pdf-worker/pdf/render` with the trusted data.
   `customer_user` already holds the `pdf.document.render` cap (see
   `_shared/capabilities.ts:1130`); no role-grant change was required.

## Follow-ups spawned (2)

- **F-Wave9-PORTAL-DETAIL-VIEWS-01** — row click into per-entity detail
  view for invoices, quotes, projects. Detail views are a bigger lift
  than this round can absorb. Tracks the work to add
  `/portal/invoices/:id`, `/portal/quotes/:id`, `/portal/projects/:id`
  SPA routes that render the header plus line items.
- **F-Wave9-PORTAL-PAY-INVOICE-01** — "Pay invoice" button per
  invoice row. Blocked on Stripe wiring which has not landed yet.
  Tracks the work to add a Stripe Checkout session + payment-intent
  return webhook + portal `/portal/invoices/:id/pay` handler.

## Constitutional invariants verified

- **No em dashes, no double hyphens, no emojis** in any added file
  (rules in `_shared/responses.ts` and `apps/web/src/...`). The
  `NULL_DATE_PLACEHOLDER` is `·` (U+00B7), not `—`.
- **Money rules** untouched. `formatCents` consumed from
  `apps/web/src/lib/money.ts`; cents arrive as integer or string per
  the wire contract; no floating-point introduced.
- **RLS Pattern B preserved**. New endpoints `GET /portal/invoices/:id`
  and `GET /portal/quotes/:id`:
    - 404 when the row exists but belongs to another customer.
    - 404 when the caller's role is not `customer_user`.
    - Verified by the four new regression cases in
      `customer-portal-api-list.test.ts`.
- **Idempotency**: every new endpoint is GET. No idempotency-key
  surface added; not required for read-only handlers.
- **Audit log**: no append-only contract violated. No writes added.
- **Capabilities**: zero new capability strings added. The
  `pdf.document.render` cap already lives in `CUSTOMER_PORTAL_CAPS`.
- **Zod canon**: contract test `pnpm test:contract` passes (parity
  between `_shared/types/cross_cutting.ts` and
  `apps/web/src/lib/types/cross_cutting.ts` intact — no new portal
  types were added to the shared canon; the new
  `PortalInvoiceDetailSchema` / `PortalQuoteDetailSchema` live in
  `portalService.ts` because they are SPA-only response shapes for
  the action wiring and never round-trip through a write handler).
- **Forward-only migrations**: zero migrations added. The PDF render
  flow needed no DDL; the data fetched is already in the existing
  invoices / quotes / customers / invoice_line_items / quote_line_items
  tables.
- **No new top-level dependency**.

## Tests added / extended

- `apps/web/src/lib/dates.test.ts` — null-handling cases for
  `formatDateMedium` and `formatDateShort`. Locks the new
  `NULL_DATE_PLACEHOLDER` constant against a regression where the
  formatter returns a literal period.
- `apps/web/src/pages/portal/components/StatusBadge.test.ts` —
  table-driven test over every status the portal can emit, asserting
  no underscores leak, no all-caps, no raw enum value passthrough.
  Plus explicit spot checks for the two prod smoke bugs
  (`project_pending` -> `Converted to project`, Pascal-snake-case
  variant maps to the same label).
- `apps/web/test/regression/customer-portal-api-list.test.ts` — six
  new cases covering the detail endpoints (own invoice 200, cross
  invoice 404, staff role 404; same three for quotes).

## Files touched

Edge functions:
- `supabase/functions/customer-portal-api/index.ts` (+ ~100 LoC for the
  two new GET-by-id routes and the route table append).

SPA:
- `apps/web/src/lib/dates.ts` — `NULL_DATE_PLACEHOLDER` constant +
  null/empty/invalid handling.
- `apps/web/src/pages/portal/components/StatusBadge.tsx` — rewrote
  the label fallback with `humaniseStatus` + `statusColorClass`.
- `apps/web/src/pages/portal/components/PortalTopbar.tsx` (new) —
  persistent portal nav.
- `apps/web/src/pages/portal/components/PortalInvoiceActions.tsx`
  (new) — Download PDF per invoice row.
- `apps/web/src/pages/portal/components/PortalQuoteActions.tsx`
  (new) — Download PDF per quote row.
- `apps/web/src/pages/portal/PortalDashboardPage.tsx` — wraps in
  `PortalTopbar`, section headers become Links, View-all anchors,
  caps tables at 5 rows, mounts `PortalInvoiceActions` and
  `PortalQuoteActions` in their respective tables.
- `apps/web/src/pages/portal/PortalInvoicesPage.tsx`,
  `PortalQuotesPage.tsx`,
  `PortalProjectsPage.tsx` — wrap in `PortalTopbar`; invoices and
  quotes pages also mount the new action components.
- `apps/web/src/lib/services/portalService.ts` — `getPortalInvoice`
  and `getPortalQuote` plus Zod schemas for the detail payloads.

Tests:
- `apps/web/src/lib/dates.test.ts` — null cases.
- `apps/web/src/pages/portal/components/StatusBadge.test.ts` (new) —
  status humaniser.
- `apps/web/test/regression/customer-portal-api-list.test.ts` —
  detail-endpoint cases.

## Verification chain

- `pnpm test:contract` — 20 tests pass. Zod canon parity intact.
- `pnpm --filter web test` — 546 unit + 270 regression = 816 tests
  pass, 2 skipped (pre-existing skips unrelated to this PR).
- `pnpm --filter web lint` — clean.
- `pnpm --filter web build` — clean, TypeScript strict passes.
- `pnpm --filter web bundle-budget` — 30.98 kB gzipped main bundle,
  under the 40 kB limit. PortalTopbar lazy-loads into its own
  ~1.37 kB gzipped chunk.

## Operator-visible delta

What a customer sees after this PR merges and prod redeploys:

- A persistent top nav bar at the top of every `/portal/*` page so
  the four sections (Dashboard, Invoices, Quotes, Projects) are
  reachable from anywhere.
- Empty dates render as a discreet centered dot instead of a
  punctuation-typo period.
- Status pills read in plain language: "Paid", "Approved",
  "Converted to project", "In production" — never the raw enum.
- A "Download PDF" button on every invoice and quote row, both on
  the dashboard summary and on the standalone list page.
