# Closeout: section dashboards, navigation redesign, and dashboard personalization

Date: 2026-06-22. Type: navigation and UX redesign plus a DB-backed
personalization feature. Eleven PRs (#352 through #362), all merged to main and
verified on prod.

## Why

Two threads converged. First, the operator hit a recurring portal dead-end: an
account with both a staff membership and a customer_user portal membership could
switch into the portal from the operator topbar and then have no way back, since
the portal has no switcher and customer_user lacks the session-switch capability.
Second, the operator dropped a navigation-and-customization plan that reframed the
sidebar work as section dashboards: each task-section header should open a real
destination (KPIs plus widgets plus deep-linked lists, reusing the KitCost
dashboard pattern) rather than only toggling sub-links, and the app should let
each user make the dashboards their own.

## What shipped

### Portal dead-end fix (PR #352, `squash` on main)

The operator topbar workspace switcher listed the operator's own customer_user
portal membership as a switch target. Switching into it stranded him. The fix
filters the switcher to staff memberships only (SPA-only). The recurring
immediate remedy (re-stamp the auth claim to org_owner on the real org) was
applied to unblock him in the moment; the switcher filter prevents the trap from
recurring. A bidirectional escape hatch for portal roles remains a follow-up
because it requires granting a session-switch capability to portal roles, which
is a capabilities-canon change needing an authorization review.

### Section dashboards (PRs #353 through #357)

A single generic SectionHomePage now serves all eight task sections (Sell, Buy,
Inventory, Production, Money, Workforce, Insights, Settings). It resolves the
section from the pathname, renders the section header, an optional KPI panel, and
a hub of the section's sub-areas as cards (reusing the exact flag and capability
gating from sidebarModes). Six of the eight sections gained rich KPI panels
backed by new read-only summary endpoints in the existing dashboard-api bundle:
sell, money, inventory, production, buy, and workforce. Each summary endpoint is
org-scoped (Pattern A), capability-gated, and returns BIGINT cents as strings
with banker's-rounded money math; each has a new byte-mirrored canon type and a
regression test covering the KPI math and the cross-tenant probe.

Navigation cleanup landed in the same arc: a global Back button at the top of the
app shell, removal of the noisy per-page category eyebrow, and a conversion of
the sidebar to a static section rail (each section is a single icon-and-label link
to its dashboard, no accordion). The global dashboard's descriptive pillars block
was replaced by a role-aware section launcher that links into the section homes.

### Insights, polish, and cleanup (PRs #358, #359)

Insights consolidation surfaced the KitCost headline metrics on the Insights
section home through a cap-gated panel that reuses the existing KitCost summary
hook, with no new endpoint. Detail-page breadcrumbs were retired (the component
is now a no-op), which removed the trail and eliminated the quote breadcrumb
id-flash by construction. The state-versus-status deep-link concern was
investigated and found already consistent, so no change was made. A mechanical
sweep removed the now-dead category eyebrow prop from 126 page surfaces and
dropped the prop from the PageHeader and DetailHeader interfaces.

### Personalization (PRs #360, #361, #362)

Three pieces, shipped in order of increasing depth.

Per-user default landing (PR #360): a "Set as home" control on the global
dashboard and each section home lets a user choose where the root path resolves
after sign-in. Stored per browser in localStorage, since a landing target is an
inherently per-device preference. The valid-landings list is hardcoded rather
than imported from SIDEBAR_MODES, because importing it pulled the sidebar module
and its icon set into the eager IndexRoute path and broke the index size budget;
a unit test guards the hardcoded list against drift.

DB-backed preferences chassis (PR #361): the storage and API for per-user,
cross-device dashboard layout. Migration 0128 adds user_dashboard_prefs, one row
per organization, user, and section_key, holding a JSON layout. RLS from
creation, owner-scoped (org_id equals current_org_id() and user_id equals
auth.uid()), mirroring saved_views. The schema was put in front of the operator
and approved before the migration was written, per the constitution stop-list.
dashboard-api gained GET and PUT for the layout; the write is idempotency-keyed.
New byte-mirrored canon types, SPA service functions, and hooks round it out,
with a regression suite covering the section map, owner scope, the cross-tenant
probe, the canon enum guard, and the idempotency-key gate and conflict.

Customize UI (PR #362): each section home now composes its content as a list of
widgets (the KPI panel as one widget, plus one widget per hub domain group) and
renders them through a new CustomizableSection. A Customize toggle reveals
per-widget controls to hide or show a widget and move it up or down; the layout
persists per user and follows the user across devices. Reorder uses up and down
buttons rather than drag, which is keyboard-accessible and adds no weight. The
ordering and visibility logic lives in a pure, unit-tested helper module. The
seven existing KPI panels were left intact (each is a single widget for now), so
the change carries no regression risk to the panels themselves.

## How it was built

The section dashboards and the list work earlier in the week were built with
dynamic multi-agent workflows. This arc was built inline, one reviewable PR per
coherent unit, each merged on green and verified on prod before the next began.
The personalization migration was the one constitution stop-list item; it was
held for explicit schema sign-off before any SQL was written, then shipped
through the post-merge migrate workflow rather than applied directly, and
verified read-only on prod afterward.

## Gates

Every PR passed the full suite before merge: typecheck, lint (`--max-warnings 0`),
the full unit and regression set (ending at 924 passing plus 2 skipped, with the
new personalization and layout tests included), contract and parity (47, no
byte-mirror canon drift), production build, and size-limit (the SPA index chunk
held at 37.78 kB against the 40 kB budget throughout, since the section pages stay
lazy). CI was green on the first run for each PR, including RLS and e2e against
staging. Both prod deploys (edge functions and SPA) confirmed green for the PRs
that touched each.

## Constitutional invariants verified

The single schema change (migration 0128) ships RLS from creation, owner-scoped,
mirroring the proven saved_views pattern; it was operator-approved before
authoring. Prod verification confirmed RLS enabled, two owner-scoped policies,
and the migration chain stamped cleanly at 0128 with no phantom version. The PUT
on the new endpoint is idempotency-keyed. No money-helper change, no audit_log
change, no new top-level dependency, and no new capability (the prefs endpoints
reuse dashboard.summary.read, with RLS and the explicit user_id filter as the
ownership authority). The remaining PRs were SPA-only or read-path-only with no
schema, RLS, money, idempotency, or dependency impact.

## Follow-ups

- Phase B of personalization: saved-view-as-widget (pin a saved list view as a
  dashboard widget). The canon and table already carry a pinned_views slot.
- Optional: split the KPI panels into finer widgets, and add a drag affordance
  (the drag library is already in the dependency tree).
- Bidirectional portal escape hatch (needs a capabilities-canon change and an
  authorization review).
- A cross-device version of the default-landing preference could fold into
  user_dashboard_prefs now that the table exists.
- Sweep the now-inert per-page breadcrumb calls.
