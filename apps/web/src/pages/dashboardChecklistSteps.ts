// dashboardChecklistSteps. Pure logic for the SetupChecklist surface.
//
// Translates the 7 setup-step booleans on DashboardSummary into a typed,
// ordered step list the SetupChecklist component renders. Kept out of the
// React tree so step copy, ordering, and the "all complete" predicate can
// be exercised under Vitest without a DOM renderer (matches the pattern
// used by dashboardWorkCards.ts).
//
// Order is intentional and matches the operator's prerequisite chain
// derived from the 2026-05-25 four-agent provisioning audit:
//   1. Warehouse exists. Auto-true post-migration-0064 because
//      seed_org_default_warehouse runs at provisioning. Helper copy
//      explains the default and points to Library where the operator can
//      rename it.
//   2. Customer exists. Hard prerequisite for quote, invoice, payment.
//   3. Inventory item exists. Hard prerequisite for any line on any doc.
//   4. Quote created. First sales motion.
//   5. Receiving order received. Brings stock on hand. Required before
//      shipments with non-zero quantities.
//   6. Invoice sent. First billing motion.
//   7. Payment recorded. Closes the quote-to-cash loop and lights up the
//      KitCost YTD Revenue KPI.
//   8. Teammate invited. The staff invite chassis landed in
//      F-Wave9-STAFF-INVITE-CHASSIS-01; this step routes to /admin/members
//      where the operator can send a magic-link invite to their first
//      teammate. Last in the order because the chain above is the operator
//      proving the workflow alone before bringing anyone else in.

import type { DashboardSummary } from '@/lib/types/cross_cutting';

export interface SetupStepSpec {
  key: SetupStepKey;
  label: string;
  helperCopy: string;
  to: string;
  isComplete: boolean;
}

export type SetupStepKey =
  | 'warehouse_added'
  | 'customer_added'
  | 'item_added'
  | 'quote_created'
  | 'receiving_received'
  | 'invoice_sent'
  | 'payment_received'
  | 'team_invited';

/**
 * Builds the ordered 8-step setup checklist from the dashboard summary
 * payload. Helper copy on step 1 explains the default warehouse seeded at
 * provisioning so the first checkmark does not look like product magic.
 */
export function buildSetupSteps(summary: DashboardSummary): SetupStepSpec[] {
  return [
    {
      key: 'warehouse_added',
      label: 'Set up your warehouse',
      helperCopy:
        'A default warehouse is created during setup. Rename it or add more in Library.',
      to: '/inventory/warehouses',
      isComplete: summary.setup_warehouse_added,
    },
    {
      key: 'customer_added',
      label: 'Create your first customer',
      helperCopy: 'The operator you are quoting, shipping, or billing.',
      to: '/crm/customers/new',
      isComplete: summary.setup_customer_added,
    },
    {
      key: 'item_added',
      label: 'Add an inventory item',
      helperCopy: 'The SKU you will receive, move, or ship first.',
      to: '/catalog/items/new',
      isComplete: summary.setup_item_added,
    },
    {
      key: 'quote_created',
      label: 'Create your first quote',
      helperCopy: 'Draft a quote the customer can approve.',
      to: '/quotes/new',
      isComplete: summary.setup_quote_created,
    },
    {
      key: 'receiving_received',
      label: 'Receive your first stock',
      helperCopy: 'Bring inventory on hand before you ship.',
      to: '/3pl-operations/receiving/new',
      isComplete: summary.setup_receiving_received,
    },
    {
      key: 'invoice_sent',
      label: 'Send your first invoice',
      helperCopy: 'Bill the customer for work done.',
      to: '/invoicing/invoices/new',
      isComplete: summary.setup_invoice_sent,
    },
    {
      key: 'payment_received',
      label: 'Record a payment',
      helperCopy: 'Close the loop and light up your revenue KPIs.',
      to: '/invoicing/payments/new',
      isComplete: summary.setup_payment_received,
    },
    {
      key: 'team_invited',
      label: 'Invite a teammate',
      helperCopy:
        'Add your first staff member. They will sign in with a magic link.',
      to: '/admin/members',
      isComplete: summary.setup_team_invited,
    },
  ];
}

/**
 * Returns the count of completed steps. Used by the progress counter and
 * the "all done" predicate.
 */
export function countCompletedSetupSteps(summary: DashboardSummary): number {
  return buildSetupSteps(summary).filter((s) => s.isComplete).length;
}

/**
 * Total number of steps in the canonical setup checklist. Exposed as a
 * constant so the SetupChecklist progress copy and the DashboardPage
 * "hide when complete" branch stay in sync without re-counting.
 */
export const SETUP_STEPS_TOTAL = 8;

/**
 * True if every step in the checklist is complete. The DashboardPage uses
 * this to decide whether to render the SetupChecklist at all; once true,
 * the work-card grid takes over the top of the dashboard.
 */
export function isSetupComplete(summary: DashboardSummary): boolean {
  return countCompletedSetupSteps(summary) === SETUP_STEPS_TOTAL;
}
