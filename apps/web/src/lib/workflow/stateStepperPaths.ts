/**
 * State-stepper happy-path mappings. Encodes the canonical forward path
 * through each FSM that the UX-Q7 `<StateStepper>` renders as a horizontal
 * progress strip on each detail page.
 *
 * Each entry has:
 *   * `path`        the ordered list of states the operator walks the
 *                   record through under normal conditions. The first
 *                   element is the FSM's `initial` state, the last is the
 *                   terminal happy-path state.
 *   * `offPath`     the set of FSM states that do NOT appear on the happy
 *                   path. When the entity is in one of these states the
 *                   stepper renders the path muted and surfaces the
 *                   off-path state as a separate accent-styled badge.
 *
 * Constitutional invariants (locked by `stateStepperPaths.test.ts`):
 *   1. Every state in each FSM's `states` array is either on the path or
 *      in the off-path set. No state goes unrepresented.
 *   2. No state appears in BOTH `path` and `offPath` for a given FSM.
 *   3. The first entry of each path equals the FSM's `initial` state.
 *
 * Notes on entities whose happy path required interpretation:
 *
 *   * Invoice. `partially_paid` is a transient state on the way to `paid`
 *     per the B2 fix in PR #99 (the recompute function flips status
 *     forward as payments allocate). It sits on the happy path between
 *     `sent` and `paid`. `pending` is the explicit "submitted but not
 *     yet sent" sub-state; we keep it on the path so the operator sees
 *     the full draft -> pending -> sent -> partially_paid -> paid chain.
 *     `overdue`, `refunded`, `cancelled`, `on_hold` are off-path.
 *
 *   * Credit note. Happy path is `draft -> issued -> applied`. `voided`
 *     is the off-path sink (analogous to `cancelled`).
 *
 *   * Purchase order. Happy path is `draft -> submitted -> approved ->
 *     partial_received -> received -> closed`. `cancelled` is off-path.
 *     `partial_received` is treated as on-path because most real-world
 *     POs end up at `received` via `partial_received` first; the FSM
 *     also allows `approved -> received` directly, but the path takes
 *     the longest forward chain that visits every non-terminal state.
 *
 *   * Vendor bill. Happy path is `draft -> submitted -> approved ->
 *     partial_paid -> paid -> closed`. `cancelled` is off-path.
 *     `partial_paid` is on-path for the same reason as PO partial_received.
 *
 *   * Expense. Happy path is `draft -> submitted -> approved -> paid ->
 *     reimbursed`. `rejected` is off-path. The FSM allows `paid` without
 *     `reimbursed` if the expense is non-reimbursable, but the stepper
 *     shows the full chain so the operator sees what's possible.
 *
 *   * Lead. Happy path is `new -> working -> qualified -> converted`.
 *     `disqualified` is off-path. The FSM allows reopen from
 *     disqualified back to working, but reopen is a side-trip not part
 *     of the forward chain.
 *
 *   * Opportunity. Happy path is `discovery -> evaluation -> proposal
 *     -> negotiation -> closed_won`. `closed_lost` is off-path. The FSM
 *     allows `rewind` between stages but those are corrections, not
 *     forward motion.
 *
 *   * Manufacturing run. Happy path is `draft -> started -> completed`.
 *     `cancelled` is off-path. Mirrors production_run.
 *
 *   * Production run. Happy path is `planned -> in_progress -> completed`.
 *     `cancelled` is off-path. Mirrors manufacturing_run.
 *
 *   * Shipment. The current SPA FSM is `created -> picking -> shipped`
 *     with `cancelled` as off-path. The Q7 spec mentions `delivered`,
 *     but that state does not exist in the SPA FSM today, so the path
 *     ends at `shipped`. Adding `delivered` would require a forward
 *     migration; out of scope for this change.
 *
 *   * Receiving order. Happy path is `created -> in_progress -> received`.
 *     `cancelled` is off-path.
 *
 *   * Quote. Happy path is `draft -> submitted -> approved ->
 *     project_pending`. `revise_requested` and `cancelled` are off-path.
 *
 *   * Project. Happy path is `pending -> ready_to_build -> in_production
 *     -> ready_to_ship -> completed`. `cancelled` is off-path.
 *
 * Each FSM also has a label resolver colocated below. The resolver maps
 * a state value (which may be on the path OR in the off-path set) to
 * the operator-facing label. Quote keeps reusing `formatQuoteStateLabel`
 * from PR #103 via re-export so the "Sent for approval" override stays
 * in sync. Every other entity uses a thin Title-Case helper.
 */

