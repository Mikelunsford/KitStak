# Sales API

Three edge function bundles cover the sales chassis.

## sales-config-api

Per-org configuration tables. Every non-GET requires `Idempotency-Key` (UUID v4) and an active org claim.

### taxes

- `GET /sales-config-api/taxes` returns `{ items, next_cursor }`.
- `POST /sales-config-api/taxes` creates a tax. `requireCap("taxes.tax.write")`.
- `PATCH /sales-config-api/taxes/:id` updates a tax.
- `DELETE /sales-config-api/taxes/:id` soft-deletes (`deleted_at = now`).
- `POST /sales-config-api/taxes/:id/set-default` calls the SECURITY DEFINER RPC `set_default_tax`. Atomic flip of the partial unique index `taxes_default_per_org_uq`.

Rates stored as `rate_bps` (integer basis points, max 100_000). 825 = 8.25%.

### payment_methods

Same shape as taxes; `set_default_payment_method` is the atomic-flip RPC.

### currencies + exchange_rates

- `GET /sales-config-api/currencies` returns the global ISO 4217 list. The `is_zero_decimal` flag mirrors the SPA `money.ts` `ZERO_DECIMAL_CURRENCIES` set.
- `GET /sales-config-api/exchange-rates` returns the rate table; rates stored as 1e9-scaled BIGINT.
- `POST /sales-config-api/exchange-rates` inserts a new rate.

### pricing_tiers + customer_pricing_overrides

Standard CRUD with `pricing_tiers.tier.write` / `pricing_tiers.override.write` capabilities.

### items + item_categories + units

Standard CRUD. `items` is the clean replacement for TS1's `pricing_menu` legacy. Money: `unit_price_cents`, `unit_cost_cents`, BIGINT. Currency: `currency_code` references `currencies(code)`.

### value_added_services + job_types

Standard CRUD. VAS `kind` is one of `flat | per_unit | hourly | tiered`. Money: `base_price_cents`.

## quotes-api

Quote document handling.

### CRUD

- `GET /quotes-api/quotes?state=<state>` paginated list.
- `GET /quotes-api/quotes/:id` returns `{ quote, line_items }`.
- `POST /quotes-api/quotes` create. Initial state `draft`.
- `PATCH /quotes-api/quotes/:id` update mutable header fields.
- `DELETE /quotes-api/quotes/:id` soft delete.

### Line items

- `POST /quotes-api/quotes/:id/line-items` add a line. Tax rate snapshot captured on insert.
- `DELETE /quotes-api/quotes/:id/line-items/:lineId` remove a line. Totals recomputed via `recompute_quote_totals(quote_id)`.

### State transitions

All transitions go through `respondWithIdempotency` and verify legality via the 6-state quote FSM declared in `_shared/workflow/sales.ts`.

- `POST /quotes-api/quotes/:id/submit` -> submitted (operator label: "Send for approval"; state pill: "Sent for approval")
- `POST /quotes-api/quotes/:id/approve` -> approved
- `POST /quotes-api/quotes/:id/revise` -> revise_requested
- `POST /quotes-api/quotes/:id/cancel` -> cancelled
- `POST /quotes-api/quotes/:id/send` updates `sent_at` (no state change; operator label: "Send to customer"). PDF email wiring lands when the pdf-worker is online.
- `POST /quotes-api/quotes/:id/convert-to-project` calls the SECURITY DEFINER RPC `convert_quote_to_project`. Transitions to `project_pending` and creates the project row in `pending`. The RPC also copies the quote's `job_type_id` (Wave 12 / A3, migration 0093) and `source_job_template_id` (Wave 12 / A4, migration 0094) onto the project, and freezes the source Job Builder template (header plus lines) into `projects.job_template_snapshot` so later template edits never rewrite a project's origin. Both ids are read from the in-org quote row, so the SECURITY DEFINER body cannot inject a foreign job type or template.

UI vocabulary: PR-6 (B7) renames the pre-approval button from "Submit" to "Send for approval" and the post-approval button from "Send" to "Send to customer". The DB enum value stays `submitted` (forward-only migration rule); the operator-facing label is rendered by `formatQuoteStateLabel(state)` on `QuoteDetailPage.tsx`.

A quote version snapshot is written automatically by the audit trigger on transitions into `submitted` and `approved`.

### Versions

- `GET /quotes-api/quotes/:id/versions` returns the version ledger ordered by `version_number desc`.

### PDF

- `GET /quotes-api/quotes/:id/pdf` returns `501 PDF_NOT_YET_AVAILABLE` until Agent F's `pdf-worker` is online.

### Approvals

- `POST /quotes-api/quotes/:id/approvals` request an approval.
- `PATCH /quotes-api/quotes/:id/approvals/:approvalId` decide an approval (`approved | rejected | cancelled`).

## projects-api

Production / fulfillment workspace.

### CRUD

- `GET /projects-api/projects`, `GET /projects-api/projects/:id`, `POST`, `PATCH`, `DELETE`.

### Phases

- `POST /projects-api/projects/:id/phases` append a phase. Server auto-assigns `position = max + 1` if not supplied.
- `PATCH /projects-api/projects/:id/phases/:phaseId`, `DELETE` same path.
- `POST /projects-api/projects/:id/phases/:phaseId/transition` 4-state FSM (`pending | active | completed | cancelled`).
- `PATCH /projects-api/projects/:id/phases/reorder` body `{ phase_ids: uuid[] }` rewrites positions in caller-supplied order.

### State transitions

`POST /projects-api/projects/:id/transition` with `{ to }` body. 6-state FSM.

## Error envelope

Every error response is `{ "error": { "code", "message", "details" } }` with an `x-request-id` header. Codes the sales bundles emit:

- `UNAUTHORIZED` (401) Authorization missing.
- `NO_ACTIVE_ORG` (401) Token has no org claim.
- `FORBIDDEN` (403) Capability denied OR cross-tenant RPC attempt.
- `NOT_FOUND` (404) Row not in caller's org.
- `STATE_CONFLICT` (409) Illegal transition.
- `IDEMPOTENCY_CONFLICT` (409) Same key, different body.
- `VALIDATION_ERROR` (422) Body failed Zod.
- `PDF_NOT_YET_AVAILABLE` (501) PDF stub.
