# Path B3 — Portal renders real customer data

**Date:** 2026-05-21
**Decision:** Path B3 closed. The customer-facing `/portal` is no longer a static "demo shell"; it renders a returning customer's actual invoices, quotes, and projects with formatted dates, branded status badges, currency-correct money formatting, and a prominent "you owe $X" balance summary at the top of the page.
**Driven by:** Operator dispatch after Path B2.5a (re-entry sign-in) verified live, per the `pillar-wiring-sequence` memory's A→C→B sequence.

## What changed

### Discovery during planning

The original Path B3 plan assumed I'd need to write the `customer-portal-api` integration from scratch. A pre-flight read of `apps/web/src/lib/hooks/useCrossCutting.ts` revealed the plumbing (`usePortalMe`, `usePortalInvoices`, `usePortalQuotes`, `usePortalProjects` TanStack Query hooks) and the four portal pages (Dashboard, Invoices, Quotes, Projects) already existed. The pages even rendered real data — but with raw cents (`balance_cents` shown as `7500.00`), raw ISO date strings, no error handling, plain-text status, broken links to nonexistent detail pages, no sign-out, and no answer-on-page-load balance signal.

B3 therefore became a **polish pass on existing plumbing** rather than a from-scratch build. The result is a much smaller, focused PR.

### `PortalDashboardPage` — full rebuild

Was: page title was just the customer name, balance was unsurfaced, three sections were a `<table>` for invoices + `<ul>` lists for quotes/projects, status was plain text, dates were raw ISO, cents had a local-only `centsToString` helper.

Now:
- **Header**: `Welcome, {customer.display_name}` + "Sign out" button (calls `signOut` from `AuthContext` then navigates to `/portal/signin`).
- **Balance banner** between the header and sections: when `invoices.isSuccess`, computes the sum of `balance_cents` across non-`paid`/non-`void` invoices and renders either "No outstanding balance." or "You owe **$X** across N open invoice[s]." in the brand accent color and display font. Answers the customer's #1 question on page load.
- **Three sections, all as proper tables**: Invoices (Number / Issued / Due / Status / Balance), Quotes (Number / Issued / Status / Total), Projects (Name / Started / Status / Est. completion).
- **Per-section states**: loading (text placeholder), `isError` (inline error message + "Retry" button calling `query.refetch()`), empty (warm copy: "No invoices yet. Your billing history will appear here." / "No quotes yet. Approved quotes that turn into projects will show up here." / "No projects yet. Active jobs will appear here once they kick off.").
- **Shared formatters**: dates via new `formatDateMedium` from `apps/web/src/lib/dates.ts` (Intl.DateTimeFormat, `en-US`, `Apr 15, 2026` shape). Cents via the canonical `formatCents` from `apps/web/src/lib/money.ts` with the row's `currency_code` — never the local `centsToString` helper that was previously here.
- **Removed**: the broken `<Link to="/portal/invoices/:id">` / quotes-detail / projects-detail links. Those routes do not exist; clicking them produced a 404. List rows are now plain cells. Detail-page work is filed as **B3.1** (defer, see "Spawns").

### `PortalInvoicesPage`, `PortalQuotesPage`, `PortalProjectsPage` — same polish

Standalone listings that previously rendered as `<ul>` lists with raw status text. Each rewritten to:
- Use the same table chassis + formatters as the dashboard section.
- Show loading / `isError` / empty / data states.
- Drop the broken detail-page links.

### `StatusBadge` component

New `apps/web/src/pages/portal/components/StatusBadge.tsx`. Small colored-dot + capitalised-label pill. Color map covers invoice (`draft`/`sent`/`paid`/`partial`/`overdue`/`void`), quote (`draft`/`sent`/`approved`/`declined`/`expired`/`converted`), and project (`lead`/`ready_to_build`/`in_production`/`ready_to_ship`/`completed`/`cancelled`) statuses. Unknown status values render a neutral grey dot + the raw string so the UI never goes blank on an unexpected enum value. No emoji, no stock UI library, no animation (per the brand and bundle rules).

### `formatDateMedium` / `formatDateShort`

New `apps/web/src/lib/dates.ts`. Two `Intl.DateTimeFormat` wrappers (`Apr 15, 2026` and `Apr 15`). Both return `"."` for null/undefined/invalid input so callers can drop the result inline without conditional rendering. Native Intl per the constitution's "no dayjs/date-fns/moment" rule.

### Backend regression test

New `apps/web/test/regression/customer-portal-api-list.test.ts` ships 9 assertions that lock down the Pattern B contract the SPA depends on:

