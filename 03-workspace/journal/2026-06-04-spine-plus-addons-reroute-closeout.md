# Spine plus add-ons SPA re-route (Phase 1) closeout

Date: 2026-06-04. Branch: `claude/vigorous-stonebraker-24d5df`. Scope: front end only.
Plan: `03-workspace/plans/2026-06-04-spine-plus-addons-reroute.md`.

## What and why

The white-paper V2 reframes Kitstak as one spine plus composable add-ons. The SPA contradicted that: spine backbone surfaces (quoting, projects, vendors, POs, bills, expenses) and shared building blocks (catalog/items, BOMs, VAS, inventory/stock, warehouses, sales-config) lived under the plugin-gated `/3pl-operations/*` namespace, so `inferPluginForPath` gated them all on `plugins.three_pl`. That only worked because `three_pl` defaults on for every tier.

This re-route moves those surfaces to neutral, always-ungated roots and leaves only the true 3PL add-on surfaces (receiving, shipments, and the production redirects) under `/3pl-operations/*`.

## Target map (Scheme A, operator-approved)

| Old | New |
|---|---|
| `/3pl-operations/quotes*` | `/quotes*` |
| `/3pl-operations/projects*` | `/projects*` |
| `/3pl-operations/vendors*`, `/purchase-orders*`, `/vendor-bills*`, `/expenses*` | `/purchasing/*` |
| `/3pl-operations/items*`, `/boms*`, `/vas*` | `/catalog/*` |
| `/3pl-operations/warehouses*`, `/stock/*` | `/inventory/*` |
| `/3pl-operations/sales-config/*` | `/settings/sales-config/*` |
| `/3pl-operations/payments/new`, `/credit-notes/new` | `/invoicing/payments/new`, `/invoicing/credit-notes/new` |
| `/3pl-operations/receiving*`, `/shipments*`, `/production*` | unchanged (true 3PL add-on, stays gated) |

## Mechanism

- `RouteSpec.isRedirect` added. `inferPluginForPath` returns undefined for redirect entries, so a legacy path under the gated prefix still redirects to its ungated spine home instead of rendering NotFound when the plugin is off.
- One generic `apps/web/src/pages/_redirects/SpineMoveRedirect.tsx` rewrites the leading prefix per `REDIRECT_PREFIX_MAP` and preserves dynamic segments, query string, and hash. Registered once per moved old path (about 50 redirect entries), supersedes the static-target `LegacyProductionRedirect` precedent.
- `inferPluginForPath` rewritten so only true add-on namespaces gate; spine roots fall through to undefined (ungated).

## Commits (all green on typecheck, lint max-warnings 0, 438 unit+regression tests, canon-steward, build, size-limit)

1. `e43cf46` redirect scaffolding (isRedirect, SpineMoveRedirect, reframed routes.test.ts). No URL moves.
2. `77ffac2` `/inventory/*` (warehouses, stock).
3. `0c5a3d6` `/catalog/*` (items, BOMs, VAS).
4. `f625bd4` `/settings/sales-config/*`.
5. `4fd8195` `/purchasing/*` (vendors, POs, bills, expenses).
6. `69df38e` `/quotes`.
7. `0ab92b9` `/projects`.
8. `1a89b90` `/invoicing` payments and credit-notes create surfaces.
9. (this) cleanup, journal, follow-ups.

Index chunk held at about 38 kB gzip across the wave (40 kB budget). Redirect entries are tiny and lazy.

## Constitutional posture

No hard violation. Flat ROUTES table preserved, lazy splits preserved, no banned deps, 404-not-403 plugin-gate behavior preserved, nothing touched edge functions, migrations, money, audit, or idempotency. The one documented divergence (SPA ungates quotes/projects/inventory while their edge bundles still hard-gate three_pl) is harmless today and filed as `F-Wave10-SPINE-EDGE-GATE-RECONCILE-01`.

## Open follow-ups

- `F-Wave10-SPINE-EDGE-GATE-RECONCILE-01` (edge): widen quotes-api, projects-api, inventory-api gates so spine is always-on server-side.
- `F-Wave10-SEARCH-API-REROUTE-HREF-01` (edge): update search-api result hrefs to new paths; `search-api-href-routes.test.ts` locks the old prefix until then.
- `F-Wave10-SPINE-REROUTE-REDIRECT-RETIRE-01`: retire the SpineMoveRedirect entries plus allowlist rows once bookmark analytics are clear.
- `F-Wave10-SPINE-PAGE-DIR-RELOCATE-01` (optional): relocate page dirs to mirror new URLs.
- `F-Wave10-LEGACY-PRODUCTION-REDIRECT-MIGRATE-01` (optional): fold LegacyProductionRedirect into SpineMoveRedirect.

## Verification carried out

Per-commit: `pnpm -C apps/web typecheck`, `pnpm -C apps/web lint`, `pnpm -C apps/web test`, `node scripts/canon-steward-check.mjs`, `pnpm -C apps/web build`, `pnpm -C apps/web bundle-budget`, all green at each commit. New `SpineMoveRedirect.test.ts` covers param, query, and hash preservation, segment-boundary matching, and the unmapped-path passthrough. A final tree sweep confirmed no stray `/3pl-operations/<moved-domain>` UI literals remain; the only residual references are lazy import file paths (page files stayed put), the redirect entries, the prefix map and its test, the two `formatQuoteStateLabel` module imports, one historical comment in `ReceivePaymentModal`, and the edge-contract `search-api-href-routes.test.ts`.

Not yet run (deferred to operator or follow-up): Playwright E2E (`pnpm -C apps/web test:e2e`, needs a running app), and a manual dev-server deep-link spot check.