import { formatQuoteStateLabel } from '@/pages/3pl-operations/quotes/formatQuoteStateLabel';

import type { StateStepperStep } from '@/components/shell/StateStepper';

// ---------------------------------------------------------------------------
// Generic Title-Case formatter used as the default label resolver. Mirrors
// formatQuoteStateLabel's underscore-to-space cosmetic touch-up so all
// stepper labels feel consistent across entities. Keeps capitalization on
// only the first letter of each word so values like "partial_paid" become
// "Partial Paid" rather than the screaming "PARTIAL PAID" of the old pill.
// ---------------------------------------------------------------------------
export function titleCaseStateLabel(state: string): string {
  return state
    .split('_')
    .map((part) =>
      part.length === 0
        ? part
        : part[0]!.toUpperCase() + part.slice(1).toLowerCase(),
    )
    .join(' ');
}

// ---------------------------------------------------------------------------
// Per-entity definitions.
//
// Stored as a single record so the test suite can iterate every entry and
// assert the constitutional invariants in one pass.
// ---------------------------------------------------------------------------

export interface StateStepperPath {
  /** Ordered list of happy-path states. */
  path: readonly StateStepperStep[];
  /** Set of off-path states for this FSM. */
  offPath: readonly string[];
  /** Resolver that returns the operator-facing label for ANY state value. */
  resolveLabel: (state: string) => string;
}

const quotePath: StateStepperPath = {
  path: [
    { state: 'draft',           label: formatQuoteStateLabel('draft') },
    { state: 'submitted',       label: formatQuoteStateLabel('submitted') },
    { state: 'approved',        label: formatQuoteStateLabel('approved') },
    { state: 'project_pending', label: formatQuoteStateLabel('project_pending'), isTerminal: true },
  ],
  offPath: ['revise_requested', 'cancelled'],
  resolveLabel: formatQuoteStateLabel,
};

const projectPath: StateStepperPath = {
  path: [
    { state: 'pending',        label: titleCaseStateLabel('pending') },
    { state: 'ready_to_build', label: titleCaseStateLabel('ready_to_build') },
    { state: 'in_production',  label: titleCaseStateLabel('in_production') },
    { state: 'ready_to_ship',  label: titleCaseStateLabel('ready_to_ship') },
    { state: 'completed',      label: titleCaseStateLabel('completed'), isTerminal: true },
  ],
  offPath: ['cancelled'],
  resolveLabel: titleCaseStateLabel,
};

const manufacturingRunPath: StateStepperPath = {
  path: [
    { state: 'draft',     label: titleCaseStateLabel('draft') },
    { state: 'started',   label: titleCaseStateLabel('started') },
    { state: 'completed', label: titleCaseStateLabel('completed'), isTerminal: true },
  ],
  offPath: ['cancelled'],
  resolveLabel: titleCaseStateLabel,
};

const productionRunPath: StateStepperPath = {
  path: [
    { state: 'planned',     label: titleCaseStateLabel('planned') },
    { state: 'in_progress', label: titleCaseStateLabel('in_progress') },
    { state: 'completed',   label: titleCaseStateLabel('completed'), isTerminal: true },
  ],
  offPath: ['cancelled'],
  resolveLabel: titleCaseStateLabel,
};

const receivingOrderPath: StateStepperPath = {
  path: [
    { state: 'created',     label: titleCaseStateLabel('created') },
    { state: 'in_progress', label: titleCaseStateLabel('in_progress') },
    { state: 'received',    label: titleCaseStateLabel('received'), isTerminal: true },
  ],
  offPath: ['cancelled'],
  resolveLabel: titleCaseStateLabel,
};

const shipmentPath: StateStepperPath = {
  path: [
    { state: 'created', label: titleCaseStateLabel('created') },
    { state: 'picking', label: titleCaseStateLabel('picking') },
    { state: 'shipped', label: titleCaseStateLabel('shipped'), isTerminal: true },
  ],
  offPath: ['cancelled'],
  resolveLabel: titleCaseStateLabel,
};

const invoicePath: StateStepperPath = {
  path: [
    { state: 'draft',          label: titleCaseStateLabel('draft') },
    { state: 'pending',        label: titleCaseStateLabel('pending') },
    { state: 'sent',           label: titleCaseStateLabel('sent') },
    { state: 'partially_paid', label: titleCaseStateLabel('partially_paid') },
    { state: 'paid',           label: titleCaseStateLabel('paid'), isTerminal: true },
  ],
  offPath: ['overdue', 'refunded', 'cancelled', 'on_hold'],
  resolveLabel: titleCaseStateLabel,
};

