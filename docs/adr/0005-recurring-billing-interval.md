# ADR 0005: Recurring billing interval for quote and invoice lines

Date: 2026-06-23
Status: Proposed

## Context

A real share of fulfillment revenue is recurring, not one-time. Storage is priced
per month ($32/mo per XL pallet). Several programs bill standing per-kit or
per-order rates (Premier $4.10/order). The quote and line model today is one-time
only: a line is `unit_price_cents` times `quantity`, billed once when the project
converts to an invoice (`convert_project_to_invoice`, 0127). Operators model
recurring revenue by writing a one-time line with "per month" in the name. The
number is therefore not tracked as recurring: it cannot be reported as MRR, and
it generates a single invoice instead of a monthly one.

This is distinct from the org's own Stripe subscription. `subscription_status`
(billing-api, the trial gate) governs whether the Kitstak *account* can use the
app. This ADR is about how a Kitstak operator bills *their customer*. The two
never mix.

A typical fulfillment quote mixes both: a one-time onboarding or setup fee plus a
monthly storage line plus per-order pick fees. So recurrence is a property of the
line, not the whole document.

## Options considered

### Where the interval lives

- On the line (recommended). `quote_line_items.billing_interval` (and the carried
  `project_line_items` / `invoice_line_items`), an enum defaulting to `one_time`.
  A quote can hold a one-time setup line and a monthly storage line side by side,
  which is the real shape of these quotes.
- On the quote (rejected). Forcing the whole document to be one-time or recurring
  cannot express the mixed quote, which is the common case.

### The interval values

- Start with `one_time` and `monthly` (a CHECK-constrained text enum, the
  `quote_line_items.kind` precedent). `monthly` is the only recurrence the
  examples need. `weekly`, `quarterly`, and `annually` are forward-additive enum
  values when a program needs them; the enum is extensible without a model
  change.

### How recurring invoices are generated

- A scheduled generator (recommended). For each active recurring line on won work
  (an accepted quote converted to a project), a monthly job creates that period's
  invoice for the line amount, idempotent per (line, period). The repo already
  runs scheduled DB work via pg_cron plus pg_net and Vault (the audit-chain and
  idempotency-GC sweeps), so the generator follows that pattern, not GitHub
  Actions cron.
- Manual-only (rejected as the end state). Leaving every monthly invoice to a
  hand keying is the status quo and the reason recurring revenue is invisible.

## Decision

Model recurrence on the line, in two phases.

Phase 1, the column (the foundation):

- Add `billing_interval` to `quote_line_items` as a CHECK-constrained text enum
  (`one_time`, `monthly`), default `one_time`. Carry it onto
  `project_line_items` (via `convert_quote_to_project`) and
  `invoice_line_items` (via `convert_project_to_invoice`), so a recurring line
  keeps its interval all the way to the invoice.
- Money invariants are unchanged: the per-period amount is the existing integer
  `line_total_cents`, banker's-rounded, currency snapshotted at issuance. A
  recurring line is the same cents math billed repeatedly, never a float and
  never an SPA-computed total.
- The Zod canon gains `billing_interval` on the line shapes; `_shared/types`
  and the SPA mirror change in the same PR and `pnpm test:contract` gates parity.
- This phase alone fixes the modeling and reporting gap: a $32/mo storage line is
  tagged `monthly` instead of hidden inside a one-time line name, so recurring
  revenue becomes queryable (MRR) even before any generator exists.

Phase 2, the generator (a dedicated engine wave):

- A recurring-invoice generator in invoicing-api, driven by pg_cron, that creates
  each period's invoice from the active recurring lines on won projects.
- A `recurring_schedules` (or equivalent) table to track per-line generation
  state: start date, next-run, end or cancellation, and the last period issued.
  RLS in its creation migration; idempotent per (line, period) so a re-run never
  double-bills. Proration, start and end dates, and cancellation are part of this
  wave, not Phase 1.

Recorded as Proposed. Phase 1 is the small, high-value start the operator can
ratify on its own; Phase 2 is the larger engine that should be specced and waved
after Phase 1 lands and the modeling is validated against a real recurring quote.

## Consequences

- Phase 1 changes the byte-identical Zod canon (the line shapes) and adds enum
  columns to `quote_line_items`, `project_line_items`, and `invoice_line_items`.
  That is a stop-point: the schema migration, the RLS posture (the columns ride
  the existing per-table policies, no policy change), and the mirror parity are
  confirmed with the operator before they land, with `test:contract` green in the
  same PR.
- Phase 2 introduces a new recurring-invoice surface in invoicing-api and a
  `recurring_schedules` table (RLS from its migration, audit trigger if it
  carries a state machine), plus a pg_cron generator. It is a real money engine
  and gets its own spec, wave, and stop-point review. Idempotency per period is a
  release blocker, not a nicety.
- This is customer billing and is deliberately separate from the org's own Stripe
  `subscription_status`. No code path couples the two; the one-price-book rule and
  the trial gate are untouched.
- No new top-level dependency. pg_cron, pg_net, and Vault are already in use.
