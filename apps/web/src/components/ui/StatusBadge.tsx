// StatusBadge. Shared status pill: a colored dot plus a humanised label.
//
// Promoted from pages/portal/components/StatusBadge.tsx so both the customer
// portal and the operator app render entity status the same way, instead of
// the operator lists printing raw lowercase enum values. The portal file now
// re-exports from here, so its existing imports and unit test are unchanged.
//
// Color palette mirrors the brand tokens in tailwind.config.js. Unknown
// status values render as a neutral dot with a humanised fallback
// (underscores stripped, sentence case) so the UI never goes blank on an
// unexpected enum value and never leaks engineering speak.
//
// F-Wave9-PORTAL-STATUS-LABEL-HUMANIZE-01 established the portal vocabulary.
// F-Wave10-UI-KIT-01 adds the operator quote states (submitted,
// revise_requested) and the purchase order progress and terminal states
// (partial_received, received, closed) so the Quotes and Purchase Orders
// lists can render a badge instead of raw state text. The 3PL CRUD tail batch
// adds the credit note (issued, applied, voided), expense (reimbursed), and
// vendor bill (partial_paid) finance states. New customer- or operator-visible
// statuses must be added to both maps below when they land in a database state
// machine.

interface StatusBadgeProps {
  status: string;
}

const COLOR_MAP: Record<string, string> = {
  // Invoice statuses
  draft: 'bg-ink-dim',
  pending: 'bg-ink-dim',
  sent: 'bg-accent',
  paid: 'bg-green-500',
  partial: 'bg-yellow-500',
  partially_paid: 'bg-yellow-500',
  overdue: 'bg-accent',
  void: 'bg-ink-dim',
  on_hold: 'bg-ink-dim',
  cancelled: 'bg-ink-dim',
  refunded: 'bg-ink-dim',

  // Quote statuses
  submitted: 'bg-accent',
  revise_requested: 'bg-yellow-500',
  approved: 'bg-green-500',
  declined: 'bg-accent',
  expired: 'bg-ink-dim',
  converted: 'bg-green-500',
  // Quote -> project handoff: the quote stays in the customer's quote list
  // but reads as "Converted to project" in the customer-facing language.
  project_pending: 'bg-green-500',
  rejected: 'bg-accent',

  // Project statuses
  lead: 'bg-ink-dim',
  ready_to_build: 'bg-accent',
  in_production: 'bg-yellow-500',
  ready_to_ship: 'bg-yellow-500',
  shipped: 'bg-green-500',
  completed: 'bg-green-500',
  on_track: 'bg-green-500',
  delayed: 'bg-yellow-500',

  // Customer statuses
  new: 'bg-yellow-500',
  active: 'bg-green-500',
  inactive: 'bg-ink-dim',

  // Purchase order statuses
  partial_received: 'bg-yellow-500',
  received: 'bg-green-500',
  closed: 'bg-ink-dim',

  // Shipment and receiving order statuses (F-Wave10-UI-KIT-01). The terminal
  // states shipped / received / cancelled are mapped above and shared; only
  // the in-flight states are new here.
  created: 'bg-ink-dim',
  picking: 'bg-yellow-500',
  in_progress: 'bg-yellow-500',

  // Co-Pack order, kitting, and fulfillment statuses (F-Wave10-UI-KIT-01).
  // draft / picking / shipped / cancelled / pending / completed are already
  // mapped above and shared; only confirmed, packed, and started are new.
  confirmed: 'bg-accent',
  packed: 'bg-yellow-500',
  started: 'bg-yellow-500',

  // Credit note, expense, and vendor bill finance states (F-Wave10-UI-KIT-01,
  // 3PL CRUD tail). draft / submitted / approved / paid / cancelled / closed
  // are mapped above and shared. Distinct keys here: issued and applied (credit
  // note), voided (credit note; separate from the invoice `void`), reimbursed
  // (expense), partial_paid (vendor bill; separate from the invoice `partial` /
  // `partially_paid`).
  issued: 'bg-accent',
  applied: 'bg-green-500',
  voided: 'bg-ink-dim',
  reimbursed: 'bg-green-500',
  partial_paid: 'bg-yellow-500',

  // CRM activity statuses (F-Wave10-UI-KIT-01). completed / cancelled are
  // mapped above and shared; only open is new.
  open: 'bg-yellow-500',

  // KitForce shift and assignment statuses (F-Wave10-UI-KIT-01). started /
  // completed / cancelled / open / in_progress are mapped above and shared.
  // Distinct keys: scheduled (shift) and assigned (assignment) are accent
  // (live, awaiting the next action); done (assignment) is terminal-positive.
  scheduled: 'bg-accent',
  assigned: 'bg-accent',
  done: 'bg-green-500',

  // Finance journal entry and period-close statuses (F-Wave10-UI-KIT-01).
  // draft / open / closed are mapped above and shared. New: posted
  // (terminal-positive), reversed (terminal-negative), in_review (mid-process),
  // reopened (unlocked, needs re-closing).
  posted: 'bg-green-500',
  reversed: 'bg-ink-dim',
  in_review: 'bg-yellow-500',
  reopened: 'bg-accent',

  // Production run status (F-Wave10-UI-KIT-01). The production_run FSM is
  // planned -> in_progress -> completed (off-path cancelled). in_progress /
  // completed / cancelled are mapped above and shared; only the initial state
  // `planned` is new (neutral, like draft).
  planned: 'bg-ink-dim',
};

