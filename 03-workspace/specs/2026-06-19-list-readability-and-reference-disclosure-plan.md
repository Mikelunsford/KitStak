# List readability and reference-number disclosure. UI plan (draft for approval)

Status: DRAFT for operator approval. Date: 2026-06-19. Author: build agent.
Feature flag: see Open decision A1 (recommend branch plus staging validation, no flag).

Operator feedback that drives this plan, from the Quotes screen review:

1. The screens read busy, and the numerals are hard to focus on. The 0 in particular is
   hard to recognize. Cause: data numerals render in JetBrains Mono (`font-mono` is
   applied in 101 places), whose dotted zero is the legibility complaint.
2. The hyperlink look (underlined names on customer, project, and the rest) adds noise.
   Titles of quotes and projects, and the names of actions, should read as bold text so
   the eye lands on what to click.
3. Reference numbers (`Q-2026-00008`, `PRJ-20260615-...`) should not sit on the main
   view. They belong under an "Additional details" disclosure.

This is presentational only. It introduces no architectural pattern, touches no money
helper, no RLS policy, no migration, no `audit_log`, and no banned dependency. JetBrains
Mono stays in the type system for code. The work concentrates in a few shared components,
then sweeps the per-page column configs.

## 1. Decisions resolved with the operator

- Scope: system-wide. Change the shared components once so every pillar's lists and detail
  pages inherit the look. The shared surfaces are `DataTable`, `EntityLabel`, the detail
  header and layout, and the title formatter.
- Reference numbers: a row expander on lists ("Additional details") plus a collapsible
  "Additional details" section on detail pages. Numbers stay reachable, never in the way.
- Number legibility: render data numerals in Inter Tight with tabular figures
  (`tabular-nums`), dropping `font-mono` from data. Tabular figures keep columns aligned.
  JetBrains Mono remains for code only.
- Delivery: this spec, executed via `/implement`, landing against the Definition of Done.

## 2. Scope

In scope:

- Number legibility across list and detail data cells.
- Removing the underlined-link treatment in favor of bold, clickable names and actions.
- Moving reference numbers off the main view into an "Additional details" disclosure on
  lists and a collapsible section on detail pages.
- One new hand-rolled `Disclosure` primitive in `components/ui`.
- The per-list-page column-config sweep across the roughly forty list pages.

Out of scope:

- Header cell styling. The mono uppercase table header is a deliberate brand treatment
  and the complaint is about numerals, not headers. Leave it unless the operator asks.
- Any data, schema, capability, or money change.
- Search behavior. Numbers stay indexed and searchable (see A4).

## 3. The shared-component changes

### 3a. Number legibility. `R-W14-READ-01`

- `apps/web/src/components/ui/DataTable.tsx`. The money and numeric cells are styled by
  callers with `cellClassName: 'font-mono'`. Replace that with `tabular-nums` (Inter Tight
  tabular figures). Keep the right alignment. `formatCents` output is unchanged.
- Sweep every list page column config and the detail pages for `font-mono` applied to a
  data numeral (reference numbers, totals, quantities, counts, dates rendered as digits)
  and switch each to `tabular-nums`. Leave `font-mono` only where it labels code, an env
  value, or a hash.
- Do not remove the `mono` token from `apps/web/tailwind.config.js`. It still backs code.
- No new Tailwind token is needed. `tabular-nums` is the built-in `font-variant-numeric`
  utility, and Inter Tight ships tabular figures.

### 3b. Remove the link look, bold the clickable text. `R-W14-READ-02`

- `apps/web/src/components/data/EntityLabel.tsx`. Every label renders as
  `<Link ... className="text-ink underline">`. Replace `text-ink underline` with a bold,
  no-underline, clickable treatment: `font-semibold text-ink hover:text-accent` plus a
  `focus-visible` ring. The weight plus the hover and focus color is the affordance now
  that the underline is gone (see Accessibility). Apply the same treatment to the plain
  text labels (`account`, `copack_warehouse`) so weight is consistent, keeping them
  non-clickable.
