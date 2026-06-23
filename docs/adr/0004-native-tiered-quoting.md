# ADR 0004: Native tiered quoting

Date: 2026-06-23
Status: Accepted (operator sign-off 2026-06-23; Option A)

## Context

The highest-volume account (Product Connections) quotes almost everything in
quantity-break tiers. Sam's Club is quoted at 10, 100, and 600 units; Heineken at
20, 40, 80, 100, and 120-plus. A tier is the same line set at a different break
quantity and per-unit price (volume pricing); the customer chooses a tier and
that tier becomes the order.

Duplicate quote (P1-3, migration 0129, shipped 2026-06-23) already covers most of
the workflow pain: from any quote, clone the header plus lines into a new draft
and edit only quantity and unit price for the next tier. That removes the
re-keying, but each tier is a separate quote document with its own number, and
the customer receives the tiers as separate PDFs. What the account actually
receives today, and what they want as one artifact, is a single document that
presents all quantity-break tiers together under one reference.

Duplicate is the deliberate first step. This ADR decides the model for the
follow-up: a tiered quote as one customer-facing document.

The quote chassis today: `quotes` is a single header with `subtotal_cents`,
`tax_cents`, `total_cents` recomputed from `quote_line_items` by
`recompute_quote_totals` (0017); lines carry `quantity_e3`, `unit_price_cents`,
`discount_bps`, and a per-line `tax_rate_snapshot`; `convert_quote_to_project`
(0094) copies the lines into `project_line_items`; the pdf-worker renders one
header plus one line table.

## Options considered

### Option A: tiers as first-class children of one quote (recommended)

A new `quote_tiers` table (child of `quotes`, Pattern B RLS via
`quotes.org_id`): `(id, quote_id, label, break_quantity, sort_order)`.
`quote_line_items` gains a nullable `tier_id` FK; a non-tiered quote leaves it
null (every existing row is unaffected, exactly as the WMS `location_id`
deepening leaves pre-WMS rows null in ADR 0002). Each tier owns its own copy of
the lines at that tier's quantities and prices, so totals move to the tier grain:
`recompute_quote_totals` rolls up per tier, and the quote header carries no single
total when tiers are present.

- One quote, one number, for the whole tiered document.
- Convert to project takes the accepted `tier_id` and copies that tier's lines.
- The PDF renders one header and a section per tier.

Cost: this touches the load-bearing quote chassis. `quote_line_items.tier_id`,
tier-grain totals, `recompute_quote_totals`, the convert RPC, and the PDF all
become tier-aware. It is a constitutional stop-point (money invariants and RLS on
the quote spine).

### Option B: a quote group over separate tier quotes (lighter)

A `quote_groups` table and a nullable `quotes.group_id`. Each tier stays a normal
quote (its own lines, totals, FSM, number) and the tiers share a `group_id`. The
single PDF and a "tier group" view join the quotes by group; convert picks the
accepted quote in the group and converts it normally.

- Minimal schema and zero change to the quote line/total/FSM/convert chassis: it
  builds directly on Duplicate, which already produces the tier quotes.
- Cost: N quote rows and N numbers per tiered document (list and numbering
  noise), and "one document" is a presentation-layer join rather than one entity.

### Option C: tier tags on line items, no new table (rejected)

Tag each `quote_line_items` row with a `tier_label` and group in the PDF. This
conflates lines with tiers and breaks the "lines sum to one total" model (each
tier is a separate total). Rejected.

## Decision

Adopt Option A: tiers as first-class children of one quote.

- Data model: `quote_tiers` (Pattern B RLS, parent-join on `quotes.org_id`, RLS
  in its creation migration) plus a nullable `quote_line_items.tier_id`. Tiers
  and lines are org-scoped through the parent quote; a non-tiered quote leaves
  `tier_id` null and behaves exactly as today.
- Totals: BIGINT cents and `roundHalfEven` are unchanged. `recompute_quote_totals`
  rolls up per tier; the header total is null (or the accepted tier's) when tiers
  are present. No floats, no SPA-computed authority.
- Numbering: one `Q-YYYY-NNNNN` for the document, allocated by the existing
  `next_doc_number` chassis. Tiers carry an in-document label
  (`break_quantity` / `label`), not a separate document number.
- PDF: the pdf-worker renders one header and a section (or column block) per
  tier, with each tier's subtotal and total. One file, all tiers.
- Convert to project: `convert_quote_to_project` gains a `tier_id` argument; the
  operator picks the accepted tier and only that tier's lines copy into
  `project_line_items`. A non-tiered quote passes null and converts as today.
- RLS, idempotency, and audit posture reuse the chassis exactly: RLS in the
  `quote_tiers` creation migration, forward-only idempotent migrations, the
  quote audit trigger unchanged.

This is recorded as Proposed. Option B remains the documented fallback if the
operator prefers a faster single-PDF win over the cleaner single-entity model;
the two are mutually exclusive and the choice is the operator's to ratify.

## Consequences

- This is a chassis-touching change to the load-bearing quote spine. The
  `quote_line_items.tier_id` migration and the tier-grain total rewrite are a
  stop-point: confirm with the operator before they land, and ship the
  money-invariant and RLS probe coverage in the same wave (the ADR 0002
  stock_movements precedent).
- The Zod canon (`_shared/types/sales.ts` and the SPA mirror) gains `QuoteTier`
  and a `tier_id` on the quote line shapes; both sides change in the same PR and
  `pnpm test:contract` gates the parity.
- `convert_quote_to_project` is redefined forward (a new `tier_id` argument,
  default null) and the quotes-api handler passes it; the regression follows the
  db-0094 / db-0129 SQL-content pattern plus an aborting-transaction staging
  check.
- The pdf-worker quote template gains a multi-tier layout. Exercise the rendered
  document once against a real tiered quote before release.
- Duplicate (P1-3) stays the answer for operators who want independent tier
  documents; native tiering is the answer for the single-document account. They
  coexist.
- No new top-level dependency. The build sequences after the P0/P1 quote-flow
  work already on prod.
