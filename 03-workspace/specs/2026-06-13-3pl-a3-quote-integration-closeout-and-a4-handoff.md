# Handoff: 3PL Quote integration shipped (Phase A3), next is A4

Date: 2026-06-13
Parent plan: `03-workspace/specs/2026-06-04-3pl-commercial-pivot-and-wms-pillar-plan.md` (section 7, Body A).
Canon: ADR `docs/adr/0002-spine-plus-addons-and-wms-sixth-addon.md`.
Settles the open A3 question in `03-workspace/specs/2026-06-13-3pl-a2-ui-closeout-and-a3-handoff.md`.
PR: #256 (open, awaiting operator review; do not merge without the operator).

## Two decisions the operator settled before the build

1. Scope: full A3 (template-to-quote expansion AND conversion threading), not
   expansion-only. The job type is threaded quote to project this phase.
2. Expansion side: SPA-thin over the existing line-item CRUD, not a new edge
   route. Rationale: both server-side options force awkward coupling (a spine
   bundle reaching into 3PL tables, or a 3PL bundle writing spine quote lines);
   the SPA is the natural seam, and the server still validates and prices every
   line on the way in, so authority stays server-side.

## What A3 shipped (PR #256)

Two pieces:

1. Template drives quote line generation. An "Apply template" control on a draft
   or revise_requested quote expands a Job Builder template's lines into quote
   line items over the existing `addLineItem` endpoint, and sets the quote's job
   type from the template.
2. Won quote becomes a project of the right type. The quote carries a
   `job_type_id`; `convert_quote_to_project` copies it onto the project.

Server:
- Migration `0093_quote_job_type.sql`: additive nullable `quotes.job_type_id`
  (spine to spine FK to `job_types`, ON DELETE SET NULL). Forward CREATE OR
  REPLACE of `convert_quote_to_project` (last defined in 0044) that copies the
  job type onto the new project. Same 4-arg signature; reads the value from the
  in-org quote row (not a parameter), so the SECURITY DEFINER RPC cannot be used
  to inject a foreign job type; preserves the cross-tenant guard and the
  line-item carryover. `projects.job_type_id` already exists (0016), so no
  project-side DDL. Validated on staging in a rollback transaction.
- `quotes-api`: `createQuote` and `updateQuote` validate `job_type_id` in-org via
  `assertRefInOrg` (404, never 403). No new capability (rides
  `quotes.quote.write` and `quotes.convert_to_project`).
- `job_type_id` added to `QuoteSchema` and `CreateQuoteRequestSchema` in both
  byte-mirror `sales.ts` files (read field is `.nullable().optional()` so the
  additive column never fails a quote parse in the deploy window).

SPA:
- `apps/web/src/lib/quotes/applyJobTemplate.ts`: pure, unit-tested mapper.
  component to item (item_id), service to vas (vas_id), step to note;
  `rate_cents` to `unit_price_cents`; `quantity` to `quantity_e3` via
  `Math.round`. A quote line is only priced when it anchors to an item or VAS, so
  priced steps land as unpriced notes with the rate preserved in the description.
- `useApplyTemplateToQuote` (in `useQuotes.ts`): sets the quote job type from the
  template, then adds each line in template order over the existing endpoint. Not
  atomic by design; on a mid-sequence failure the error reports how many lines
  landed and the draft stays editable for retry.
- `ApplyTemplatePanel.tsx` plus an inline job-type control on the quote detail
  page, both gated to editable states. New `updateQuote` service method, plus
  `useUpdateQuote` and `useJobTypes` hooks.

Verification: contract parity, SPA typecheck, lint (max-warnings 0), 440 tests
plus 8 new mapper tests, deno check across all 25 bundles, build, size-limit
(SPA index 39.46 kB gzipped, under 40).

## Deferred to A4 by design

- Template snapshotting onto the project or run so later template edits do not
  rewrite history.
- The `source_job_template_id` breadcrumb (which template built the quote). A3
  left the `projects` schema untouched beyond the convert RPC's job_type copy;
  A4 owns the project-side reference and the snapshot.

## Next: A4 Project conversion with template snapshotting

Per the plan: "On release, snapshot the template into the run so later template
edits do not rewrite history." Starting points:
- The convert path: `convert_quote_to_project` (now in 0093) and the
  `projects` / `project_phases` tables (migration 0016).
- The quote-side breadcrumb A4 needs: A3 did not record which template built a
  quote. A4 should add `source_job_template_id` (to the quote at apply time, or
  to the project at convert time) so the snapshot has a source. This is the one
  spine to add-on FK A3 deliberately deferred.
- A2 template entities: `job_templates` / `job_template_lines`
  (`apps/web/src/lib/types/threepl.ts`, migration 0091).

Then A5 Supply Plan, A6 Job Runs and Daily Progress, A7 Billing Review and
Profitability, then WMS Body B (B0 through B4) behind the B2 `stock_movements`
`location_id` operator stop-point.

## Follow-ups

- F-Wave12-QUOTE-UPDATE-IMMUTABLE-FIELDS-01: the pre-existing quote PATCH route
  (`updateQuote`) accepts `number` and `currency_code` via the partial update
  schema. A3 made the route SPA-reachable for the first time (job-type control),
  but every A3 call site sends only `job_type_id`. Tighten
  `UpdateQuoteRequestSchema` to omit fields that should be immutable after
  creation. Not an A3 regression; the edge surface is unchanged.
- F-Wave12-3PL-ANALYTICS-TEMPLATE-APPLIED-01 (optional): the analytics event
  surface is a bounded typed union; a `job_template_applied` funnel event would
  need a registry addition, filed rather than freehanded.

## House rules (unchanged)

- Brand voice on disk: no em dashes, no double hyphens, no emojis.
- Byte-mirror `_shared/types/*` and `apps/web/src/lib/types/*` stay identical;
  money is BIGINT cents; capabilities gate every write; the server is authority.
- Stack onto one branch, push when green, operator reviews the PR before merge.
- Delivery wave is Wave 12.
