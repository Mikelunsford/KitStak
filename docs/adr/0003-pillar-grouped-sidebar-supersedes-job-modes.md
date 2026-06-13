# ADR 0003: Pillar-grouped sidebar supersedes the UX-Q1 job-mode navigation

Status: Accepted (2026-06-13)

Supersedes: the UX-Q1 job-mode sidebar decision locked 2026-05-21
(`Kitstak_UX_Revision_Questions 2026-05-21.md`, Q1).

Relates to: ADR 0002 (spine plus add-ons, WMS as the sixth add-on);
`03-workspace/specs/2026-06-04-3pl-commercial-pivot-and-wms-pillar-plan.md` section 5.5
(decision D4); risk carry R-W12-CO-04.

## Context

UX-Q1 (2026-05-21) replaced the original pillar sections with six work-mode
sections: SELL, MAKE, SHIP, GET PAID, LIBRARY, WORKFORCE. The model grouped
routes by the stage of work rather than by which pillar owned them.

The 2026-06 spine plus add-ons reframe (ADR 0002) re-states the product as one
always-on spine plus composable add-ons. The job-mode grouping cut across that
model: it scattered each add-on's surfaces across several modes and gave the
always-on backbone no distinct home, so the navigation no longer matched how the
product is built, sold, or reasoned about. It also left a latent defect (the
`workforce` mode key was missing from the sidebar expand-state allowlist).

## Decision

Replace the job-mode sidebar with a pillar-grouped sidebar:

- One always-on SPINE section, sub-grouped by domain: CRM, Quotes, Projects,
  Catalog, Inventory, Purchasing, Invoicing, Finance, Settings.
- One collapsible section per lit add-on: 3PL Operations, Manufacturing,
  Co-Pack and Ecom, KitForce, KitCost. WMS joins when its body ships
  (`plugins.wms` is not in code yet).

The change is sidebar-only. URLs do not move, the flat ROUTES table stays the
single source of truth, and old paths still resolve via SpineMoveRedirect.
Add-on sections carry per-route `requiresFlag` so a link hides when the org
lacks the plugin; the server-side bundle gates (404) and per-route
FEATURE_DISABLED guards are unchanged.

Shipped in PR #249 (Wave 12, Phase A1), with the SPINE domain sub-groups
exposed to assistive technology via `role="group"` and `aria-label` per domain.

## Consequences

- Navigation matches the spine plus add-ons mental model; the always-on backbone
  is one section and optional add-ons appear only when lit.
- The UX-Q1 job-mode decision (2026-05-21) is retired. Its rationale is preserved
  here and in git history.
- Page eyebrows still use the legacy job-mode words (for example "Make / Receiving",
  "Library / Vendors"). A broad eyebrow relabel to the new domain language is a
  separate follow-up, intentionally out of scope for the sidebar-only change.
- `SubscriptionGate`, trial gating, and route-level plugin gating are unaffected.
