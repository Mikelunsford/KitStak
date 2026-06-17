# UI/UX reconfiguration phase 2: the structural bundle

Date: 2026-06-16. Scope: the structural follow-on to the 0.20.0 quick wins. Six SPA-only PRs (#308 to #313), all squash-merged to main and live on prod. CHANGELOG 0.21.0.

## Why this bundle exists

The 0.20.0 quick wins shipped the easy, non-reversing UI/UX deltas. The operator verified them, then asked what was left to complete the dropped reconfiguration plan. The honest answer was: the structural items, two of which would reverse decisions locked earlier the same day. The operator reopened both and chose to bundle the rest, choosing "I build all, you merge" for the run.

Two reopened, previously-locked decisions:

- The morning hybrid-nav choice (keep the pillar grouping from #249, defer the task re-key) was reversed in favor of the full task-based re-key.
- UX-Q7 (the StateStepper lifecycle rail is display-only) was reversed in favor of Pattern D, an interactive next step.

Both reversals are recorded in operator memory so a future session does not "fix" them back to their earlier locked state.

## What shipped

All six are presentation layer only: no schema, migration, RLS, money, idempotency, audit_log, or contract change.

- **#308 task-based navigation** (`f43685b`, F-UIUX-TASK-IA-REKEY-01). The sidebar re-keys from seven pillar sections to eight task groups (Sell, Buy, Inventory and Warehouse, Production and Fulfillment, Money, Workforce, Insights, Settings) in `sidebarModes.ts` and `Sidebar.tsx`. All fifty-six nav entries are remapped with zero URL changes, because the sidebar layer owns grouping and `routes.ts` is the untouched flat source of truth. Sections are role-scoped on a representative read capability via the new pure `isModeVisible`, chosen over write caps so read-only roles keep access (verified against the real canon: viewer keeps read; Workforce correctly hides from sales and viewer). Settings folds the former hardcoded Admin block behind an owner or admin gate. Default-open is by role. The breadcrumb eyebrow taxonomy decoupled from the sidebar (it is now an independent domain axis; `taxonomy.ts` values unchanged, the R-W13-IA-01 test relaxed). Code-reviewed (warning then fixed, zero critical).
- **#309 credit-note Apply CTA** (`b89a68f`, F-UIUX-CREDIT-NOTE-APPLY-CTA-01). Surfaces the existing apply route on the detail when the note is issued with positive remaining balance and the caller holds `credit_notes.apply`, via a pure, unit-tested gate helper.
- **#310 command-palette action verbs** (`8798f3c`, F-UIUX-PALETTE-VERBS-01). Verbs unify with entity matches on a new `CommandRow` type (the canon `SearchResultItem` is enum and UUID constrained and cannot carry a verb). `CommandBar` is lazy-split in `AppShell`; it now pulls `useCapabilities`, which would otherwise fold the capability matrix into the eager index chunk and breach the budget (the same fix the Create menu took). Index dropped to 35.7 kB gz.
- **#311 shared RelatedSection and vendor hub tabs** (`e6912b7`, F-UIUX-HUB-TABS-ROLLOUT-01). The inline related-records section from the customer hub is extracted to one shared `components/shell/RelatedSection`; the customer hub refactors onto it and the vendor hub moves to tabs.
- **#312 interactive lifecycle rail** (`e8a4542`, Pattern D, UX-Q7 reopened). `StateStepper` gains an optional `onAdvance`; the immediate next step becomes a button that advances through the page's existing handlers. Backward-compatible: with no `onAdvance` the rail is display-only and byte-identical to before, so the other detail pages are untouched. Wired on the quote hub. Code-reviewed APPROVE (zero critical or high).
- **#313 next-step toast on quote create** (`a9303dd`, Pattern A, F-UIUX-TOASTS-01). A shared `nextStepToast` helper over sonner plus a pure, context-aware quote-created message (add lines, or send for approval when lines were staged).

## Scope discipline: flagship first, long tail deferred

Each structural surface shipped on its flagship page with the rest deferred to scoped follow-ups, rather than a risky blanket sweep across dozens of pages:

- Hub tabs: vendor only. Project is an 800-line page with dnd-kit phases and a DetailLayout rail (F-UIUX-HUB-TABS-PROJECT-01); member needs a server-side `member_id` list filter, which belongs in the held backend pass (F-UIUX-HUB-TABS-MEMBER-01); sales order and manufacturing run are leaf pages, not related-record hubs (F-UIUX-HUB-TABS-LEAF-01).
- Interactive rail: quote only. The invoice happy path has a skip-state (pending) and amount-entry steps (payments via modal) that do not fit a one-click advance, so it needs per-page handling (F-UIUX-RAIL-ROLLOUT-01).
- Toasts: quote create only (F-UIUX-TOASTS-ROLLOUT-01).
- Nav: per-route cap gating (F-UIUX-NAV-ROLE-SCOPE-PERROUTE-01) and optional eyebrow re-alignment to task groups (F-UIUX-EYEBROW-TASK-ALIGN-01).

Still held for a gated backend pass, per the operator's SPA-only choice: the tax and payment-method default-for-org checkbox, auto-numbering for credit notes and journal entries, and the inline draft-line UPDATE endpoint.

## Engineering notes

- **Conflict-free by partition.** Because the operator merges, the six were built off main on disjoint files so they merge in any order with no conflicts. The one real risk, the rail (#312) and hub tabs (#311) both wanting the same detail pages, was avoided by scoping the rail to non-hub pages and giving the hub pages to #311; the rail owns `StateStepper` and the quote page, the hubs own the customer and vendor pages.
- **Index budget.** Every PR held the index chunk under the 40 kB `size-limit`. The palette PR repeated the #303 lesson: wiring `useCapabilities` into an eager shell component folds the capability matrix into index; the fix is a lazy boundary on the consumer.
- **Grounding before building.** The bundle started with four parallel read-only Explore agents mapping the nav, state-machine, hub-tabs, and palette surfaces, plus the role canon, so the design was grounded in the real architecture (for example, the nav grouping lives entirely in the sidebar layer, not in `routes.ts`, which is what made the zero-URL-change re-key possible).
- **Tooling.** The Git Bash tool hit a recurring `add_item` fatal error (exit 5) on heavy node and some git operations this session; the PowerShell tool was used for git and vitest instead.

## Verification

All six passed the full gate set locally (typecheck, lint at max-warnings 0, 716 tests plus 2 skipped, contract, build, size-limit) and on CI. The prod deploy is green: the latest `ci` and `deploy-prod` on `main` both succeeded (the rapid merges left earlier runs concurrency-cancelled; the final run carries all six commits).

Constitutional invariants verified across the bundle: no URL change (deep links preserved); no money, RLS, idempotency, or audit_log change; the SPA mirrors the role policy for hiding only, the server stays the authority; no em dashes, double hyphens, or emojis in user-facing copy.
