# Handoff: 3PL project conversion with template snapshotting shipped (Phase A4), next is A5

Date: 2026-06-13
Parent plan: `03-workspace/specs/2026-06-04-3pl-commercial-pivot-and-wms-pillar-plan.md` (section 7, Body A).
Canon: ADR `docs/adr/0002-spine-plus-addons-and-wms-sixth-addon.md`.
Settles the A4 work handed off in `03-workspace/specs/2026-06-13-3pl-a3-quote-integration-closeout-and-a4-handoff.md`.
PR: #257 (open, awaiting operator review; do not merge without the operator).

## What the plan asked for

Per the plan (Phase A4): "Project conversion with template snapshotting. On release,
snapshot the template into the run so later template edits do not rewrite history."
Runs are A6, so at A4 the snapshot lands on the project (the entity that exists at
conversion). The A3 closeout deferred two things to A4: the `source_job_template_id`
breadcrumb (which template built a quote) and the template snapshot. A4 owns both.

## Two decisions made during the build

1. Snapshot storage: a nullable `projects.job_template_snapshot` jsonb column, not a
   normalized snapshot table. The snapshot is write-once and frozen by definition (its
   whole purpose is to not change when the live template changes), it matches the
   existing `payload` / `metadata` jsonb convention, and it adds zero new RLS, audit, or
   numbering surface. A normalized table would be ceremony for no query benefit at this
   phase. A later `job_profitability_snapshots`-style table (plan section 7) remains a
   separate, optional concern.
2. Breadcrumb placement: on both the quote and the project. `source_job_template_id` is
   set on the quote at apply time (symmetric with how A3 sets `job_type_id`) and carried
   onto the project at convert time. This gives a continuous "built from template X"
   trail on both surfaces. This is the one spine-to-add-on FK A3 deliberately deferred.

## What A4 shipped (PR #257)

Server:
- Migration `0094_quote_project_template_snapshot.sql`:
  - additive nullable `quotes.source_job_template_id` and
    `projects.source_job_template_id`, both spine-to-add-on FKs to `job_templates`
    (0091), `ON DELETE SET NULL` so deleting a template never blocks conversion nor
    orphans a project (the breadcrumb simply nulls; the frozen snapshot stays).
  - additive nullable `projects.job_template_snapshot` jsonb.
  - forward `CREATE OR REPLACE` of `convert_quote_to_project` (last defined in 0093,
    same 4-arg signature) that copies `source_job_template_id` onto the project and
    builds the org-scoped frozen snapshot (header plus lines, ordered by position).
    Reads both `job_type_id` and `source_job_template_id` from the in-org quote row, so
    the SECURITY DEFINER RPC cannot be used to inject a foreign template; the snapshot
    SELECT is filtered `jt.org_id = v_org_id` and `jtl.org_id = v_org_id`. Preserves the
    0093 job-type carryover, the 0044 line-item carryover (budget rolled up by the 0059
    trigger), and the 0041 cross-tenant guard (NOT_FOUND, never 403).
  - Validated on staging in an aborting transaction: a quote carrying a source template
    converted to a project that carried `source_job_template_id` and a three-line frozen
    snapshot (component with rate, service with rate, unpriced step with null rate).
- `quotes-api`: `createQuote` and `updateQuote` validate `source_job_template_id` in-org
  via `assertRefInOrg('job_templates', ...)` (404, never 403). No new capability (rides
  `quotes.quote.write`; conversion rides `quotes.convert_to_project`).
- `source_job_template_id` plus `job_template_snapshot` added to `QuoteSchema`,
  `ProjectSchema`, and `CreateQuoteRequestSchema` (so the partial `UpdateQuoteRequest`
  inherits it), plus a new `JobTemplateSnapshotSchema` / `JobTemplateSnapshotLineSchema`,
  in both byte-mirror `sales.ts` files. Read fields are `.nullable().optional()` so the
  additive columns never fail a parse in the deploy window.

SPA:
- `useApplyTemplateToQuote` (in `useQuotes.ts`): stamps `source_job_template_id` on the
  quote in the same PATCH that sets the job type, so the breadcrumb threads quote to
  project. The line-expansion mapper (`applyJobTemplate.ts`) is unchanged.
- `ProjectDetailPage.tsx`: a "Built from template" link in the header (to the live
  template detail) and a read-only TEMPLATE SNAPSHOT panel rendering the frozen lines.
  The panel is the visible proof of the freeze: it reads the snapshot, not the live
  template, so later template edits never change it. ProjectDetailPage stays a lazy
  chunk, so no index-bundle impact.

Verification: contract parity (byte-mirror intact), SPA typecheck, lint (max-warnings 0),
456 tests (16 new: 11 migration static checks in `db-0094-...`, 5 schema parse in
`job-template-snapshot-schema...`), deno check across all 29 edge bundles, build,
size-limit (SPA index 39.58 kB gzipped, under 40).

## Deferred by design

- The A6 `job_runs` snapshot (`job_template_id` frozen at run creation, plan section 7)
  is a separate, lighter snapshot and lands with the runs phase. A4's project snapshot
  and A6's run snapshot are complementary, not redundant.
- A "snapshot vs live template drift" affordance on the project page (showing what
  changed since conversion) is noted, not built. Filed as
  F-Wave12-PROJECT-SNAPSHOT-DIFF-01.

## Next: A5 Supply Plan

Per the plan (Phase A5): "`supply_plans` and `supply_plan_lines`; reserve at release;
shortage resolution writes spine reserved movements." Starting points:
- The spine stock ledger: `stock_movements` (0030) is where a reserve writes. Reserved
  movements are the mechanism; do not invent a parallel reservation table.
- The project release transition: the project FSM (0016) `pending -> ready_to_build` (or
  the equivalent release point) is where reservation fires.
- The project line items / materials already carried by `convert_quote_to_project` are
  the demand side; the supply plan resolves them against on-hand and inbound.
- Numbering chassis (`next_doc_number`, 0038) for a `SUP-` prefix, mirroring 0090 / 0092.

Then A6 Job Runs and Daily Progress, A7 Billing Review and Profitability, then WMS Body B
(B0 through B4) behind the B2 `stock_movements` `location_id` operator stop-point.

## Follow-ups

- F-Wave12-PROJECT-SNAPSHOT-DIFF-01 (optional): show snapshot-vs-live-template drift on
  the project detail page so an operator can see what changed since conversion.
- F-Wave12-QUOTE-UPDATE-IMMUTABLE-FIELDS-01 (carried from A3): the quote PATCH route
  still accepts `number` and `currency_code` via the partial update schema. A4 added
  `source_job_template_id` to that schema, but every A4 call site sends only the template
  and job-type fields. Tighten `UpdateQuoteRequestSchema` to omit fields that should be
  immutable after creation.
- F-Wave12-3PL-ANALYTICS-TEMPLATE-APPLIED-01 (carried from A3, optional): a
  `job_template_applied` funnel event would need a registry addition to the bounded typed
  analytics union; filed rather than freehanded.

## House rules (unchanged)

- Brand voice on disk: no em dashes, no double hyphens, no emojis.
- Byte-mirror `_shared/types/*` and `apps/web/src/lib/types/*` stay identical; money is
  BIGINT cents; capabilities gate every write; the server is authority.
- Stack onto one branch, push when green, operator reviews the PR before merge.
- Delivery wave is Wave 12.
