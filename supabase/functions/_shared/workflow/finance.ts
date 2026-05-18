// Finance workflow canon. Byte-mirror of apps/web/src/lib/workflow/finance.ts.
// Invoice state machine: 9 states. Credit note: 4 states. Journal entry: 3
// states. Period close: 4 states (text CHECK, not pg enum per AUDIT row 65).
// The DB CHECK constraint and audit triggers are authority; the SPA hides
// invalid buttons via canFinanceTransition().

export type FinanceFsmTransition<S extends string> = {
  from: S;
  to: S;
  action: string;
};

export type FinanceFsm<S extends string> = {
  entity: string;
  initial: S;
  states: readonly S[];
  transitions: readonly FinanceFsmTransition<S>[];
};

// ---------------------------------------------------------------------------
// Invoice: 9 states. Terminal: refunded, cancelled.
// ---------------------------------------------------------------------------

export type InvoiceState =
  | 'draft'
  | 'pending'
  | 'sent'
  | 'partially_paid'
  | 'paid'
  | 'overdue'
  | 'refunded'
  | 'cancelled'
  | 'on_hold';

export const invoiceStateMachine: FinanceFsm<InvoiceState> = {
  entity: 'invoice',
  initial: 'draft',
  states: [
    'draft', 'pending', 'sent', 'partially_paid', 'paid',
    'overdue', 'refunded', 'cancelled', 'on_hold',
  ],
  transitions: [
    { from: 'draft',          to: 'pending',        action: 'submit' },
    { from: 'pending',        to: 'sent',           action: 'send' },
    { from: 'draft',          to: 'sent',           action: 'send' },
    { from: 'sent',           to: 'partially_paid', action: 'partial_payment' },
    { from: 'sent',           to: 'paid',           action: 'pay' },
    { from: 'partially_paid', to: 'paid',           action: 'pay' },
    { from: 'sent',           to: 'overdue',        action: 'mark_overdue' },
    { from: 'partially_paid', to: 'overdue',        action: 'mark_overdue' },
    { from: 'overdue',        to: 'partially_paid', action: 'partial_payment' },
    { from: 'overdue',        to: 'paid',           action: 'pay' },
    { from: 'paid',           to: 'refunded',       action: 'refund' },
    { from: 'draft',          to: 'cancelled',      action: 'cancel' },
    { from: 'pending',        to: 'cancelled',      action: 'cancel' },
    { from: 'sent',           to: 'cancelled',      action: 'cancel' },
    { from: 'sent',           to: 'on_hold',        action: 'hold' },
    { from: 'partially_paid', to: 'on_hold',        action: 'hold' },
    { from: 'overdue',        to: 'on_hold',        action: 'hold' },
    { from: 'on_hold',        to: 'sent',           action: 'unhold' },
    { from: 'on_hold',        to: 'cancelled',      action: 'cancel' },
  ],
};

// ---------------------------------------------------------------------------
// Credit note: 4 states. Terminal: voided.
// ---------------------------------------------------------------------------

export type CreditNoteState =
  | 'draft'
  | 'issued'
  | 'applied'
  | 'voided';

export const creditNoteStateMachine: FinanceFsm<CreditNoteState> = {
  entity: 'credit_note',
  initial: 'draft',
  states: ['draft', 'issued', 'applied', 'voided'],
  transitions: [
    { from: 'draft',   to: 'issued',  action: 'issue' },
    { from: 'issued',  to: 'applied', action: 'apply' },
    { from: 'draft',   to: 'voided',  action: 'void' },
    { from: 'issued',  to: 'voided',  action: 'void' },
  ],
};

// ---------------------------------------------------------------------------
// Journal entry: 3 states. Terminal: reversed.
// ---------------------------------------------------------------------------

export type JournalEntryState =
  | 'draft'
  | 'posted'
  | 'reversed';

export const journalEntryStateMachine: FinanceFsm<JournalEntryState> = {
  entity: 'journal_entry',
  initial: 'draft',
  states: ['draft', 'posted', 'reversed'],
  transitions: [
    { from: 'draft',  to: 'posted',   action: 'post' },
    { from: 'posted', to: 'reversed', action: 'reverse' },
  ],
};

// ---------------------------------------------------------------------------
// Period close: 4 states. text CHECK per AUDIT row 65.
// ---------------------------------------------------------------------------

export type PeriodCloseState =
  | 'open'
  | 'in_review'
  | 'closed'
  | 'reopened';

export const periodCloseStateMachine: FinanceFsm<PeriodCloseState> = {
  entity: 'period_close',
  initial: 'open',
  states: ['open', 'in_review', 'closed', 'reopened'],
  transitions: [
    { from: 'open',      to: 'in_review', action: 'start_review' },
    { from: 'in_review', to: 'closed',    action: 'close' },
    { from: 'open',      to: 'closed',    action: 'close' },
    { from: 'closed',    to: 'reopened',  action: 'reopen' },
    { from: 'reopened',  to: 'closed',    action: 'close' },
  ],
};

export const FINANCE_FSMS = {
  invoice: invoiceStateMachine,
  credit_note: creditNoteStateMachine,
  journal_entry: journalEntryStateMachine,
  period_close: periodCloseStateMachine,
} as const;

export function canFinanceTransition<S extends string>(
  fsm: FinanceFsm<S>,
  from: S,
  to: S,
): boolean {
  if (from === to) return true;
  return fsm.transitions.some((t) => t.from === from && t.to === to);
}