- List title columns. Today the row links through the number column and the title renders
  as plain text (for example `QuotesListPage` renders `q.title ?? '.'`). Invert that: the
  title becomes the primary clickable, bold element that routes to the row
  (`font-semibold text-ink hover:text-accent`, no underline). When the title is null, fall
  back to the reference number as the clickable label so no row is ever unclickable.
- Action text. Primary and secondary text actions ("New quote", "Save view", and the row
  and toolbar actions in `Button.tsx`, `SavedViewsBar.tsx`, `FilterBar.tsx`) render bold
  and rely on weight, color, and a focus ring rather than an underline. Do not underline.

### 3c. Hide reference numbers behind a disclosure. `R-W14-READ-03`

- `apps/web/src/lib/displayTitle.ts`. `formatCodeName(code, name)` currently returns
  `{code} · {name}`, which is why `EntityLabel` shows `PRJ-... · Northwind Welcome Kit Run`.
  Add `formatName(name)` that returns the name only, and keep `formatCodeName` for the
  Additional details surface that still wants both. Update `displayTitle.test.ts`.
- `EntityLabel` renders the name only (`formatName`), dropping the code prefix from the
  main view. The code travels to the Additional details disclosure.
- New primitive `apps/web/src/components/ui/Disclosure.tsx`. A hand-rolled collapsible: a
  labeled toggle button (`aria-expanded`, `aria-controls`) and a region, with a
  `lucide-react` chevron that rotates on open. No Radix, no headless library. One small
  unit test (`Disclosure.test.ts`) for the toggle and the aria wiring.
