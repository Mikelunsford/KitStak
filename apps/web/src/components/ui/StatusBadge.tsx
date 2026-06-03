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
// revise_requested) so the Quotes list can render a badge instead of raw
// state text. New customer- or operator-visible statuses must be added to
// both maps below when they land in a database state machine.

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
