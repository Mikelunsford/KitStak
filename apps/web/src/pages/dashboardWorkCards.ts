// dashboardWorkCards. UX-Q5 helper.
//
// Pure logic for deriving the four dashboard work cards (and the onboarding
// fallback) from a DashboardSummary payload. Kept out of the React tree so
// the precedence and empty-state rules can be unit-tested under Vitest
// without a DOM renderer (matches the pattern used by
// `lib/hooks/featureFlagResolver.ts` per the repo's no-jsdom convention).
//
// Predicates and routes match the UX revision spec (Q5, 2026-05-21):
//   - Quotes awaiting approval -> /3pl-operations/quotes?state=submitted
//   - Runs in production       -> /manufacturing/runs?status=started
//   - Shipments ready to ship  -> /3pl-operations/shipments?status=picking
//   - Unpaid invoices          -> /invoicing/invoices?status=sent
//
// The deep links target the most signal-bearing single status (e.g. picking
// for shipments, started for runs) because the list pages only support one
// status value per query param today. The backend count aggregates across
// the broader predicate set declared in the spec; the deep-link filter is
// the closest single status the list page can resolve. Operators always
// see a superset count on the card and can fan out via the list-page
// status chips once they land.

import type { DashboardSummary } from '@/lib/types/cross_cutting';

export interface WorkCardSpec {
  key: WorkCardKey;
  count: number;
  label: string;
  to: string;
}

export type WorkCardKey =
  | 'quotes_awaiting_approval'
  | 'runs_in_production'
  | 'shipments_ready_to_ship'
  | 'unpaid_invoices';

export interface OnboardingCardSpec {
  key: OnboardingKey;
  label: string;
  to: string;
  helperText: string;
}

export type OnboardingKey =
  | 'create_customer'
  | 'add_inventory_item'
  | 'create_quote'
  | 'invite_teammate';

/**
 * Builds the four work-card specs from a dashboard summary payload.
 *
 * The order is intentional and matches the operator's daily flow:
 * quotes -> runs -> shipments -> invoices, mirroring the deal pipeline.
 */
export function buildWorkCards(summary: DashboardSummary): WorkCardSpec[] {
  return [
    {
      key: 'quotes_awaiting_approval',
      count: summary.quotes_awaiting_approval_count,
      label: 'Quotes awaiting approval',
      to: '/3pl-operations/quotes?state=submitted',
    },
    {
      key: 'runs_in_production',
      count: summary.runs_in_production_count,
      label: 'Runs in production',
      to: '/manufacturing/runs?status=started',
    },
    {
      key: 'shipments_ready_to_ship',
      count: summary.shipments_ready_to_ship_count,
      label: 'Shipments ready to ship',
      to: '/3pl-operations/shipments?status=picking',
    },
    {
      key: 'unpaid_invoices',
      count: summary.unpaid_invoices_count,
      label: 'Unpaid invoices',
      to: '/invoicing/invoices?status=sent',
    },
  ];
}

/**
 * Returns true if every work-card count is zero, which is the signal to
 * switch the dashboard surface to its onboarding cards.
 *
 * Defensive against negative or non-finite counts: any non-positive value
 * is treated as zero so a server-side regression cannot flip the
 * empty-state heuristic on its own.
 */
export function isAllCountsZero(summary: DashboardSummary): boolean {
  const cards = buildWorkCards(summary);
  return cards.every((c) => !Number.isFinite(c.count) || c.count <= 0);
}

/**
 * Four-card onboarding spec rendered when every work-card count is zero.
 * Routes are constrained to existing, reachable list/create pages from
 * `routes.ts`; we do not invent destinations.
 */
export function buildOnboardingCards(): OnboardingCardSpec[] {
  return [
    {
      key: 'create_customer',
      label: 'Create your first customer',
      to: '/crm/customers/new',
      helperText: 'Add the operator you are working with.',
    },
    {
      key: 'add_inventory_item',
      label: 'Add an inventory item',
      to: '/3pl-operations/items/new',
      helperText: 'Define the SKU you will move first.',
    },
    {
      key: 'create_quote',
      label: 'Create your first quote',
      to: '/3pl-operations/quotes/new',
      helperText: 'Draft a quote the customer can approve.',
    },
    {
      key: 'invite_teammate',
      label: 'Invite a teammate',
      to: '/admin/members',
      helperText: 'Send a magic-link invite to your first staff member.',
    },
  ];
}
