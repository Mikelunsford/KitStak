# Sales

This guide covers the 3PL Operations sales chassis: items, taxes, currencies, payment methods, pricing tiers, value added services, quotes, and projects.

## Catalog

Set up your catalog before sending quotes.

1. Open Sales Config and confirm the default currency, tax, and payment method are correct.
2. Open Items, create your sellable items, and assign each one a category and a unit of measure.
3. Open VAS to register any value added services (kitting, labeling, photography) you bill for.

## Quotes

The quote lifecycle has six states: draft, submitted, revise requested, approved, project pending, cancelled.

1. Click New Quote, enter a quote number, title, and currency.
2. On the quote detail page, add line items. Each line snapshots the tax rate at insert time, so a later tax change never retroactively edits the line.
3. Submit moves the quote into review. Approve transitions to approved and writes a version snapshot.
4. Send marks the quote as sent. PDF email follows when the pdf-worker comes online.
5. Convert to project creates a project in pending and links the source quote.

If you spot an issue after submitting, use Request revise. The quote returns to revise_requested. You can rework it back to draft, then resubmit.

## Projects

Projects own production. The lifecycle: pending, ready_to_build, in_production, ready_to_ship, completed, cancelled. Cancel is reachable from every state except completed.

Phases are the unit of work inside a project. Each phase moves through pending, active, completed, cancelled. Reorder phases using the Up and Down buttons; the server persists the new positions in a single transaction.

## Money handling

Every monetary value in Kitstak is stored as integer cents (BIGINT in Postgres, integer or numeric string on the wire). The formatter `formatCents` chooses the right number of fractional digits per currency. Zero-decimal currencies (JPY, KRW, VND, CLP, ISK) render with no decimal places.

## Audit

Every state transition writes a row to `audit_log` chained by `payload_hash`. Versions of approved or submitted quotes are stored verbatim in `quote_versions` and never overwritten.
