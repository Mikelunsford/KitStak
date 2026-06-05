# Spine plus add-ons re-route (Phase 1 plan)

Status: approved, not yet implemented. Date: 2026-06-04. Scope: front end only.
Source of truth for the target IA: white paper V2 "Pillars and Features Concepts".

## Context

The white paper V2 reframes Kitstak as one spine plus composable add-ons: the spine ships with every account (My Team, CRM, Quoting, Projects, Invoicing, Payments, Vendors/POs, Bills/Expenses, Accounting, Notifications, Import, Audit, read-only Portal), shared building blocks sit at the base (Catalog, Kits/BOMs, Inventory, Warehouses, Production, Pricing, VAS), and only true add-ons (3PL, Manufacturing, Co-Pack, WMS, Storefront, KitMeter, KitForce, KitCost, KitLink) gate.

Today the SPA contradicts that: a large slice of the spine and the shared blocks lives under the plugin-gated `/3pl-operations/*` namespace, so Quoting, Projects, Vendors, POs, Bills, Expenses, Catalog/items, BOMs, Inventory/stock, Warehouses, VAS, and sales-config are all gated behind `plugins.three_pl`. `inferPluginForPath` (`apps/web/src/routes.ts:1338`) auto-gates anything under `/3pl-operations`. This only works because `plugins.three_pl` defaults `true` on every tier (`supabase/functions/_shared/feature-defaults.ts:32,50,67`), making it a de-facto "account exists" flag rather than a real add-on toggle.

Goal: move spine and shared-block surfaces to neutral, always-ungated namespaces; leave only true add-on surfaces gated; preserve every old deep link with a redirect; rewrite `inferPluginForPath` so only true add-on namespaces gate. Front end only.

## Operator decisions (locked)

1. Namespace scheme A (grouped by domain area).
2. Receiving and Shipments stay gated under `/3pl-operations/*` (the true 3PL add-on). `/3pl-operations/*` retains a real purpose.
3. Keep page files in place on disk (URL-string change plus redirects only; lazy imports keep pointing at `pages/3pl-operations/*`). Directory relocation is a later follow-up.
4. Ungate the five edge-divergent surfaces on the FE (quotes, projects, BOMs, warehouses, stock); reconcile the edge in a follow-up.

## Constitutional review

No hard violation. Flat `ROUTES` table preserved, lazy splits preserved, no banned deps, 404-not-403 plugin-gate behavior preserved (`RequirePlugin` renders `NotFoundPage`), and nothing touches edge functions, migrations, money, audit, or idempotency.

One documented divergence, operator-acknowledged (decision 4): the SPA will ungate `/quotes`, `/projects`, `/catalog/boms`, `/inventory/warehouses`, `/inventory/stock/*`, but their edge bundles still hard-gate `plugins.three_pl`:

- `quotes-api` (`supabase/functions/quotes-api/index.ts:589`), `projects-api` (`projects-api/index.ts:539`), `inventory-api` (`inventory-api/index.ts:274`) gate single `flagKey: PLUGINS_THREE_PL`.
- Harmless today: `three_pl` defaults `true` on all tiers, so the edge gate passes for every live org, and the server stays authority (still 404s if it were ever off).
- Surfaces that are already edge-safe converge FE and edge: `vendors-api`, `invoicing-api`, `finance-api` are UNGATED; `sales-config-api` and `crm-api` are OR-gated `anyOf([three_pl, manufacturing, copack_ecom])`. So `/purchasing/*`, `/catalog/items`, `/catalog/vas`, `/settings/sales-config/*` are fully consistent once ungated.

Filed as follow-up `F-Wave10-SPINE-EDGE-GATE-RECONCILE-01` (edge work, out of this FE scope).

## Target route map (Scheme A)

Every moved path keeps its full variant set (`/new`, `/:id`, `/:id/edit`, `/:id/send`). Class: SPINE = backbone, SHARED = shared building block. Edge: serving bundle and its current gate.

