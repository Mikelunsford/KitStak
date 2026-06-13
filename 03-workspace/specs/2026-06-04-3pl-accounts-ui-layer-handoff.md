# Handoff: 3PL Accounts UI layer (Phase A1 remainder)

Date: 2026-06-04
For: a fresh session with no memory of the build session that produced this.
Parent plan: `03-workspace/specs/2026-06-04-3pl-commercial-pivot-and-wms-pillar-plan.md`.
Canon: ADR `docs/adr/0002-spine-plus-addons-and-wms-sixth-addon.md`.

## TL;DR

The 3PL commercial pivot's Phase A1 (Accounts) is half done. The backend is
complete, green, and pushed on branch `feat/spine-addons-canon-wms-adr` (PR #249).
Two UI increments remain, both fully verifiable with the SPA toolchain:

1. The SPA Accounts pages (services, queryKeys, hook, list/detail/create pages, routes).
2. The pillar-grouped sidebar rewrite (the operator chose this; it supersedes the
   UX-Q1 job-mode sidebar).

Stack both onto the same branch and push once each is green. Do not merge (merge
triggers the deploy and migrate workflows). The operator works in a stack-and-push
rhythm and reviews the PR before merge.

## How to resume

1. `git checkout feat/spine-addons-canon-wms-adr` then `git pull`.
2. `pnpm install` at the repo root. node_modules is NOT committed and is absent in a
   fresh worktree. The install takes a few minutes.
3. Green gates (all must pass before you push):
   - `pnpm --filter web typecheck`
   - `pnpm --filter web lint` (eslint, max-warnings 0)
   - `pnpm --filter web test` (vitest src + regression)
   - `pnpm --filter web test:contract` (byte-mirror parity)
   - `pnpm --filter web build`
   - `pnpm --filter web bundle-budget` (size-limit; SPA index chunk under 40 kB gz)
   The UI layer does not touch edge functions, so you do not need Deno for it.

## What is already done (backend, do not redo)

On the branch, in order:
- ADR 0002 plus the CLAUDE.md and `00-canon/01-architecture.md` reframe to spine plus
  add-ons, WMS as the sixth add-on. (Phase A0.)
- Migration `0089_threepl_accounts.sql`: `three_pl_accounts` (the service relationship
  over a CRM customer; status active/inactive flag; customer_id required) and
  `account_service_definitions` (per-account Rate Card overlay). Pattern A RLS,
  audit_append_state_change triggers, audit_log entity_type CHECK superset.
  Staging-validated (ran in a rollback transaction, zero drift).
- Migration `0090_threepl_accounts_numbering.sql`: ACC- numbering.
- `_shared/types/threepl.ts` and `apps/web/src/lib/types/threepl.ts` (byte-identical
  pair, registered in `apps/web/test/contract/parity.test.ts` BESPOKE_PAIRS).
- `supabase/functions/three-pl-api/index.ts`: the edge bundle (gated `plugins.three_pl`).
- 6 `threepl.account.*` capabilities in both `capabilities.ts` mirrors
  (owner/admin/ops/sales).
- `three_pl_account` added to the `DocType` union in `_shared/numbering.ts` and to the
  deploy BUNDLES list in `.github/workflows/deploy-functions.yml`.

So Accounts is functional at the API layer right now.

## The backend contract you build the UI against

Bundle base path (how the SPA reaches an edge bundle): `apiRequest('/<bundle>/<route>')`.
For this bundle the prefix is `/three-pl-api`. See `lib/apiClient.ts` and any existing
service for the exact wrapper. The apiClient attaches the `Idempotency-Key` for non-GET
requests; confirm in `lib/apiClient.ts` and do not hand-roll it.

three-pl-api routes (all gated `plugins.three_pl`; reads are RLS-only, no read cap):
```
GET    /three-pl-api/accounts                       list (?status=, ?customer_id=)
POST   /three-pl-api/accounts                        create (cap threepl.account.create)
GET    /three-pl-api/accounts/:id                    read
PATCH  /three-pl-api/accounts/:id                    update (cap threepl.account.update)
DELETE /three-pl-api/accounts/:id                    soft-delete (reuses account.update)
POST   /three-pl-api/accounts/:id/deactivate         status -> inactive (cap threepl.account.deactivate)
POST   /three-pl-api/accounts/:id/reactivate         status -> active   (cap threepl.account.deactivate)
GET    /three-pl-api/accounts/:id/services           list service definitions
POST   /three-pl-api/accounts/:id/services           add    (cap threepl.account.service_definition.create)
PATCH  /three-pl-api/accounts/:id/services/:sid      update (cap threepl.account.service_definition.update)
DELETE /three-pl-api/accounts/:id/services/:sid      delete (cap threepl.account.service_definition.delete)
```

Types (import from `@/lib/types/threepl`): `ThreePlAccount`, `ThreePlAccountCreate`,
`ThreePlAccountPatch`, `AccountServiceDefinition`, `AccountServiceDefinitionCreate`,
`AccountServiceDefinitionUpdate`, plus the `ThreePlAccountStatus` and
`AccountServiceKind` enums and their `*Schema` companions. Money is BIGINT `_cents`
on the wire (number or numeric-string). Quantities are not used here.

StatusBadge already covers the account states. `active` and `inactive` exist in the
COLOR_MAP and LABEL_MAP in `apps/web/src/components/ui/StatusBadge.tsx`. No StatusBadge
change is needed; just render `<StatusBadge status={account.status} />`.

## Task 1: SPA Accounts pages

The SPA layers as services to queryKeys to hooks to pages. Mirror the ops vertical
(receiving / shipments), which is the closest analog: also gated under
`/3pl-operations/*`, also backed by a sibling bundle (ops-api).

Templates to copy from:
- Service: `apps/web/src/lib/services/receivingOrdersService.ts` (apiRequest calls,
  Zod parse on the way out, filter querystring helper).
- Query keys: `apps/web/src/lib/queryKeys/ops.ts` (the `xKeys.all / list(filters) /
  detail(id)` shape).
- Hook: `apps/web/src/lib/hooks/useOps.ts` (TanStack Query, `C = { staleTime: 30_000,
  refetchOnWindowFocus: false, retry: 1 }`, mutations invalidate the entity key plus
  `auditLogKeys.byEntity('three_pl_account', id)` for the detail timeline).
- Pages: the receiving or shipments list/detail/create pages in
  `apps/web/src/pages/3pl-operations/` use the shared UI kit. The shared UI kit is in
  `apps/web/src/components/ui/`: PageHeader, DataTable, Pagination, Select, FilterBar,
  DetailLayout, StatusBadge, Button, TextInput.

Files to create:
- `apps/web/src/lib/services/accountsService.ts` (list/get/create/update/deactivate/
  reactivate/softDelete) and a sibling for service definitions, or fold both into one
  service file. Calls go to `/three-pl-api/accounts...`.
- `apps/web/src/lib/queryKeys/threepl.ts` (`accountsKeys`, `accountServicesKeys`).
- `apps/web/src/lib/hooks/useAccounts.ts`.
- `apps/web/src/pages/3pl-operations/AccountsListPage.tsx`,
  `AccountDetailPage.tsx`, `AccountCreatePage.tsx`. Keep the page files under
  `pages/3pl-operations/` to match the spine-reroute convention (page files stayed
  there even though spine URLs moved; the gated 3PL surfaces still live here).
- Routes in `apps/web/src/routes.ts`: add lazy imports and RAW_ROUTES entries for
  `/3pl-operations/accounts`, `/3pl-operations/accounts/new`,
  `/3pl-operations/accounts/:id`. The `/new` path MUST precede `/:id`. Gating is
  automatic: `inferPluginForPath` maps any `/3pl-operations` path to
  `plugins.three_pl`, so do not set `requiresPlugin` by hand.

Page detail notes:
- List page: PageHeader (eyebrow "3PL Operations", title "Accounts", a New action),
  FilterBar with a status Select (active/inactive), DataTable (account number, name,
  customer, status via StatusBadge), client Pagination. Row click to the detail route.
- Detail page: DetailLayout (two column). Main column shows the account fields and a
  service-definitions section (list the per-account rate cards, with add/edit/delete).
  Rail shows HISTORY (the audit timeline via `auditLogKeys.byEntity`). HUB-style detail
  pages SET the eyebrow (FSM detail pages omit it); accounts are hub-like, so set the
  eyebrow. Money columns render right-aligned mono via `formatCents`.
- Create page: a simple useState plus Zod safeParse form (no react-hook-form). Required:
  a customer picker (customer_id) and name. account_number is optional (server fills
  ACC- when blank). On success, navigate to the detail route.

Canon-steward gotcha: there is a canon-steward route-hint regression test that flags
ORPHAN routes (routes not reachable from the sidebar nav). If you add the
`/3pl-operations/accounts` routes without a sidebar entry pointing at them, you risk
tripping it. Land the sidebar Accounts entry in the same increment as the routes (or do
the sidebar task first and include the Accounts entry). Run
`pnpm --filter web test` and watch `canon-steward-route-hint.test.ts`.

## Task 2: pillar-grouped sidebar

Operator decision (2026-06-04): switch the sidebar from the six job-modes
(SELL / MAKE / SHIP / GET PAID / LIBRARY / WORKFORCE) to a pillar-grouped model. This
SUPERSEDES the UX-Q1 job-mode decision of 2026-05-21. It is a sidebar-only change. URLs
do not move; the flat ROUTES table stays the source of truth.

Structure (a Spine backbone section, always on, plus one section per lit add-on):
- SPINE (always on): CRM (Customers, Contacts, Leads, Opportunities, Activities),
  Quotes, Projects, Catalog (Items, BOMs, VAS), Inventory (Warehouses, Stock levels,
  Stock movements), Purchasing (Vendors, POs, Vendor bills, Expenses), Invoicing
  (Invoices, Credit notes, Payments), Finance (Chart of accounts, Period close, Journal
  entries), Settings (Sales config). Sub-group by domain if the kit supports it.
- 3PL OPERATIONS (requiresFlag `plugins.three_pl`): Accounts (NEW, /3pl-operations/
  accounts), Receiving, Shipments. Job Builders, Job Runs, Supply Plans, Billing
  Review, Profitability are later A-phases; add them when they ship.
- MANUFACTURING (requiresFlag `plugins.manufacturing`): Runs.
- CO-PACK AND ECOM (requiresFlag `plugins.copack_ecom`): Sales orders, Kitting jobs,
  Fulfillments, Sales channels.
- KITFORCE (requiresFlag `plugins.kitforce`): Members, Teams, Schedule, Assignments,
  Time entries.
- KITCOST (requiresFlag `plugins.kitcost`): Cost dashboard.
- WMS is NOT built yet (no `plugins.wms` flag in code). Do not add a WMS section in
  this task; it lands with the WMS body (plan phases B0 to B4).

Files:
- `apps/web/src/components/shell/sidebarModes.ts`: rewrite `SIDEBAR_MODES` from the
  six job-modes to the sections above. The current file holds 35 hardcoded path strings
  and is fully decoupled from `routes.ts` (it does not import the route table), so this
  is safe. Keep the `requiresFlag` per-route gating that already exists (it hides links
  when the org lacks the plugin). The `ModeKey` union, `isRouteVisible`,
  `visibleRoutesForMode`, and `findActiveMode` helpers will need their keys updated.
- `apps/web/src/components/shell/Sidebar.tsx`: update the rendering to the new section
  model. There is a localStorage mode-key allowlist around line 81 (the parked-sidebar
  note flagged that the `workforce` key was missing from it). Whatever section keys you
  choose, make sure they are all in that allowlist or the expand/collapse memory breaks.
- `apps/web/src/components/shell/sidebarModes.test.ts`: rewrite to assert the new
  section structure.

Keep the paths in `sidebarModes.ts` pointing at the CURRENT spine and add-on URLs (for
example Quotes is `/quotes`, Items is `/catalog/items`, Vendors is
`/purchasing/vendors`, Receiving is `/3pl-operations/receiving`). The existing file
already has the correct post-reroute paths; reuse them, just regroup.

## Verification gates (run before every push)

```
pnpm --filter web typecheck
pnpm --filter web lint
pnpm --filter web test
pnpm --filter web test:contract
pnpm --filter web build
pnpm --filter web bundle-budget
```
All green, then commit and push to `feat/spine-addons-canon-wms-adr`. The build session
that produced this kept each commit individually green and pushed incrementally.

## Constitution and house rules to honor

- Brand voice on disk (commits, PR text, code comments, docs): no em dashes, no double
  hyphens, no emojis. Use periods or rephrase.
- Immutability: build new objects, never mutate. Native useState plus Zod safeParse for
  forms (no react-hook-form, no Formik).
- Stack: react-router-dom v6 flat ROUTES table, TanStack Query, Tailwind plus the
  hand-rolled UI kit, lucide-react icons. Do not add a dependency.
- File size: keep files focused (under 800 lines).
- Design quality (web/design-quality rules): intentional hierarchy, designed hover and
  focus states, do not ship default-template-looking UI. Match the existing UI kit
  surfaces (Vendors, Receiving, Shipments) for consistency.
- Byte-mirror canon: you should NOT need to touch `types/*`, `capabilities.ts`, or
  `workflow/*` for the UI. If you do, both mirror copies must stay byte-identical and
  the parity contract must pass. The capabilities for accounts already exist.
- Server is the authority for capabilities. The SPA mirrors `CAPABILITIES_BY_ROLE` only
  to hide buttons. Use `useCapabilities` (see `lib/hooks/useCapabilities.ts`) to hide
  create/edit/delete actions the caller's role lacks.

## Gotchas learned this session

- node_modules is not in the worktree. Run `pnpm install` first.
- Staging Supabase project is `dnkgaufydcnedgkuoyml`. The MCP `list_projects` does NOT
  surface it (it is outside the listed org scope), but `execute_sql` reaches it by ref.
  The UI layer needs no DB work, so you likely will not touch this.
- The audit entity-type authority pin in
  `apps/web/test/regression/db-0083-audit-entity-type-superset.test.ts` was already
  moved from 0083 to 0089. Do not revert it.
- LF to CRLF git warnings on Windows are benign.
- Delivery wave for this work is Wave 12 (Wave 11 is KitForce). Use W12 / Wave12 in any
  risk or follow-up ids.
- Do not merge the PR. Merge fires the migrate and deploy workflows. The operator merges
  after review.

## Decisions already locked (do not re-ask)

- Spine plus add-ons framing; WMS is add-on six (ADR 0002).
- Build 3PL commercial first, then WMS.
- Name the surface "Accounts" (not "3PL Accounts" or "Customer Profiles").
- Reserve stock at project release and Supply Plan (relevant to later phases, not Accounts).
- Manual Job Run scheduling first (later phase).
- Simple Job-Run labor logging first (later phase).
- Sidekick is a branded job_template variant (later phase).
- Customer-supplied inbound is one "Inbound Requirement" record (later phase).
- Billing Review stays light in 3PL; metered billing defers to a future KitMeter add-on.

## Suggested first move

Read these in order: this handoff, the parent plan section 5 and 6, then
`useOps.ts`, `receivingOrdersService.ts`, `queryKeys/ops.ts`, a receiving page set, and
`sidebarModes.ts`. Then build Task 1 and Task 2 as two green commits. Add the Accounts
sidebar entry in whichever increment lands the routes, to keep canon-steward green.