const creditNotePath: StateStepperPath = {
  path: [
    { state: 'draft',   label: titleCaseStateLabel('draft') },
    { state: 'issued',  label: titleCaseStateLabel('issued') },
    { state: 'applied', label: titleCaseStateLabel('applied'), isTerminal: true },
  ],
  offPath: ['voided'],
  resolveLabel: titleCaseStateLabel,
};

const purchaseOrderPath: StateStepperPath = {
  path: [
    { state: 'draft',            label: titleCaseStateLabel('draft') },
    { state: 'submitted',        label: titleCaseStateLabel('submitted') },
    { state: 'approved',         label: titleCaseStateLabel('approved') },
    { state: 'partial_received', label: titleCaseStateLabel('partial_received') },
    { state: 'received',         label: titleCaseStateLabel('received') },
    { state: 'closed',           label: titleCaseStateLabel('closed'), isTerminal: true },
  ],
  offPath: ['cancelled'],
  resolveLabel: titleCaseStateLabel,
};

const vendorBillPath: StateStepperPath = {
  path: [
    { state: 'draft',        label: titleCaseStateLabel('draft') },
    { state: 'submitted',    label: titleCaseStateLabel('submitted') },
    { state: 'approved',     label: titleCaseStateLabel('approved') },
    { state: 'partial_paid', label: titleCaseStateLabel('partial_paid') },
    { state: 'paid',         label: titleCaseStateLabel('paid') },
    { state: 'closed',       label: titleCaseStateLabel('closed'), isTerminal: true },
  ],
  offPath: ['cancelled'],
  resolveLabel: titleCaseStateLabel,
};

const expensePath: StateStepperPath = {
  path: [
    { state: 'draft',      label: titleCaseStateLabel('draft') },
    { state: 'submitted',  label: titleCaseStateLabel('submitted') },
    { state: 'approved',   label: titleCaseStateLabel('approved') },
    { state: 'paid',       label: titleCaseStateLabel('paid') },
    { state: 'reimbursed', label: titleCaseStateLabel('reimbursed'), isTerminal: true },
  ],
  offPath: ['rejected'],
  resolveLabel: titleCaseStateLabel,
};

const leadPath: StateStepperPath = {
  path: [
    { state: 'new',       label: titleCaseStateLabel('new') },
    { state: 'working',   label: titleCaseStateLabel('working') },
    { state: 'qualified', label: titleCaseStateLabel('qualified') },
    { state: 'converted', label: titleCaseStateLabel('converted'), isTerminal: true },
  ],
  offPath: ['disqualified'],
  resolveLabel: titleCaseStateLabel,
};

const opportunityPath: StateStepperPath = {
  path: [
    { state: 'discovery',   label: titleCaseStateLabel('discovery') },
    { state: 'evaluation',  label: titleCaseStateLabel('evaluation') },
    { state: 'proposal',    label: titleCaseStateLabel('proposal') },
    { state: 'negotiation', label: titleCaseStateLabel('negotiation') },
    { state: 'closed_won',  label: titleCaseStateLabel('closed_won'), isTerminal: true },
  ],
  offPath: ['closed_lost'],
  resolveLabel: titleCaseStateLabel,
};

export const STATE_STEPPER_PATHS = {
  quote: quotePath,
  project: projectPath,
  manufacturing_run: manufacturingRunPath,
  production_run: productionRunPath,
  receiving_order: receivingOrderPath,
  shipment: shipmentPath,
  invoice: invoicePath,
  credit_note: creditNotePath,
  purchase_order: purchaseOrderPath,
  vendor_bill: vendorBillPath,
  expense: expensePath,
  lead: leadPath,
  opportunity: opportunityPath,
} as const;

export type StateStepperEntity = keyof typeof STATE_STEPPER_PATHS;

/**
 * Helper: returns true when the supplied state is OFF the happy path for
 * the given entity (i.e. it appears in `offPath` rather than `path`).
 *
 * Mirrors the pattern used by `shouldShowQuoteNextStepCTA` and friends:
 * a tiny predicate the detail page can call inline to decide whether to
 * pass an `offPath` prop to `<StateStepper>`.
 */
export function isOffPath(entity: StateStepperEntity, state: string): boolean {
  const def = STATE_STEPPER_PATHS[entity];
  return def.offPath.includes(state);
}
