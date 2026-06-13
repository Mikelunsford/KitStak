# Handoff: 3PL Job Builder UI layer (Phase A2 remainder)

Date: 2026-06-13
For: a fresh session with no memory of the build session that produced this.
Parent plan: `03-workspace/specs/2026-06-04-3pl-commercial-pivot-and-wms-pillar-plan.md` (Phase A2, sections 6.1 and 7).
Canon: ADR `docs/adr/0002-spine-plus-addons-and-wms-sixth-addon.md`.

## TL;DR

The 3PL commercial pivot's Phase A2 (Job Builder) is half done. The backend is
complete, green, and MERGED to main (PR #252, squash `5776e57`): migrations
0091 + 0092, the byte-mirror Zod types, the capabilities, and the full
`three-pl-api` job-template surface are live on prod. Two UI increments remain,
both fully verifiable with the SPA toolchain:

1. The SPA Job Builder pages (service, queryKeys, hook, list/detail/create plus
   the line builder).
2. The 3PL Operations sidebar entry pointing at the new list route.

This is the direct analog of the A1 Accounts UI, which is already shipped and is
your closest template in every file. Mirror it.

Stack both increments onto one branch and push once green. The operator works in
a stack-and-push rhythm and reviews the PR before merge. The UI layer touches no
edge functions and no migrations, so a merge fires only the Vercel deploy.

## How to resume

1. `git checkout main && git pull` (you want `5776e57` or later, which has the
   A2 backend and the A1 Accounts UI to copy from). Branch off it.
2. `pnpm install` at the repo root. node_modules is NOT committed and is absent
   in a fresh worktree.
3. Green gates (all must pass before you push):
   - `pnpm --filter web typecheck`
   - `pnpm --filter web lint` (eslint, max-warnings 0)
   - `pnpm --filter web test` (runs `vitest run src` then the regression suite)
   - `pnpm --filter web test:contract` (byte-mirror parity)
   - `pnpm --filter web build`
   - `pnpm --filter web bundle-budget` (size-limit; SPA index chunk under 40 kB gz)
   The UI layer does not touch edge functions, so you do not need Deno for it.

## What is already done (backend, do not redo)

Live on main / prod as of PR #252 (`5776e57`):
- Migration `0091_job_templates.sql`: `job_templates` (the Job Builder engine;
  `variant` in kit/sidekick/repack/labeling/inspection/custom; `status`
  active/inactive flag; `job_type_id` and `default_bom_item_id` spine refs;
  `template_number`; `payload jsonb`) and `job_template_lines` (component /
  service / step lines; `item_id`, `vas_id`, `quantity` numeric, `rate_cents`
  BIGINT, `position`). Pattern A RLS, audit triggers, audit_log entity_type
  CHECK superset. Validated in a rollback transaction on prod.
- Migration `0092_job_templates_numbering.sql`: `JB-` numbering.
- `_shared/types/threepl.ts` and `apps/web/src/lib/types/threepl.ts`
  (byte-identical pair) gained `JobTemplate`, `JobTemplateCreate`,
  `JobTemplatePatch`, `JobTemplateLine`, `JobTemplateLineCreate`,
  `JobTemplateLineUpdate`, plus the `JobTemplateVariant`, `JobTemplateStatus`,
  and `JobTemplateLineKind` enums and their `*Schema` companions.
- 6 `threepl.job_template.*` capabilities in both `capabilities.ts` mirrors
  (`create`, `update`, `deactivate`, `line.create`, `line.update`,
  `line.delete`; granted to owner/admin/ops/sales).
- `supabase/functions/three-pl-api/index.ts`: the job-template routes (already
  deployed; three-pl-api is in the deploy BUNDLES list).

So Job Builder is functional at the API layer right now.

## The backend contract you build the UI against

Bundle prefix: `/three-pl-api` (same bundle as Accounts). The apiClient attaches
the `Idempotency-Key` for non-GET requests; do not hand-roll it. All routes are
gated `plugins.three_pl`; reads are RLS-only (no read cap).

```
GET    /three-pl-api/job-templates                     list (?status=, ?variant=)
POST   /three-pl-api/job-templates                     create (cap threepl.job_template.create)
GET    /three-pl-api/job-templates/:id                 read
PATCH  /three-pl-api/job-templates/:id                 update (cap threepl.job_template.update)
DELETE /three-pl-api/job-templates/:id                 soft-delete (reuses job_template.update)
POST   /three-pl-api/job-templates/:id/deactivate      status -> inactive (cap threepl.job_template.deactivate)
POST   /three-pl-api/job-templates/:id/reactivate      status -> active   (cap threepl.job_template.deactivate)
GET    /three-pl-api/job-templates/:id/lines           list lines
POST   /three-pl-api/job-templates/:id/lines           add    (cap threepl.job_template.line.create)
PATCH  /three-pl-api/job-templates/:id/lines/:lid      update (cap threepl.job_template.line.update)
DELETE /three-pl-api/job-templates/:id/lines/:lid      delete (cap threepl.job_template.line.delete)
```

Types: import from `@/lib/types/threepl`. Money is BIGINT `_cents`; quantity is
numeric (number or numeric-string on the wire). `default_bom_item_id` references
an item (the parent item whose `bom_items` compose the BOM; there is no
standalone boms table). StatusBadge already covers `active` / `inactive`.

## Task 1: SPA Job Builder pages (mirror Accounts exactly)

The A1 Accounts UI is the template for every file. Copy and adapt:

- Service: `apps/web/src/lib/services/accountsService.ts` ->
  `jobTemplatesService.ts`. Calls go to `/three-pl-api/job-templates...`. Zod
  parse on the way out. Fold the line CRUD into the same service file (Accounts
  folded service-definition CRUD into accountsService).
- Query keys: `apps/web/src/lib/queryKeys/threepl.ts` already holds
  `accountsKeys` and `accountServicesKeys`. Add `jobTemplatesKeys` and
  `jobTemplateLinesKeys` in the same file (same `all / list(filters) /
  detail(id)` shape).
- Hook: `apps/web/src/lib/hooks/useAccounts.ts` -> `useJobTemplates.ts`.
  TanStack Query, `C = { staleTime: 30_000, refetchOnWindowFocus: false,
  retry: 1 }`, mutations invalidate the entity key plus
  `auditLogKeys.byEntity('job_template', id)` for the detail timeline.
- Pages: copy `apps/web/src/pages/3pl-operations/accounts/` to
  `apps/web/src/pages/3pl-operations/job-builders/`:
  - `JobTemplatesListPage.tsx` (mirror AccountsListPage): PageHeader (eyebrow
    "3PL Operations", title "Job Builders", New action), FilterBar with a status
    Select (active/inactive) and optionally a variant Select, DataTable
    (template number, name, variant, status via StatusBadge), client Pagination.
  - `JobTemplateDetailPage.tsx` (mirror AccountDetailPage): DetailLayout, main
    column shows the template fields plus the lines section, rail shows HISTORY
    (`AuditTimeline entityType="job_template"`). Hub-style, so SET the eyebrow.
    deactivate/reactivate actions gated on `threepl.job_template.deactivate`.
  - `JobTemplateLines.tsx` (mirror `AccountServiceDefinitions.tsx`): the line
    builder. Add/edit/delete component / service / step lines, gated on the
    `threepl.job_template.line.*` caps. Money via `formatCents`; quantity via a
    numeric input.
  - `JobTemplateCreatePage.tsx` (mirror AccountCreatePage): useState + Zod
    safeParse. Required: name. Optional: variant (default custom), job type,
    default BOM item, template_number (server fills JB- when blank). On success,
    navigate to the detail route.
- Routes in `apps/web/src/routes.ts`: lazy imports + RAW_ROUTES entries for
  `/3pl-operations/job-builders`, `/3pl-operations/job-builders/new`,
  `/3pl-operations/job-builders/:id`. The `/new` path MUST precede `/:id`.
  Gating is automatic: `inferPluginForPath` maps any `/3pl-operations` path to
  `plugins.three_pl`, so do not set `requiresPlugin` by hand.

URL note: the SPA URL is `/3pl-operations/job-builders` (matches the sidebar
label "Job Builders"); the edge routes and entity are `job_templates`. This
product-name-vs-entity split mirrors Accounts (feature "Accounts" over the
`three_pl_accounts` entity).

## Task 2: the 3PL Operations sidebar entry

Add a "Job Builders" entry to the 3PL OPERATIONS section in
`apps/web/src/components/shell/sidebarModes.ts`, pointing at
`/3pl-operations/job-builders`, with `requiresFlag: FEATURE_FLAGS.PLUGINS_THREE_PL`
(every 3PL entry carries it). Put it second, right after Accounts, matching the
plan's section order (Accounts, Job Builders, ..., Receiving, Shipments). Update
`sidebarModes.test.ts` to assert the new entry.

Canon-steward gotcha: `scripts/canon-steward-check.mjs` (run inside
`pnpm --filter web test` via `canon-steward-route-hint.test.ts`) flags a
registered list route with no Sidebar entry. Land the sidebar entry in the same
increment as the routes (or first). `/new` and `/:id` are auto-exempt; only the
`/3pl-operations/job-builders` list route needs the sidebar entry.

## Verification gates (run before every push)

```
pnpm --filter web typecheck
pnpm --filter web lint
pnpm --filter web test
pnpm --filter web test:contract
pnpm --filter web build
pnpm --filter web bundle-budget
```

## Constitution and house rules to honor

- Brand voice on disk (commits, PR text, code comments, docs): no em dashes, no
  double hyphens, no emojis.
- Immutability; native useState plus Zod safeParse for forms (no react-hook-form).
- Stack: react-router-dom v6 flat ROUTES table, TanStack Query, Tailwind plus
  the hand-rolled UI kit (`components/ui/`), lucide-react. No new dependency.
- You should NOT need to touch `types/*`, `capabilities.ts`, the migrations, or
  the edge bundle for the UI. The backend is done. If you do touch a byte-mirror
  file, keep both copies byte-identical (the parity test does a strict byte
  compare; copy one over the other).
- Server is the authority for capabilities. Use `useCapabilities` (or the
  vertical's caps hook the Accounts pages use) to hide create/edit/delete actions
  the caller's role lacks.

## Gotchas

- node_modules is not in the worktree. Run `pnpm install` first.
- LF to CRLF git warnings on Windows are benign.
- Delivery wave is Wave 12. Use W12 / Wave12 in any follow-up ids.
- Do not merge without the operator. Merge fires the Vercel deploy.

## Decisions already locked (do not re-ask)

- Spine plus add-ons framing; the pillar-grouped sidebar (ADR 0002, ADR 0003).
- Name the surface "Job Builders"; entity `job_templates`; numbering JB-.
- variant is a branded preset of the one template engine (Sidekick is a variant,
  not a separate concept).
- BOM reference is item-keyed (`default_bom_item_id` -> items), no boms table.
- Job runs, supply plans, billing reviews are later A-phases (A5 to A7), not this.

## After A2 UI: the rest of the 3PL extension

Per the plan, the remaining phases in order:
- A3 Quote integration (a job template drives quote lines; a won quote becomes a
  project plus a job of the right type).
- A4 Project conversion with template snapshotting.
- A5 Supply Plan (`supply_plans`; reserve at release).
- A6 Job Runs and Daily Progress (`job_runs`; posts spine stock_movements).
- A7 Billing Review and Profitability.
- Then WMS Body B (B0 chassis through B4), with the B2 `stock_movements`
  `location_id` change as an explicit operator stop-point.

## Suggested first move

Read this handoff, then the A1 Accounts UI files in order: `accountsService.ts`,
`queryKeys/threepl.ts`, `useAccounts.ts`, the four
`pages/3pl-operations/accounts/*` files, and the 3PL OPERATIONS block in
`sidebarModes.ts`. Then build Task 1 and Task 2, landing the sidebar entry in
whichever increment adds the routes to keep canon-steward green.
