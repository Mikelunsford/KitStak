// Side-car workflow canon for vendors + inventory + ops state machines.
// Byte-identical pair: apps/web/src/lib/workflow/vendors_inventory_ops.ts.
// Drift is a release blocker.
//
// State machines declared here:
//   purchase_order  (7 states)
//   vendor_bill     (7 states)
//   expense         (6 states)
//   receiving_order (4 states)
//   production_run  (4 states)
//   shipment        (4 states)
//
// The DB layer enforces allowed states via text CHECK constraints. This
// canon enforces allowed TRANSITIONS. Handlers call canTransitionVio(fsm,
// from, to) before issuing the UPDATE.

export type FsmTransition<S extends string> = {
  from: S;
  to: S;
  action: string;
};

export type Fsm<S extends string> = {
  entity: string;
  initial: S;
  states: readonly S[];
  transitions: readonly FsmTransition<S>[];
};

// ---------------------------------------------------------------------------
// Purchase order FSM
// ---------------------------------------------------------------------------

export type PurchaseOrderStatus =
  | 'draft'
  | 'submitted'
  | 'approved'
  | 'partial_received'
  | 'received'
  | 'closed'
  | 'cancelled';

export const PURCHASE_ORDER_FSM: Fsm<PurchaseOrderStatus> = {
  entity: 'purchase_order',
  initial: 'draft',
  states: [
    'draft', 'submitted', 'approved',
    'partial_received', 'received', 'closed', 'cancelled',
  ],
  transitions: [
    { from: 'draft',            to: 'submitted',        action: 'submit' },
    { from: 'draft',            to: 'cancelled',        action: 'cancel' },
    { from: 'submitted',        to: 'approved',         action: 'approve' },
    { from: 'submitted',        to: 'draft',            action: 'revise' },
    { from: 'submitted',        to: 'cancelled',        action: 'cancel' },
    { from: 'approved',         to: 'partial_received', action: 'partial_receive' },
    { from: 'approved',         to: 'received',         action: 'receive' },
    { from: 'approved',         to: 'cancelled',        action: 'cancel' },
    { from: 'partial_received', to: 'received',         action: 'receive' },
    { from: 'partial_received', to: 'closed',           action: 'close_short' },
    { from: 'received',         to: 'closed',           action: 'close' },
  ],
};

// ---------------------------------------------------------------------------
// Vendor bill FSM
// ---------------------------------------------------------------------------

export type VendorBillStatus =
  | 'draft'
  | 'submitted'
  | 'approved'
  | 'partial_paid'
  | 'paid'
  | 'closed'
  | 'cancelled';

export const VENDOR_BILL_FSM: Fsm<VendorBillStatus> = {
  entity: 'vendor_bill',
  initial: 'draft',
  states: [
    'draft', 'submitted', 'approved',
    'partial_paid', 'paid', 'closed', 'cancelled',
  ],
  transitions: [
    { from: 'draft',        to: 'submitted',    action: 'submit' },
    { from: 'draft',        to: 'cancelled',    action: 'cancel' },
    { from: 'submitted',    to: 'approved',     action: 'approve' },
    { from: 'submitted',    to: 'draft',        action: 'revise' },
    { from: 'submitted',    to: 'cancelled',    action: 'cancel' },
    { from: 'approved',     to: 'partial_paid', action: 'partial_pay' },
    { from: 'approved',     to: 'paid',         action: 'pay' },
    { from: 'approved',     to: 'cancelled',    action: 'cancel' },
    { from: 'partial_paid', to: 'paid',         action: 'pay' },
    { from: 'paid',         to: 'closed',       action: 'close' },
  ],
};

// ---------------------------------------------------------------------------
// Expense FSM
// ---------------------------------------------------------------------------

export type ExpenseStatus =
  | 'draft'
  | 'submitted'
  | 'approved'
  | 'paid'
  | 'reimbursed'
  | 'rejected';

export const EXPENSE_FSM: Fsm<ExpenseStatus> = {
  entity: 'expense',
  initial: 'draft',
  states: ['draft', 'submitted', 'approved', 'paid', 'reimbursed', 'rejected'],
  transitions: [
    { from: 'draft',     to: 'submitted', action: 'submit' },
    { from: 'submitted', to: 'approved',  action: 'approve' },
    { from: 'submitted', to: 'rejected',  action: 'reject' },
    { from: 'submitted', to: 'draft',     action: 'revise' },
    { from: 'approved',  to: 'paid',      action: 'pay' },
    { from: 'approved',  to: 'rejected',  action: 'reject' },
    { from: 'paid',      to: 'reimbursed', action: 'reimburse' },
  ],
};

// ---------------------------------------------------------------------------
// Receiving order FSM
// ---------------------------------------------------------------------------

export type ReceivingOrderStatus =
  | 'created'
  | 'in_progress'
  | 'received'
  | 'cancelled';

export const RECEIVING_ORDER_FSM: Fsm<ReceivingOrderStatus> = {
  entity: 'receiving_order',
  initial: 'created',
  states: ['created', 'in_progress', 'received', 'cancelled'],
  transitions: [
    { from: 'created',     to: 'in_progress', action: 'start' },
    { from: 'created',     to: 'cancelled',   action: 'cancel' },
    { from: 'in_progress', to: 'received',    action: 'complete' },
    { from: 'in_progress', to: 'cancelled',   action: 'cancel' },
  ],
};

// ---------------------------------------------------------------------------
// Production run FSM
// ---------------------------------------------------------------------------

export type ProductionRunStatus =
  | 'planned'
  | 'in_progress'
  | 'completed'
  | 'cancelled';

export const PRODUCTION_RUN_FSM: Fsm<ProductionRunStatus> = {
  entity: 'production_run',
  initial: 'planned',
  states: ['planned', 'in_progress', 'completed', 'cancelled'],
  transitions: [
    { from: 'planned',     to: 'in_progress', action: 'start' },
    { from: 'planned',     to: 'cancelled',   action: 'cancel' },
    { from: 'in_progress', to: 'completed',   action: 'complete' },
    { from: 'in_progress', to: 'cancelled',   action: 'cancel' },
  ],
};

// ---------------------------------------------------------------------------
// Shipment FSM
// ---------------------------------------------------------------------------

export type ShipmentStatus =
  | 'created'
  | 'picking'
  | 'shipped'
  | 'cancelled';

export const SHIPMENT_FSM: Fsm<ShipmentStatus> = {
  entity: 'shipment',
  initial: 'created',
  states: ['created', 'picking', 'shipped', 'cancelled'],
  transitions: [
    { from: 'created', to: 'picking',   action: 'start_pick' },
    { from: 'created', to: 'cancelled', action: 'cancel' },
    { from: 'picking', to: 'shipped',   action: 'ship' },
    { from: 'picking', to: 'cancelled', action: 'cancel' },
  ],
};

export const VENDORS_INVENTORY_OPS_FSMS = {
  purchase_order:  PURCHASE_ORDER_FSM,
  vendor_bill:     VENDOR_BILL_FSM,
  expense:         EXPENSE_FSM,
  receiving_order: RECEIVING_ORDER_FSM,
  production_run:  PRODUCTION_RUN_FSM,
  shipment:        SHIPMENT_FSM,
} as const;

export function canTransitionVio<S extends string>(
  fsm: Fsm<S>,
  from: S,
  to: S,
): boolean {
  return fsm.transitions.some((t) => t.from === from && t.to === to);
}