1. `GET /portal/me` returns the customer envelope for a mapped `customer_user`.
2. `GET /portal/me` returns 404 when the membership has no `customer_id` mapping (not 500).
3. `GET /portal/invoices` returns ONLY the caller customer's invoices (the other customer's `INV-OTHER` in the same org is invisible — strongest tenant-isolation check).
4. `GET /portal/quotes` returns ONLY the caller customer's quotes.
5. `GET /portal/projects` returns ONLY the caller customer's projects.
6. `GET /portal/me` returns 404 for staff role (Pattern B existence-hide).
7. `GET /portal/invoices` returns 404 for staff role.
8. `GET /portal/quotes` returns 404 for staff role.
9. `GET /portal/projects` returns 404 for staff role.

These were not tested before B3 — the SPA was leaning on a contract that had no regression guard. Now it does.

## Verification

| Gate | Result |
|---|---|
| New B3 regression suite (9 tests) | All green |
| Full regression suite | 82 passed + 2 expected skips (was 73; +9 new B3 tests) |
| `pnpm test:contract` | 20/20 green |
| `vite build` | green at 26s |
| `size-limit` main bundle | 30.23 kB / 40 kB (was 30.21; +0.02 kB — Portal pages are lazy-chunked, so the main chunk only grew by the shared formatters' tree-shaken cost) |

## Constitutional invariants verified

| Invariant | Status |
|---|---|
| Money rules | All `total_cents` / `balance_cents` rendered via the canonical `formatCents(cents, currency_code)`. Currency comes from the row, never a hardcoded `'USD'`. Cents may arrive as `number` OR string-encoded; `formatCents` already handles both. |
| RLS Pattern B (404 hide-existence) | Locked down by 4 new regression assertions: staff calling any `/portal/*` route returns 404, not 403. |
| Cross-customer leak | Locked down by the strongest assertion: customer_user A from Org A cannot see customer B's invoices/quotes/projects in the same org. |
| Forward-only migrations | None touched. |
| Capabilities | Untouched. `portal.*.read` caps already granted to customer_user in migration 0007. |
| Audit log | Untouched. Reads do not audit-log. |
| Idempotency | Untouched. All B3 routes are GET. |
| Mirror parity / Zod canon | Untouched. Display schemas are inline interface types in the SPA, not mirror-paired. `test:contract` 20/20. |
| Branding rules | No em dashes / double hyphens / emojis in any user-facing string. Status pills are colored dots, not emoji. Date format is the safe `Apr 15, 2026` shape, no fancy separators. |
| Bundle gate | 30.23 kB / 40 kB main (was 30.21). Portal pages stay in their own lazy chunks. |

## Operator action remaining

None for B3 itself. The deploy is SPA-only (no `supabase/functions/` touched), so the Vercel deployment auto-rolls on push to main; no `deploy-functions` workflow trigger.

## Smoke test plan (post-merge + deploy)

1. **Operator session**: log in to Kitstak as staff. Confirm `/portal/*` routes still 404 (cap-gate intact).
2. **Customer session** (incognito):
   - Sign in via `/portal/signin` (Path B2.5a) → land at `/portal`.
   - Header shows `Welcome, Acme Co.` + Sign out button.
   - Balance banner shows real data:
     - If the customer has no open invoices: "No outstanding balance."
     - If the customer has open invoices: "You owe **$X** across N open invoice[s]."
   - Three sections render the customer's real rows in proper tables.
   - Status pills color correctly per status.
   - Dates render as `Apr 15, 2026`.
   - Cents format correctly per currency.
3. **Negative tests**:
   - Create a second customer in the same org with their own invoice. Sign back in as the first customer's portal user. Confirm the second customer's invoice does NOT appear (cross-customer leak gate).
   - Force-error a section: kill the network mid-load, click "Retry" → confirm the section re-fetches.
4. **Sign-out**: click "Sign out" → navigates to `/portal/signin`, session cleared.
5. **Standalone pages**: navigate to `/portal/invoices`, `/portal/quotes`, `/portal/projects` directly → confirm each renders the same table + states as the dashboard section.

## Closes

- **Path B3** — portal renders real customer data.

## Spawns

- **`F-Wave9-PORTAL-DETAIL-PAGES-01`** (Path B3.1): clickable rows that drill into per-invoice / per-quote / per-project detail pages. Requires new `customer-portal-api` routes (`GET /portal/invoices/:id`, etc.) that return line items + attachments. Defer until a paying customer asks for it. The list-only view in B3 is sufficient for "what do I owe?" / "what's the status?" which are the dominant questions.
- **`F-Wave9-PORTAL-PDF-DOWNLOAD-01`** (Path B3.2): download the PDF of an invoice or quote from the portal. The `pdf-worker` chassis already supports rendering; this needs the signed-URL story (or data-URL pass-through) and a download button. Coupled with B3.1 (lands on the detail page).
- **`F-Wave9-PORTAL-PAY-INVOICE-01`**: the "Pay" button on an invoice row in the portal. Belongs in Path B-Stripe (after Stripe wiring lands).