/**
 * Humanised labels for every status string the app can render. Sentence
 * case (`Converted to project`, not `Project Pending` and not
 * `PROJECT_PENDING`). No em dashes, no emojis, no underscores. Prefer the
 * phrasing a reader expects (e.g. `Converted to project` reads clearer than
 * the raw `project_pending` state-machine artifact).
 */
const LABEL_MAP: Record<string, string> = {
  // Invoice statuses
  draft: 'Draft',
  pending: 'Pending',
  sent: 'Sent',
  paid: 'Paid',
  partial: 'Partially paid',
  partially_paid: 'Partially paid',
  overdue: 'Overdue',
  void: 'Void',
  on_hold: 'On hold',
  cancelled: 'Cancelled',
  refunded: 'Refunded',

  // Quote statuses
  submitted: 'Submitted',
  revise_requested: 'Revision requested',
  approved: 'Approved',
  declined: 'Declined',
  expired: 'Expired',
  converted: 'Converted',
  project_pending: 'Converted to project',
  rejected: 'Declined',

  // Project statuses
  lead: 'Lead',
  ready_to_build: 'Ready to build',
  in_production: 'In production',
  ready_to_ship: 'Ready to ship',
  shipped: 'Shipped',
  completed: 'Completed',
  on_track: 'On track',
  delayed: 'Delayed',

  // Customer statuses
  new: 'New',
  active: 'Active',
  inactive: 'Inactive',

  // Purchase order statuses
  partial_received: 'Partially received',
  received: 'Received',
  closed: 'Closed',

  // Shipment and receiving order statuses (F-Wave10-UI-KIT-01).
  created: 'Created',
  picking: 'Picking',
  in_progress: 'In progress',

  // Co-Pack order, kitting, and fulfillment statuses (F-Wave10-UI-KIT-01).
  confirmed: 'Confirmed',
  packed: 'Packed',
  started: 'Started',

  // Credit note, expense, and vendor bill finance states (F-Wave10-UI-KIT-01).
  // partial_paid follows the invoice `partially_paid` vocabulary. A `rejected`
  // expense still renders the shared "Declined" label (the map is keyed by
  // status string, not entity; entity-aware vocab is a separate change).
  issued: 'Issued',
  applied: 'Applied',
  voided: 'Voided',
  reimbursed: 'Reimbursed',
  partial_paid: 'Partially paid',

  // CRM activity statuses (F-Wave10-UI-KIT-01).
  open: 'Open',

  // KitForce shift and assignment statuses (F-Wave10-UI-KIT-01).
  scheduled: 'Scheduled',
  assigned: 'Assigned',
  done: 'Done',

  // Finance journal entry and period-close statuses (F-Wave10-UI-KIT-01).
  posted: 'Posted',
  reversed: 'Reversed',
  in_review: 'In review',
  reopened: 'Reopened',

  // Production run status (F-Wave10-UI-KIT-01).
  planned: 'Planned',
};

/**
 * Humanise a raw status string. Lookup by exact value first; fall back to
 * a defensive transform that lowercases, strips underscores, and sentence-
 * cases the result so an unmapped value like `some_new_state` reads as
 * `Some new state` rather than the raw enum. Pure function so unit tests can
 * lock the contract without a render path.
 */
export function humaniseStatus(raw: string): string {
  if (!raw) return '';
  // Normalise to the lookup key shape. Database enums are lowercase but
  // some Postgres state-machine columns ship Pascal_Snake_Case rows
  // through to the response; lowercasing first makes the lookup tolerant.
  const key = raw.toLowerCase();
  const mapped = LABEL_MAP[key];
  if (mapped !== undefined) return mapped;
  // Defensive fallback: replace underscores with spaces, lowercase the
  // whole string, capitalise the first letter. Never returns the raw
  // value with an underscore intact.
  const spaced = key.replace(/_+/g, ' ').trim();
  if (spaced.length === 0) return '';
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export function statusColorClass(raw: string): string {
  const key = (raw ?? '').toLowerCase();
  return COLOR_MAP[key] ?? 'bg-ink-dim';
}

export function StatusBadge({ status }: StatusBadgeProps) {
  const colorClass = statusColorClass(status);
  const label = humaniseStatus(status);
  return (
    <span className="inline-flex items-center gap-2 text-sm text-ink-dim">
      <span
        className={`inline-block h-2 w-2 rounded-full ${colorClass}`}
        aria-hidden="true"
      />
      {label}
    </span>
  );
}
