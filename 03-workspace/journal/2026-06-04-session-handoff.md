# Session handoff 2026-06-04 (spine plus add-ons re-route)

One-line: shipped the white-paper V2 "spine plus add-ons" SPA re-route. Spine and shared building blocks are no longer gated by `plugins.three_pl`. Merged to main, CI green.

## What shipped this session

PR #247, squash-merged to `main` as `a57b6ea`, remote branch deleted.

Spine backbone (quoting, projects, vendors, POs, vendor bills, expenses) and shared building blocks (items, BOMs, VAS, inventory, warehouses, sales-config) moved out of the plugin-gated `/3pl-operations/*` namespace to neutral, always-ungated roots. Only the true 3PL add-on (receiving, shipments, production redirects) stays gated. `inferPluginForPath` now gates only true add-on namespaces. Every old deep link survives via the generic `SpineMoveRedirect`.

Detail: `03-workspace/journal/2026-06-04-spine-plus-addons-reroute-closeout.md`.
Plan: `03-workspace/plans/2026-06-04-spine-plus-addons-reroute.md`.
STATUS.md: new dated entry at the top with the full follow-up list.
Cross-session memory: `spine_plus_addons_reroute.md`.

## Repo state at handoff

- `main` at `a57b6ea` (this re-route is the latest commit).
- This docs handoff lands on a separate small branch `claude/spine-reroute-handoff`.
- Local worktree `vigorous-stonebraker-24d5df` is still checked out to the now-merged feature branch (local ref retained, remote deleted). Safe to prune at the next session-start sync-and-clean.
- No migrations, no edge changes, no money/audit/idempotency changes this session.

## Open follow-ups (priority order)

1. `F-Wave10-SPINE-EDGE-GATE-RECONCILE-01` (edge, the meaningful one): `quotes-api`, `projects-api`, `inventory-api` still hard-gate `plugins.three_pl` while their SPA surfaces are now ungated spine. Harmless today because `three_pl` defaults on for every tier, so the server gate always passes. Widen to an anyOf predicate or ungate so the spine is truly always-on server-side. This is the natural next move if an org ever needs `three_pl` off.
2. `F-Wave10-SEARCH-API-REROUTE-HREF-01` (edge): search-api still emits `/3pl-operations/quotes/:id` and `/projects/:id` result hrefs. Redirects catch the clicks today. `apps/web/test/regression/search-api-href-routes.test.ts` deliberately locks the old prefix; update it together with the edge change.
3. `F-Wave10-SPINE-REROUTE-REDIRECT-RETIRE-01`: retire the ~50 `SpineMoveRedirect` entries and their canon-steward allowlist rows once bookmark analytics confirm no live traffic on the old `/3pl-operations/*` spine paths.
4. `F-Wave10-SPINE-PAGE-DIR-RELOCATE-01` (optional): relocate page directories from `pages/3pl-operations/*` to mirror the new URLs. Files stayed in place this phase by design.
5. `F-Wave10-LEGACY-PRODUCTION-REDIRECT-MIGRATE-01` (optional): fold the two `LegacyProductionRedirect` components into the generic `SpineMoveRedirect`.

## Suggested next-session focus

- If continuing this thread: the edge gate reconcile (item 1) plus the search-api href update (item 2) are a clean paired edge session.
- Verification not yet run: Playwright `pnpm -C apps/web test:e2e` and a manual dev-server deep-link spot check (e.g. `/3pl-operations/quotes/abc?state=submitted` should land on `/quotes/abc?state=submitted`).
- Unrelated parked threads still open: the 3PL Job Builder / WMS pivot planning and the sidebar pillar-reorg (both distinct from this IA re-route), and the prior FK cross-tenant fix PR #238 thread.

## Verification carried out this session

Per-commit and on the merged PR: typecheck, lint (max-warnings 0), 438 unit + regression tests, canon-steward, build, size-limit (index chunk about 38 kB gzip against the 40 kB budget), and contract byte-mirror parity. CI on PR #247 was green (build, CodeQL, Vercel preview).
