# Shared UI Kit Overhaul Closeout (F-Wave10-UI-KIT-01)

Date: 2026-06-03
Closes: F-Wave10-UI-KIT-01
Branches (final arc): kit-mfg-finance-channels (#231), kit-3pl-config-production (#232), kit-3pl-sales-config-vas (#234), kit-finale-boards-homes (#235)

## Scope

The shared UI kit overhaul is complete. The operator SPA now composes one shared
component kit end to end: every list, FSM detail, create/edit form, config
surface, CRM board, and pillar home. The overhaul ran 2026-06-02 and 2026-06-03
across PRs #213 to #235; this closeout covers the final arc (the four PRs this
session) and records the completion of the whole effort.

The goal was consistency and maintainability, not redesign: extract a small
hand-rolled primitive kit with zero new dependencies and move every page onto it,
preserving behavior verbatim. The kit lives in apps/web/src/components/ui:
StatusBadge, PageHeader, DataTable, FilterBar, Select, Pagination, DetailLayout,
Button, TextInput, and, added in the finale, ActionTile and StatCard.

## Final-arc batches (this session)

- #231 Manufacturing + Finance + Co-Pack Channels. Manufacturing runs
  (list/detail/create/from-BOM); Finance Chart of Accounts, Journal Entries,
  Period Close; Co-Pack Channels. Added the journal-entry and period-close states
  (posted, reversed, in_review, reopened) to StatusBadge.
- #232 3PL Stock + Production. Stock levels and movements; production runs
  (list/detail/create). Added the production_run initial state planned. Fixed a
  stock-movements raw-cents render (unit_cost_cents) to formatCents. production_run
  keeps its StateStepper (it is registered in STATE_STEPPER_PATHS); the production
  create page kept its legacy raw-UUID inputs (a picker upgrade is a follow-up).
- #234 3PL sales config + VAS. Currencies, exchange rates, payment methods,
  pricing tiers, taxes (list + create + edit), and the value-added-services
  catalog. Rate scalars preserved verbatim: rate_e9 renders as a raw integer
  String; discount_bps and rate_bps render as basis-points-to-percent in lists and
  use the PercentInput basis-points round-trip in forms; never formatCents. VAS
  base_price_cents keeps formatCents and DollarInput.
- #235 CRM boards + pillar homes (finale). Leads kanban and Opportunities pipeline
  onto PageHeader + Button (the boards stay bespoke). The three pillar homes
  (Co-Pack, Manufacturing, KitForce) adopted two new shared tile primitives,
  ActionTile and StatCard, extracted from the triplicated local copies. Fixed the
  Opportunities pipeline raw-cents render (per-card amount and per-column total) to
  formatCents.

## Key decisions

- The pillar-home hero headers (text-6xl) stayed at landing scale rather than
  being forced into the list-scale PageHeader, because a home is a hero, not a
  list. The main DashboardPage already composed shared components (WorkCard,
  SetupChecklist) and was left unchanged.
- Boards (kanban, pipeline) stay hand-rolled inside the page; there is no kit
  equivalent for a board, so only the header and CTA moved to the kit.
- Rate scalars (rate_e9, basis points) are not money and were never routed through
  formatCents, a deliberate distinction confirmed by the constitution review.
- Migration-pure throughout: no behavior changed except three intentional
  raw-cents money fixes (stock movements, Opportunities amount and total).

## Verification

Every batch ran a three-lens adversarial review (behavior-fidelity,
constitution and money, kit-consistency and accessibility) with each finding
independently checked and fixed before merge. Findings were LOW or MEDIUM; the
notable catches were a TaxesPage error branch that had been made error-exclusive
(restored to the original additive behavior) and two finale accessibility nits
(StatCard aria-busy for its loading state, region landmarks on the board grids).
All local gates held on every batch: typecheck, eslint at max-warnings 0, the
full unit and regression suite (438 tests), the production build, and size-limit
with the SPA index chunk steady at about 37.5 kB of the 40 kB budget because every
migrated page is a lazy chunk that keeps the kit out of the index.

## Process note

The stacked PR #233 (sales-config and VAS, branched off #232) was auto-closed
when its base branch was deleted on #232's merge. The branch was rebased onto
fresh main and reopened as #234 with no content lost. Recorded for future
stacked-merge ordering: retarget the stacked PR to main before deleting the base
branch.

## Follow-ups

- F-Wave10-UI-KIT-DATATABLE-SORT-01: DataTable column-level sort.
- F-WS7-SERVER-PAGINATION: fold server limit and offset into DataTable adoption
  and retire the client-side slice.
- DataTable header cells lack scope=col (accessibility); filed as a spawned task.
- Mixed-currency pipeline totals: the Opportunities per-column total sums cents
  across possibly-mixed currencies and formats as USD.
- Carried pre-existing: F-Wave10-EXCHANGE-RATE-PATCH-01 (no PATCH route for
  exchange rates), F-Wave10-CRM-SALESCONFIG-SPA-GATE-01 (SPA capability gate on
  sales-config), and the BomDetailPage hub-eyebrow one-line fix.

## Constitutional invariants

Money via formatCents (including the three raw-cents fixes); rate scalars are not
money and stayed verbatim; no float money math. No migration, RLS, audit,
idempotency, schema, or capability files touched: presentation layer only.
StatusBadge additions were pure (no existing key or label changed). Brand voice
held on disk (no em dashes, no double hyphens, no emojis). No banned dependencies
added; the two new components are pure presentational (Link plus markup).