- `DataTable` gains an opt-in `renderRowDetails?: (row: T) => ReactNode`. When provided,
  each row renders a leading chevron toggle, and opening it reveals a details row spanning
  all columns that holds the "Additional details" content (the reference number, and any
  secondary codes such as a converted project's `PRJ-...`). Keep `DataTable` presentational
  and unit-testable: extend the pure view resolver and add a row-expansion state helper so
  the branch logic is covered without a DOM. Update `DataTable.test.ts`.
- Drop the dedicated `number` column from list configs. The number moves into
  `renderRowDetails`. Preserve sort-by-number by moving it to the toolbar sort menu (see
  `F-Wave14-READ-SORT-01`).

### 3d. Detail-page Additional details. `R-W14-READ-04`

- `apps/web/src/components/ui/DetailHeader.tsx` and `DetailLayout.tsx`. Move the reference
  number out of the title area into an "Additional details" `Disclosure` near the top of
  the detail body. Centralizing it here means every detail page inherits the change with no
  per-page edit. The title area leads with the human-readable name in the display style.

## 4. Per-list-page rollout. `R-W14-READ-05`

Apply one uniform transform to each list page column config under
`apps/web/src/pages/`. The pages, by pillar:

- 3PL Operations: accounts, billing-reviews, boms, credit-notes, expenses, invoicing,
  items, job-builders, job-runs, payments, production, projects, purchase-orders, quotes,
  receiving, shipments, supply-plans, vendor-bills, vendors, warehouses.
- Co-Pack: channels, fulfillments, kitting-jobs, sales-orders.
- CRM: activities, contacts, customers.
- Finance: journal-entries.
- KitForce: assignments, members, shifts, teams, time-entries.
- Manufacturing: manufacturing-runs.
- WMS: bin-stock, locations.

The transform per page:

1. Remove the `number` column from the `columns` array.
2. Make the title (or the entity's human name) the primary `<Link>`, bold, no underline,
   with the null-title fallback to the number.
3. Pass `renderRowDetails={(row) => ...}` that renders the reference number and any
   secondary reference (for example a converted project) inside the Additional details row.
4. Swap any `cellClassName: 'font-mono'` on a numeral to `tabular-nums`.

Batch the rollout one pillar per PR so each is reviewable.

## 5. Accessibility

Removing underlines lowers link affordance, and the e2e `@axe-core` gate runs on these
surfaces, so hold the line on:

- Non-color cues. Bold weight is a non-color cue that the text is a link, satisfying WCAG
  1.4.1. Keep a visible `focus-visible` ring and a hover color shift on every clickable
  name and action.
- Contrast. `text-ink` on `bg` and the accent hover state must meet AA. Verify after the
  token swap.
- Disclosure semantics. The toggle is a real button with `aria-expanded` and
  `aria-controls`, labeled "Additional details". The revealed region is keyboard reachable.
- Tabular figures preserve column scanning, so the alignment the mono cells gave is kept.

## 6. Constitution alignment

- No banned import. The `Disclosure` is hand-rolled with a `lucide-react` chevron, no Radix
  or headless library.
- No em dash, double hyphen, or emoji in any copy. The only new user-facing string is
  "Additional details". The `·` separator stays where both code and name are shown together.
- JetBrains Mono stays in the type system for code. This plan changes where mono is
  applied, it does not remove the token.
- Brand tokens only: `text-ink`, `text-accent`, `border-line`, the bg layers. No new color.
- No money, RLS, idempotency, or `audit_log` change. No migration. Nothing on the stop list.

## 7. Tests and Definition of Done

- Unit. `Disclosure.test.ts` (toggle, aria). `DataTable.test.ts` (the new
  `renderRowDetails` expansion, the row-expansion state helper). `displayTitle.test.ts`
  (`formatName`, `formatCodeName` unchanged). An `EntityLabel` render test (name only, bold,
  no underline).
- e2e plus axe. Extend the Playwright smoke to assert, on the Quotes list and one detail
  page, that the reference number is not visible until the Additional details disclosure is
  opened and is visible after, and that the axe sweep stays clean on both.
- Contract and parity. Unaffected. No `_shared` file changes. Confirm `pnpm test:contract`
  stays green.
- Gates. `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:contract`, `pnpm build`,
  `pnpm bundle-budget` (index chunk should not grow, the chevron is already bundled),
  `pnpm test:rls` and `pnpm test:e2e` per the staging-gated job, and `supabase db reset`
  unaffected.
- Docs. Update `docs/design/ui-wireframes.md` to describe the calmer list and the
  Additional details pattern. Append a CHANGELOG entry. Closeout journal at
  `03-workspace/journal/` when the rollout wave closes.

## 8. Risks and follow-ups

Risks (wave number to confirm against the active wave at implementation):

- `R-W14-READ-01`. Number legibility: mono to tabular figures across data cells.
- `R-W14-READ-02`. Remove the underline link look, bold the clickable titles and actions.
- `R-W14-READ-03`. Hide reference numbers behind the Additional details disclosure on lists.
- `R-W14-READ-04`. Detail-page Additional details section.
- `R-W14-READ-05`. Per-list-page column-config sweep across the roughly forty pages.

Follow-ups:

- `F-Wave14-READ-SORT-01`. Preserve sort-by-number after the number column is removed by
  moving it into the toolbar sort menu.
- `F-Wave14-READ-SEARCH-01`. Confirm number discoverability in search now that the number
  is not shown by default. The search still indexes number.
- `F-Wave14-READ-FLAG-01`. Optional feature flag for a staged rollout, if A1 chooses it.

## 9. Open decisions

- A1. Rollout control. Recommend a branch plus staging validation with Team 1, no feature
  flag, since the change is presentational and reversible. The heavier alternative is a
  `feature.calm_reads` flag mirroring the `feature.list_toolbar` precedent for a prod kill
  switch. Operator picks.
- A2. Money numerals. Recommend tabular Inter Tight for totals too, dropping mono from money
  entirely, since tabular figures align as well as mono. Confirm this is the desired look
  for currency.
- A3. Sort-by-number handle. Recommend moving it to the toolbar sort menu. Confirm that is
  acceptable, or keep a hidden sortable number affordance.
- A4. Search hint. Numbers stay searchable. Decide whether the search field should hint
  that you can still search by number now that it is not shown in the row.

## 10. Suggested sequence

1. Primitives PR. `Disclosure`, `displayTitle.formatName`, `DataTable` tabular numerals and
   `renderRowDetails`, with tests.
2. Link and action treatment PR. `EntityLabel` bold and name-only, action text bold.
3. Detail pages PR. `DetailHeader` and `DetailLayout` Additional details section.
4. List rollout PRs. One per pillar, applying the section 4 transform.
5. e2e and axe PR, then the closeout journal.