| Old path (base) | New path (base) | Class | Edge bundle / gate |
|---|---|---|---|
| `/3pl-operations/quotes` | `/quotes` | SPINE | quotes-api / hard three_pl (diverges, see flag) |
| `/3pl-operations/projects` | `/projects` | SPINE | projects-api / hard three_pl (diverges) |
| `/3pl-operations/vendors` | `/purchasing/vendors` | SPINE | vendors-api / UNGATED |
| `/3pl-operations/purchase-orders` | `/purchasing/purchase-orders` | SPINE | vendors-api / UNGATED |
| `/3pl-operations/vendor-bills` | `/purchasing/vendor-bills` | SPINE | vendors-api / UNGATED |
| `/3pl-operations/expenses` | `/purchasing/expenses` | SPINE | vendors-api / UNGATED |
| `/3pl-operations/payments/new` | `/invoicing/payments/new` | SPINE | invoicing-api / UNGATED |
| `/3pl-operations/credit-notes/new` | `/invoicing/credit-notes/new` | SPINE | invoicing-api / UNGATED |
| `/3pl-operations/items` | `/catalog/items` | SHARED | sales-config-api / OR |
| `/3pl-operations/boms` | `/catalog/boms` | SHARED | inventory-api / hard three_pl (diverges) |
| `/3pl-operations/vas` | `/catalog/vas` | SHARED | sales-config-api / OR |
| `/3pl-operations/warehouses` | `/inventory/warehouses` | SHARED | inventory-api / hard three_pl (diverges) |
| `/3pl-operations/stock/levels` | `/inventory/stock/levels` | SHARED | inventory-api / hard three_pl (diverges) |
| `/3pl-operations/stock/movements` | `/inventory/stock/movements` | SHARED | inventory-api / hard three_pl (diverges) |
| `/3pl-operations/sales-config/*` | `/settings/sales-config/*` | SHARED | sales-config-api / OR |

Stay put, gated `plugins.three_pl` (true 3PL add-on): `/3pl-operations/receiving*`, `/3pl-operations/shipments*`, and the `/3pl-operations/production*` entries (two `LegacyProductionRedirect` aliases to `/manufacturing/runs*` plus the real `/3pl-operations/production/:id` detail, all per the prior operator decision).

De-dup note: verify whether `/invoicing/credit-notes/new` already exists. If it does, keep one canonical entry and redirect the old `/3pl-operations/credit-notes/new`; if not, add it as canonical. `/3pl-operations/payments/new` is the only payments-create surface not already under `/invoicing`.

## Redirect mechanism

One generic redirect component, registered once per moved old path pattern. Follows and supersedes the `LegacyProductionRedirect.tsx` precedent.

- New module `apps/web/src/pages/_redirects/SpineMoveRedirect.tsx` exporting `SpineMoveRedirect` plus a `REDIRECT_PREFIX_MAP` (old base to new base). The component reads `useLocation()`, longest-prefix-matches the old base, computes the new pathname by prefix replacement, and returns `<Navigate to={{ pathname, search, hash }} replace />`. This preserves `:id`/`:lineId`, query string, and hash for free (the static-target precedent does not).
- For each moved path pattern, the OLD entry's `element` is swapped to `SpineMoveRedirect` and a NEW entry with the real lazy page element is added at the new path. Net plus one route per moved pattern; `ROUTES = RAW_ROUTES.map(withPluginGate)` stays 1:1 so `routes.test.ts:181` still holds.
- Keeping the old paths registered (as redirects) is what lets the link-literal sweep be incremental without tripping canon-steward orphan-link.

Why not a single `/3pl-operations/*` splat: react-router v6 specificity would let the surviving static routes win, but the splat literal would not satisfy canon-steward orphan-link for un-migrated `<Link to="/3pl-operations/...">`, and it cannot be selectively ungated. Per-old-path entries keep every guard green mid-transition.

## inferPluginForPath rewrite

