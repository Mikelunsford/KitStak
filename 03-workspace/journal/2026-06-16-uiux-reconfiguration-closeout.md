# UI/UX reconfiguration closeout 2026-06-16

One-line: a dropped whole-app UI/UX reconfiguration spec was verified to be roughly seventy percent already built; the verified delta shipped as six SPA-only quick-win PRs, all merged to prod and operator-verified, with the larger structural items deferred by the operator's quick-wins-only scope.

## The verification that shaped the work

The spec (`KitStak-UIUX-Reconfiguration-Plan-2026-06-16.md`, dropped in the repo root) was reviewed against the code before any build, using three parallel code-grounding passes plus two design passes. The headline finding was that most of what it asked for already existed:

- P2 "spine collapsed by default" was false. `Sidebar.tsx` `defaultExpanded()` expanded every section on first load.
- P3 and P4 "detail pages are read-only attribute dumps, only Download PDF" was false. `QuoteDetailPage` and `InvoiceDetailPage` already render state-driven action bars (Send for approval, Approve, Request revise, Convert to project, Receive payment) gated by `canTransition`, plus next-step CTAs.
- P5 "hubs have no spokes" was false. `CustomerDetailPage` already rendered six related-record sections with quick-create and empty-state coaching.
- The command palette already existed (the hand-rolled Cmd or Ctrl-K `CommandBar`), the dashboard work queue already existed (`WorkCardGrid`), and the empty-state coaching already existed.
- Pattern D (an interactive lifecycle rail) was excluded because it reverses the locked UX-Q7 display-only decision for `StateStepper`.
- The spec also invented a "purchasing" role that does not exist in the eight-role canon.

The operator chose quick wins only for the build, hybrid for navigation (keep the pillar grouping from PR #249, defer the full task re-key), and Tabs primitive plus customer hub only for the hub work.

## What shipped this session

All six are SPA-only (presentation layer), no schema, no migration, no RLS, money, idempotency, audit_log, or contract change. All squash-merged to `main`; the prod deploy is green.

- **#300 (`01a4d60`) fix: detail-subtitle name resolution.** Quote, invoice, and project detail subtitles no longer flash the raw foreign-key UUID on first paint; they use the existing `fallbackLabel` helper (already imported on those pages for breadcrumbs). Six call sites across three files.
- **#301 (`e432ed1`) refactor: dashboard hero trim.** The oversized marketing hero shrank to a compact operational page title; `WorkCardGrid` and the setup checklist are unchanged.
- **#302 (`e775b7a`) feat: sidebar lighter wins.** `defaultExpanded()` opens only the SPINE backbone on first load; a type-to-filter box narrows the nav (new pure `filterRoutesByQuery` helper, unit-tested); the Admin block is hidden for non-admins via `useCapabilities`, mirroring `AdminProtectedRoute` (cosmetic dead-link cleanup, the route guard stays authoritative). Also derived the persisted-expanded allow-list from `SIDEBAR_MODES`, closing a latent omission of the `wms` key.
- **#303 (`ed0393d`) feat: topbar search and create menu.** A visible Search button opens the existing command palette; an entitlement-scoped Create menu surfaces only the create actions the caller can both perform and reach (new pure `createMenuActions` registry plus `visibleCreateActions`, unit-tested). The Create menu is lazy-split into `CreateMenu.tsx` so the capability matrix stays out of the eager index chunk.
- **#304 (`f76dbd4`) feat: Tabs primitive.** A hand-rolled, dependency-free, accessible, URL-synced `components/ui/Tabs.tsx` (WAI-ARIA tabs pattern, roving tabindex, arrow / Home / End, automatic activation). Pure helpers `resolveActiveTabKey` and `nextTabIndex` are unit-tested.
- **#306 (`d19bb14`) feat: customer hub on tabs.** `CustomerDetailPage` Overview plus six related sets rendered as tabs, reusing the existing `RelatedSection` panels verbatim. Replaced the auto-closed #305 (see below).

## Two notes for the record

**Bundle catch on #303.** Wiring `useCapabilities` into the eager Topbar folded the capability matrix into the index chunk and pushed it to 41.9 kB gz, over the 40 kB `size-limit` budget. The fix lazy-split the Create menu into its own `CreateMenu.tsx` chunk (the same discipline that keeps the Sidebar lazy); the index returned to 38.65 kB gz. Index headroom is now tight, about 1.4 kB; the PROJECT.md 29.95 kB figure was stale.

**Stacked-PR close on #305.** #305 (customer hub tabs) was based on the #304 Tabs primitive branch. When #304 was squash-merged and its branch deleted, GitHub auto-closed #305 because its base branch vanished. The single-file change was cherry-picked onto fresh `main` (which now carries the Tabs primitive) and re-opened as #306, which merged clean. Lesson: merge stacked PRs bottom-up and hold off deleting the parent branch until the child is in, or merge the child first.

## Repo and prod state at closeout

- `main` at `d19bb14`. No migration change this batch; prod schema is unchanged (at max 0118 from the earlier SSO MVP).
- Prod deploy green: latest `deploy-prod`, `ci`, and `CodeQL` runs on `main` all succeeded.
- All six feature branches pruned; the throwaway `claude/uiux-review-all` integration branch was deleted.
- Working tree carries only the pre-existing untracked root files (`audit-output/`, `.claude/audits/`, the dropped `KitStak-*-2026-06-16.md` companion docs, `deno.lock` files), none of them from this batch.

## Open follow-ups (deferred; operator chose to wind down)

- `F-UIUX-TOASTS-01`: Pattern A next-step success toasts via a lazy Sonner wrapper.
- `F-UIUX-PALETTE-VERBS-01`: command-palette action verbs alongside entity search.
- `F-UIUX-INLINE-LINES-01`: inline draft line-item editing on quote and invoice (verify a quote-line UPDATE endpoint exists; may need backend).
- `F-UIUX-CREDIT-NOTE-APPLY-CTA-01`: surface Apply on the credit-note detail (pairs with `F-Wave10-CREDIT-NOTE-APPLY-FSM-01`).
- `F-UIUX-TASK-IA-REKEY-01`: the full pillar to task-group nav re-key, bundled with a future capability wave.
- `F-UIUX-HUB-TABS-ROLLOUT-01`: extend tabs to the vendor, project, order, run, and member hubs as their spokes are built.
- Backend or approval-gated: auto-numbering for credit notes and journal entries; make the tax and payment-method default-for-org checkbox effective.

Found doc-lag (not this batch): the CHANGELOG `[Unreleased]` block and the top of STATUS.md still describe the SSO store-metadata MVP (#298) as built and held, not on prod, but #298 is merged and live (commit `4883885`, migration 0118). Recommend reconciling that entry separately.

## Verification carried out this session

Per PR, run green before each merge: `pnpm typecheck` (strict), `pnpm lint` (max-warnings 0), `pnpm test` (the unit and regression suites, including the new `filterRoutesByQuery`, `visibleCreateActions`, and `Tabs` helper cases), `pnpm build`, and `size-limit` (SPA index held under the 40 kB budget; 38.46 kB gz at the final baseline, 38.65 kB gz with the topbar Search button on #303). `test:contract` and `test:rls` were unaffected (no byte-mirror or RLS change). CI and CodeQL were green on every PR; the prod deploy succeeded after each merge. The operator clicked through the combined branch and confirmed the changes.
