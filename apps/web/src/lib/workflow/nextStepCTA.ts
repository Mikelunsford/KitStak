// Pure predicates that decide when each detail page shows its NextStepCTA
// (UX-Q4 from the 2026-05-21 UX revision walk). Centralised here so the four
// detail pages share one source of truth AND the regression suite can lock
// the predicates without spinning up React.
//
// The constitutional invariant under test: the "next step" CTA must appear
// exactly when the entity is in the FSM state that opens the forward
// transition AND nowhere else. A drift in either direction (CTA absent on a
// triggering state OR CTA visible on a non-triggering state) regresses
// UX-Q4 and is a release blocker for the four flows.

import type { QuoteState, ProjectState } from '@/lib/types/sales';
import type { ShipmentStatus } from '@/lib/types/vendors_inventory_ops';
import type { InvoiceStatus } from '@/lib/types/finance';

/**
 * Quote detail. The next step from an approved quote is convert-to-project,
 * which is the only forward transition out of `approved` that lands on
 * `project_pending`.
 */
export function shouldShowQuoteNextStepCTA(state: QuoteState): boolean {
  return state === 'approved';
}

/**
 * Project detail. The next step from a ready-to-ship project is to create
 * a shipment against it. The FSM still allows transitioning the project to
 * `completed`, but that move is sideways relative to the shipment workflow,
 * so the primary CTA is the shipment link, not the FSM move.
 */
export function shouldShowProjectNextStepCTA(state: ProjectState): boolean {
  return state === 'ready_to_ship';
}

/**
 * Shipment detail. Once a shipment is shipped, the next step in the
 * quote-to-cash chain is to invoice the customer. The FSM treats `shipped`
 * as a sink (no further transitions) so the only forward move is into the
 * invoicing pillar.
 */
export function shouldShowShipmentNextStepCTA(state: ShipmentStatus): boolean {
  return state === 'shipped';
}

/**
 * Invoice detail. Once an invoice is sent, partially paid, or overdue, the
 * next step is to receive payment against it. `partially_paid` is included
 * because the operator may receive a second payment. `overdue` is a
 * derived sub-state of sent and is included for the same reason — the
 * canReceivePayment predicate already encoded in InvoiceDetailPage uses
 * the same three states; this helper is the same set.
 */
export function shouldShowInvoiceNextStepCTA(status: InvoiceStatus): boolean {
  return status === 'sent' || status === 'partially_paid' || status === 'overdue';
}