- Add `isRedirect?: boolean` to `RouteSpec` (`routes.ts:32`).
- `inferPluginForPath` early-returns `undefined` when `spec.isRedirect` (so the moved-path redirect entries that live under `/3pl-operations/*` are never plugin-gated, and old deep links survive even for a future `three_pl`-off org).
- Otherwise unchanged in shape: `/3pl-operations` to `three_pl` (now covering only receiving/shipments/production), `/manufacturing`, `/kitcost`, `/copack`, `/kitforce` unchanged. The new spine roots (`/quotes`, `/projects`, `/purchasing`, `/catalog`, `/inventory`, `/settings`) are absent from the gated list, so they return `undefined` (ungated).
- Update the function docstring (`routes.ts:1322`) to state that `/3pl-operations/*` now holds only the true 3PL add-on surfaces and that spine domains moved to neutral roots.

## File-by-file changes

- `apps/web/src/routes.ts`: add `isRedirect` to `RouteSpec`; rewrite moved `path:` literals to new roots; swap moved old entries to `SpineMoveRedirect` (set `isRedirect: true`); add new-path entries reusing the existing lazy page imports (imports keep pointing at `pages/3pl-operations/*`, per decision 3); add canonical `/invoicing/payments/new` (plus `/invoicing/credit-notes/new` if absent); update `inferPluginForPath`.
- `apps/web/src/routes.test.ts`: reframe "every /3pl-operations/* route carries three_pl" to "every NON-redirect /3pl-operations/* route carries three_pl"; swap the vanished `/3pl-operations/{quotes,projects,items,warehouses}` cases in the `inferPluginForPath`/`withPluginGate` blocks to surviving add-on paths (`/3pl-operations/receiving`, `/3pl-operations/shipments`); add positive `undefined` assertions for the new spine roots; keep "non-pillar routes are not accidentally gated" (it actively protects the goal) and add the new roots to it.
- `apps/web/src/components/shell/sidebarModes.ts` (plus `sidebarModes.test.ts`): rewrite the roughly 13 moved path strings to new roots (SELL quotes; MAKE projects plus boms; SHIP stock; LIBRARY items/warehouses/vendors/POs/bills/expenses). Receiving/shipments stay. No `requiresFlag` changes needed (spine entries never carried one). Update the corresponding `toContain` and `findActiveMode` assertions. `sidebarGating.test.ts` has no path literals (no change).
- `scripts/canon-steward-allowlist.txt`: re-point the existing `/3pl-operations/sales-config/*` and `/3pl-operations/vas` snippets to the new `/settings/sales-config/*` and `/catalog/vas` (still orphan-by-design deep settings); add orphan-route allowlist entries (with a follow-up reason, mirroring the existing production block) for the moved OLD list bases now served as redirects: quotes, projects, vendors, purchase-orders, vendor-bills, expenses, items, boms, warehouses, stock/levels, stock/movements. The `/new` and `/:id` redirect variants are auto-exempt. `scripts/canon-steward-check.mjs` needs no prefix/suffix edits (its public-path and create/action exemptions do not move).
- `apps/web/src/pages/dashboardWorkCards.ts` (plus test): `/3pl-operations/quotes?state=submitted` to `/quotes?...`; `/3pl-operations/items/new` to `/catalog/items/new`; `/3pl-operations/quotes/new` to `/quotes/new`. (`/manufacturing/runs?...`, `/invoicing/invoices?...`, `/3pl-operations/shipments?status=picking`, `/crm/customers/new`, `/admin/members` unchanged.)
- Link-literal sweep (roughly 325 occurrences across roughly 89 files): ripgrep per old prefix, domain by domain. Hit centralized builders first (`lib/hooks/useQuotes.ts` navigate-to-project; `components/data/EntityLabel.tsx` entity-to-URL map; `pages/3pl-operations/projects/projectChildLinks.ts`; CRM detail pages linking into quotes/projects; `ManufacturingHomePage.tsx`), then each `pages/3pl-operations/<domain>/` folder's list/detail/create literals. `NextStepCTA` and `Breadcrumbs` hardcode nothing (paths arrive as props), so they ride the per-page sweep. Receiving/shipments/production literals are untouched.
- Data-driven, NOT this change (follow-ups): `supabase/functions/search-api/index.ts` hardcodes `/3pl-operations/quotes/:id` and `/3pl-operations/projects/:id` result hrefs (edge; redirects catch the clicks), tracked as `F-Wave10-SEARCH-API-REROUTE-HREF-01`. `GlobalSearchBar.tsx` navigates to API-provided `href` (no FE literal).

