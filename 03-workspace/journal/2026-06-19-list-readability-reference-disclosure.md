# Closeout: list readability and reference-number disclosure

Date: 2026-06-19. Risk family: `R-W14-READ-01`..`05`. Type: presentational only.
Plan: `03-workspace/specs/2026-06-19-list-readability-and-reference-disclosure-plan.md`.
Branch: `feat/list-readability-reference-disclosure`.

## Why

The Quotes-screen review surfaced three complaints: the screens read busy and the
numerals were hard to focus on (the JetBrains Mono dotted zero), the underlined
link look on entity names added noise, and reference numbers (`Q-...`, `PRJ-...`)
sat on the main view where they competed with the human name.

## Operator decisions taken

- A1 rollout: branch plus staging validation, no feature flag. Reversible by
  revert since the change is presentational.
- A2 money numerals: drop JetBrains Mono from money too. Currency totals now
  render in tabular Inter Tight, the same as the rest of the data numerals.
- A3 sort-by-number: deferred to `F-Wave14-READ-SORT-01` (toolbar sort menu).
- A4 search hint: deferred to `F-Wave14-READ-SEARCH-01`.

## What shipped

Shared foundation (every pillar inherits it):

- `components/ui/Disclosure.tsx`. Hand-rolled collapsible (lucide chevron, real
  button with `aria-expanded` / `aria-controls`, region hidden when closed). No
  Radix, no headless library. Pure `DisclosureView` plus a stateful wrapper.
- `components/data/ReferenceField.tsx`. One labeled reference row for the
  disclosure; value in `tabular-nums`; renders nothing when empty.
- `components/data/entityLabelStyles.ts`. `LINK_CLASS` / `PLAIN_CLASS`, the bold
  no-underline clickable treatment, shared by `EntityLabel` and list titles.
- `lib/displayTitle.ts`. New `formatName` (name only, no code prefix) for the
  main view; `formatCodeName` retained for the disclosure surface.
- `components/ui/DataTable.tsx`. New opt-in `renderRowDetails` adds a per-row
  Additional details expander (pure `ExpandableDataRowView` plus helpers
  `rowDetailsRegionId`, `bodyColSpan`). The table stays hook-free and directly
  callable, so the existing element-walk tests keep working.
- `components/data/EntityLabel.tsx`. Bold, name-only, no underline; hover and
  focus-visible color as the affordance.
- `components/ui/DetailHeader.tsx`. The reference number left the identity chip
  row for an Additional details `Disclosure`, plus the headline money moved off
  `font-mono` to `tabular-nums`.
- `components/ui/FilterBar.tsx`. The "Clear all" action de-underlined.

Per-page rollout (presentational, columns and styling only):

- All ~37 list pages across 3PL, Co-Pack, CRM, Finance, KitForce, Manufacturing,
  and WMS. Named entities lead with a bold title link and disclose the number;
  nameless transactional entities keep the number as the identity, restyled to
  tabular. Money, quantities, counts, and dates-as-digits moved to `tabular-nums`.
- ~53 detail and editor surfaces swept for `font-mono` data numerals (money,
  quantities, rates, dates) moved to `tabular-nums`; codes, identifiers, UUIDs,
  currency codes, account/tax codes, UOM tokens, and CSV mappings kept mono.
- Entity-name cross-links on detail pages (customer, project, invoice, vendor,
  lead, opportunity, member, and the rest) de-underlined to the shared bold
  treatment.

## Verification (Definition of Done)

- `npm run typecheck`: clean.
- `npm run lint` (`--max-warnings 0`): clean.
- `npm run test` (unit plus regression): 823 passed, 2 skipped.
- `npm run test:contract`: 47 passed. No `_shared` mirror touched.
- `npm run bundle-budget`: pass. SPA index chunk 37.14 kB against the 40 kB
  limit; the chevron was already bundled via lucide.
- New unit tests: `Disclosure.test.ts`, `DataTable.test.ts` (renderRowDetails,
  helpers), `displayTitle.test.ts` (`formatName`), `EntityLabel.test.ts`
  (treatment), `DetailHeader.test.ts` (disclosure), `ReferenceField.test.ts`.
- E2E: `playwright/smoke.spec.ts` gains a Quotes-list test asserting the
  reference number is hidden until the Additional details disclosure is opened
  and visible after, the same on a quote detail header, plus an axe sweep on the
  quotes-list surface (serious/critical clean). Rides the existing staging skip
  gate.

## Constitution alignment

No banned import (Disclosure is hand-rolled). No em dash, double hyphen, or emoji
in user-facing copy; the only new string is "Additional details". JetBrains Mono
stays in the type system for code. Brand tokens only. No money helper, RLS,
idempotency, `audit_log`, schema, or migration change. Nothing on the stop list.

## Follow-ups

- `F-Wave14-READ-SORT-01`. Restore sort-by-number via the toolbar sort menu.
- `F-Wave14-READ-SEARCH-01`. Confirm number discoverability in search.
- `F-Wave14-READ-FLAG-01`. Optional feature flag if a staged prod rollout is
  later wanted (not taken; A1 chose no flag).

## Execution note

The shared foundation was built and verified by hand. The ~90-file per-page
rollout was executed by eight scoped parallel agents over disjoint file sets
(four for list pages, four for detail and secondary surfaces), each given the
same recipe and the converted Quotes page as the reference. Every agent ran its
own typecheck; a unified typecheck, lint, test, contract, and bundle pass over
the full surface confirmed the result.
