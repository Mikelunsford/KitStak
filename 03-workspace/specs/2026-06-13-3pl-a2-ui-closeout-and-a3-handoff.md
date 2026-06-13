# Handoff: 3PL Job Builder UI shipped (Phase A2 complete), next is A3

Date: 2026-06-13
Parent plan: `03-workspace/specs/2026-06-04-3pl-commercial-pivot-and-wms-pillar-plan.md` (section 7, Body A).
Canon: ADR `docs/adr/0002-spine-plus-addons-and-wms-sixth-addon.md`.
Supersedes the open task in `03-workspace/specs/2026-06-13-3pl-job-builder-ui-handoff.md` (that increment is now shipped).

## What just shipped (Phase A2 UI, PR #254)

The Job Builder SPA layer is live on main (squash `873e254`). It mirrors the A1
Accounts UI file-for-file. UI only: no migrations and no edge functions, so the
merge fired only the Vercel deploy.

Files:
- `apps/web/src/lib/services/jobTemplatesService.ts`: typed client for the
  `/three-pl-api/job-templates` surface plus the line CRUD, Zod-parsed.
- `apps/web/src/lib/hooks/useJobTemplates.ts`: TanStack Query hooks; mutations
  invalidate the entity key plus the `job_template` audit timeline.
- `apps/web/src/lib/queryKeys/threepl.ts`: `jobTemplatesKeys` and
  `jobTemplateLinesKeys`.
- `apps/web/src/pages/3pl-operations/job-builders/`: list (status and variant
  filters), detail (hub eyebrow, HISTORY rail), the builder-lines section
  (component, service, and step lines with item and VAS references), and the
  create form (variant, job type, default BOM item, JB- auto-number).
- `apps/web/src/routes.ts`: lazy list, `/new`, and `/:id` (`/new` precedes
  `/:id`).
- `apps/web/src/components/shell/sidebarModes.ts` plus its test: the Job Builders
  entry, second in the 3PL OPERATIONS section, gated `plugins.three_pl`.

URL: `/3pl-operations/job-builders`. Gated automatically via the
`/3pl-operations` prefix (`inferPluginForPath` to `plugins.three_pl`).

Verification: typecheck, lint (0 warnings), 440 tests, contract parity
(byte-mirror `threepl.ts` untouched), build, size-limit (SPA index 39.45 kB
gzipped, under 40). A `code-reviewer` pass returned APPROVE with 0 critical and
0 high. One review fix was folded in: the VAS list now loads only when the
template has a service line to label or the form is editing one, instead of on
every detail view.

## Phase state (Body A, the 3PL commercial layer)

- A0 canon (ADR 0002 and 0003, CLAUDE.md reframe): DONE (#249, #251).
- A1 IA and Accounts (backend, UI, pillar-grouped sidebar): DONE (#249).
- A2 Job Builder (backend #252, UI #254): DONE.
- A3 Quote integration: NEXT.
- A4 Project conversion with template snapshotting.
- A5 Supply Plan (`supply_plans`; reserve at release).
- A6 Job Runs and Daily Progress (`job_runs`; posts spine `stock_movements`).
- A7 Billing Review and Profitability.

Then WMS Body B (B0 chassis through B4), with the B2 `stock_movements`
`location_id` change as an explicit operator stop-point.

## Next: A3 Quote integration

Per the plan (section 7, Body A): "A job template drives quote line generation;
a won quote becomes a project and a job of the right type, reusing spine
quoting, projects, and job types."

A3 is new design work, not a mirror like A2, so it wants a short planning pass
before code. The shape:

1. A job template (the A2 entity just shipped) drives quote line generation:
   choosing a template on a quote expands its `job_template_lines` into quote
   line items (component and service lines priced from `rate_cents`; the default
   BOM item informs the bill).
2. A won quote becomes a project plus a job of the right type, reusing the
   existing spine quote-to-project conversion and the `job_types` catalog.

Entry points to study before building (all spine, already shipped):
- Quotes: `apps/web/src/lib/services/quotesService.ts`, the `useQuotes` hooks,
  `apps/web/src/pages/quotes/*`, and the quote and quote-line-item schemas in
  `apps/web/src/lib/types/sales.ts` (`QuoteSchema` and the line-item types).
- The existing won-quote conversion (quote becomes a project): find the
  approve/convert action on the quote detail page and the matching `quotes-api`
  edge route.
- Job types: `apps/web/src/lib/services/jobTypesService.ts` and the `job_types`
  catalog.
- Job Builder (A2): `apps/web/src/lib/services/jobTemplatesService.ts` and the
  `job_template_lines` shape in `apps/web/src/lib/types/threepl.ts`.
- The commercial-layer backend pattern: the `three-pl-api` job-template routes
  (A2 backend) and `quotes-api` for the quote side.

Open question to settle with the operator before the A3 build: does
template-to-quote expansion happen SPA-side (a thin "apply template" action that
composes quote lines over the existing quote-line CRUD) or server-side (a new
edge route that materializes the lines)? The plan says reuse spine quoting;
confirm which side owns the expansion before writing code, because it decides
whether A3 touches an edge bundle and a migration at all or stays UI-thin.

## House rules (unchanged)

- Brand voice on disk: no em dashes, no double hyphens, no emojis.
- Byte-mirror `_shared/types/*` and `apps/web/src/lib/types/*` stay identical;
  money is BIGINT cents; capabilities gate every write; the server is authority.
- Stack onto one branch, push when green, let the operator review the PR before
  merge. Do not merge without the operator.
- Delivery wave is Wave 12. Use W12 / Wave12 in any follow-up ids.