## Sequencing into always-green commits

Each commit must pass: typecheck, lint (max-warnings 0), `pnpm -C apps/web test` (unit plus regression incl. canon-steward), build, size-limit.

1. Scaffolding, no URL moves. Add `RouteSpec.isRedirect`; `inferPluginForPath` redirect opt-out; create `SpineMoveRedirect` plus a near-empty `REDIRECT_PREFIX_MAP`; reframe the `routes.test.ts` gating test; add a `SpineMoveRedirect.test.ts`. Zero paths move, so sidebar/canon-steward/links stay untouched and green.
2 through N. One commit per domain, smallest blast radius first: `/inventory/*` (warehouses, stock, boms), then `/catalog/*` (items, vas), then `/settings/sales-config/*`, then `/purchasing/*` (vendors, POs, bills, expenses), then `/quotes`, then `/projects`, then `/invoicing/*` (payments/new, credit-notes/new). Each commit atomically: rename new paths, add redirects (extend `REDIRECT_PREFIX_MAP`), update sidebar (plus tests), sweep that domain's literals and the centralized builders pointing into it, update allowlist, run the full gate.
3. Cleanup. Refresh stale header comments, write the closeout journal entry, file the follow-ups, and update STATUS.md.

Ordering hazards handled by atomicity: canon-steward orphan-route (new list route must be sidebar-reachable, old redirect must be allowlisted) and orphan-link (new literal must have its new route registered) are all satisfied within the same domain commit.

## Follow-ups to file

- `F-Wave10-SPINE-EDGE-GATE-RECONCILE-01`: widen quotes-api/projects-api/inventory-api edge gates so the spine is truly always-on server-side.
- `F-Wave10-SEARCH-API-REROUTE-HREF-01`: update search-api result hrefs to new paths.
- `F-Wave10-SPINE-PAGE-DIR-RELOCATE-01` (optional): `git mv` page dirs to mirror new URLs.
- `F-Wave10-LEGACY-PRODUCTION-REDIRECT-MIGRATE-01` (optional): fold the two `LegacyProductionRedirect` aliases into the generic `SpineMoveRedirect`.

## Verification

- Per-commit gate: `pnpm -C apps/web typecheck`, `pnpm -C apps/web lint`, `pnpm -C apps/web test`, `node scripts/canon-steward-check.mjs`, `pnpm -C apps/web build`, `pnpm -C apps/web bundle-budget`. Run `pnpm -C apps/web test:contract` once (byte-mirror parity is unaffected by routing, but confirm).
- New unit coverage: `SpineMoveRedirect.test.ts` asserts param plus query plus hash preservation and the prefix map (mirroring `LegacyProductionRedirect.test.ts`); `routes.test.ts` asserts new spine roots are ungated and old paths are registered redirects.
- Manual (dev server): hit an old deep link with params plus query, for example `/3pl-operations/quotes/abc?state=submitted`, and confirm a `replace` redirect to `/quotes/abc?state=submitted`; confirm sidebar links target the new roots; confirm a `three_pl`-on org still loads every moved surface; confirm `/3pl-operations/receiving` and `/3pl-operations/shipments` still gate when `three_pl` is off.

## Brand voice on disk

No em dashes, no double hyphens, no emojis in any code, comment, commit, journal, or allowlist text.
