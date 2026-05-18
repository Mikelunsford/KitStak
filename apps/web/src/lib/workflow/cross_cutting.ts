// Cross-cutting workflow canon. Byte-mirror of
// apps/web/src/lib/workflow/cross_cutting.ts.
//
// The cross-cutting surfaces (audit, search, dashboard, notifications,
// imports, exports, portal) have no state machines of their own. Their
// records advance via single-step lifecycle (queued -> delivered for
// notifications, validated -> committed for imports) that the handler
// drives explicitly.
//
// This module also publishes ALL_STATE_MACHINES, the union of every FSM
// in the codebase. Filled at Phase 2 close by Canon Steward.

import { IDENTITY_FSMS } from './identity.ts';
import { CRM_FSMS } from './crm.ts';
import { SALES_FSMS } from './sales.ts';
import { FINANCE_FSMS } from './finance.ts';
import { VENDORS_INVENTORY_OPS_FSMS } from './vendors_inventory_ops.ts';

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
// NotificationLifecycle: not a true FSM (no transitions enforced via CHECK),
// documented here for completeness.
// ---------------------------------------------------------------------------
export type NotificationLifecycleState = 'queued' | 'delivered' | 'read';

export const NOTIFICATION_LIFECYCLE: Fsm<NotificationLifecycleState> = {
  entity: 'notification',
  initial: 'queued',
  states: ['queued', 'delivered', 'read'],
  transitions: [
    { from: 'queued',    to: 'delivered', action: 'deliver' },
    { from: 'delivered', to: 'read',      action: 'mark_read' },
  ],
};

// ---------------------------------------------------------------------------
// ImportLifecycle: validated -> committed. Pure documentation; handlers drive.
// ---------------------------------------------------------------------------
export type ImportLifecycleState = 'pending' | 'validated' | 'committed';

export const IMPORT_LIFECYCLE: Fsm<ImportLifecycleState> = {
  entity: 'import_job',
  initial: 'pending',
  states: ['pending', 'validated', 'committed'],
  transitions: [
    { from: 'pending',   to: 'validated', action: 'validate' },
    { from: 'validated', to: 'committed', action: 'commit' },
  ],
};

// ---------------------------------------------------------------------------
// ALL_STATE_MACHINES: every FSM declared anywhere in the codebase, widened
// to Fsm<string> so callers can iterate uniformly. Each domain side-car
// defines its own Fsm<S> generic but the structural shape is identical, so
// the cast is sound at runtime.
//
// Coverage: 14 state-changing entities plus the two cross-cutting lifecycle
// helpers above. Audit triggers are wired across migrations 0002, 0010,
// 0017, 0024, 0027, 0028, 0033 (organizations, leads, opportunities,
// quotes, projects, project_phases, invoices, credit_notes,
// journal_entries, purchase_orders, vendor_bills, expenses,
// receiving_orders, production_runs, shipments) and verified by
// migration 0037 `audit_trigger_coverage_gaps()`.
// ---------------------------------------------------------------------------

type AnyFsm = Fsm<string>;

const DOMAIN_FSMS: ReadonlyArray<AnyFsm> = [
  IDENTITY_FSMS.organization as unknown as AnyFsm,
  CRM_FSMS.lead as unknown as AnyFsm,
  CRM_FSMS.opportunity as unknown as AnyFsm,
  SALES_FSMS.quote as unknown as AnyFsm,
  SALES_FSMS.project as unknown as AnyFsm,
  SALES_FSMS.project_phase as unknown as AnyFsm,
  FINANCE_FSMS.invoice as unknown as AnyFsm,
  FINANCE_FSMS.credit_note as unknown as AnyFsm,
  FINANCE_FSMS.journal_entry as unknown as AnyFsm,
  FINANCE_FSMS.period_close as unknown as AnyFsm,
  VENDORS_INVENTORY_OPS_FSMS.purchase_order as unknown as AnyFsm,
  VENDORS_INVENTORY_OPS_FSMS.vendor_bill as unknown as AnyFsm,
  VENDORS_INVENTORY_OPS_FSMS.expense as unknown as AnyFsm,
  VENDORS_INVENTORY_OPS_FSMS.receiving_order as unknown as AnyFsm,
  VENDORS_INVENTORY_OPS_FSMS.production_run as unknown as AnyFsm,
  VENDORS_INVENTORY_OPS_FSMS.shipment as unknown as AnyFsm,
];

export const ALL_STATE_MACHINES: ReadonlyArray<AnyFsm> = [
  ...DOMAIN_FSMS,
  NOTIFICATION_LIFECYCLE,
  IMPORT_LIFECYCLE,
];
