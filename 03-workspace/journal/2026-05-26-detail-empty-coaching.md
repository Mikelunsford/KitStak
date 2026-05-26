# 2026-05-26 - Detail-page section empty-state coaching

Status: shipped via PR (pending).
Branch: `feat/detail-section-empty-coaching`.
Closes: `F-Wave9-DETAIL-EMPTY-COACHING-01`.
Builds on: PR #144 (dashboard SetupChecklist) and PR #119 (ListEmptyState).

## Why this work

The dashboard now lands operators on a guided SetupChecklist (PR #144) and list pages show a coached `ListEmptyState` when empty (PR #119). Detail pages still rendered plain `text-ink-dim` lines like "No quotes for this customer." or "No materials yet." in every related-entity section. In screenshots those sparse sections made polished detail pages look hollow and gave operators no read on what the section was for or how to populate it.

This surface closes that gap with a compact inline coaching block that sits where the plain "No X yet." sentence used to.

## What shipped

### New shell component

`apps/web/src/components/shell/DetailSectionEmptyCoaching.tsx` (~95 lines): a compact inline empty-state surface for detail-page child sections. Distinct from `ListEmptyState` (which is the centered full-card empty state for a list PAGE):

- `entity: string` (required): singular noun, carried through as `data-entity` for tests
- `explainer: string` (required): sentence-cased one-line "what is this section for?"
- `ctaLabel?: string` and `ctaTo?: string` (optional, mutually required): when both present, an inline accent-hover link renders right of the explainer
- `icon?: LucideIcon` (optional): defaults to lucide `Info`, callers pass domain-relevant icons (Package, Truck, Factory, Inbox, Layers, Users, CreditCard, Receipt, FileText, Folder, Activity)

Visual: bg-2 subtle background, line border, 32px icon tile with 18px lucide icon at strokeWidth 1.5, flex-wrap row so the CTA drops below the explainer on narrow widths. Brand tokens only.

### Detail pages updated

| Page | Sections coached |
|------|------------------|
| `ProjectDetailPage.tsx` | MATERIALS (no CTA, inline form below), PHASES (no CTA, inline form below), RECEIVING (CTA → new receiving order), MANUFACTURING RUNS (CTA → new run), SHIPMENTS (CTA → new shipment), INVOICES (no CTA, system-created via "Create invoice from project" button) |
| `CustomerDetailPage.tsx` | QUOTES, PROJECTS, INVOICES, PAYMENTS, CONTACTS, ACTIVITIES (all six `RelatedSection` empty branches replaced; `RelatedSection` gained `entity`, `emptyExplainer`, `emptyIcon` props and routes the empty branch through the new component, carrying over its existing `ctaHref` + `ctaLabel` as the inline CTA) |
| `ShipmentDetailPage.tsx` | LINES (no CTA, inline ADD LINE form below) |
| `ReceivingOrderDetailPage.tsx` | LINES (no CTA, inline ADD LINE form below) |

Each section authored an operator-readable explainer like:
- "Phases break a project into trackable milestones."
- "Receiving orders track inbound stock for this project. Create one when materials are due to arrive at the warehouse."
- "Quotes are priced proposals you send to win the work. Approved quotes convert to projects."
- "Stock movements are the audit trail of every inventory change." (model lifted from `ListEmptyState`)

`AuditTimeline` history sections were left untouched: an empty audit log reads fine without coaching and the operator cannot author entries directly.

### Tests

- `DetailSectionEmptyCoaching.test.ts`: 9 unit tests: required-props render, entity data attribute, CTA renders when both label+to present, CTA hidden when either missing, CTA hidden when both absent, custom icon honoured, default icon fallback, plus a copy-discipline suite that scans all rendered strings for em dash, en dash, double hyphen, and emoji.
- `DetailSectionEmptyCoaching.pages.test.ts`: 5 smoke render tests covering project receiving (with CTA), project materials (no CTA), project invoices (no CTA), customer quotes (with CTA), and shipment lines (no CTA).
- 14 new tests, 0 regressions. Full suite: 456 src tests + 176 regression tests + 20 contract tests, all green.

## Constitutional alignment

| Invariant | Verification |
|-----------|--------------|
| No em dashes, double hyphens, or emojis in user-facing copy | Copy-discipline regex test in `DetailSectionEmptyCoaching.test.ts`; visual review of all 17 new explainer strings. |
| No new top-level dependencies | Only lucide-react (already bundled) and `react-router-dom` Link used. No package.json change. |
| Tailwind tokens only | `bg-bg-2`, `bg-bg-3`, `border-line`, `text-ink`, `text-ink-dim`, `text-accent`, `text-accent-bright`, `font-sans`. No custom CSS. |
| Bundle budget | Main `index` chunk: 30.38 kB gzipped (40 kB cap). Per-page chunks grew modestly: ProjectDetailPage 15.44 kB (+~1 kB), CustomerDetailPage 10.00 kB (+~0.5 kB), ShipmentDetailPage 7.93 kB (+~0.2 kB), ReceivingOrderDetailPage 7.53 kB (+~0.2 kB). |
| Brand voice ("Built to Ship.") | All explainers disciplined, peer-to-operator, no marketing fluff. |

## Verification

```
pnpm typecheck     # clean
pnpm lint          # 0 warnings
pnpm test          # 456 src + 176 regression tests pass
pnpm test:contract # 20 parity tests pass
pnpm build         # 10s, no warnings
pnpm bundle-budget # 30.38 kB / 40 kB
```

## Follow-ups

None spawned. The audit-timeline section across all detail pages was intentionally left out of scope; an empty audit log is the normal first state of a freshly created record and the existing UI reads fine. If a future smoke pass disagrees we can extend the pattern there.
