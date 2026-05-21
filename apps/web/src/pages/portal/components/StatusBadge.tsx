// StatusBadge. Small colored-dot + label pill used by the portal data tables
// to render invoice / quote / project status without depending on emoji or
// stock UI libraries.
//
// Color palette mirrors the brand tokens in tailwind.config.js. Unknown
// status values render as a neutral grey dot with the raw string so the UI
// never goes blank on an unexpected enum value.

interface StatusBadgeProps {
  status: string;
}

const COLOR_MAP: Record<string, string> = {
  // Invoice statuses
  draft: 'bg-ink-dim',
  sent: 'bg-accent',
  paid: 'bg-green-500',
  partial: 'bg-yellow-500',
  partially_paid: 'bg-yellow-500',
  overdue: 'bg-accent',
  void: 'bg-ink-dim',

  // Quote statuses
  approved: 'bg-green-500',
  declined: 'bg-accent',
  expired: 'bg-ink-dim',
  converted: 'bg-green-500',

  // Project statuses
  lead: 'bg-ink-dim',
  ready_to_build: 'bg-accent',
  in_production: 'bg-yellow-500',
  ready_to_ship: 'bg-yellow-500',
  completed: 'bg-green-500',
  cancelled: 'bg-ink-dim',
};

const LABEL_MAP: Record<string, string> = {
  partially_paid: 'Partial',
  ready_to_build: 'Ready to build',
  in_production: 'In production',
  ready_to_ship: 'Ready to ship',
};

export function StatusBadge({ status }: StatusBadgeProps) {
  const colorClass = COLOR_MAP[status] ?? 'bg-ink-dim';
  const label =
    LABEL_MAP[status] ??
    status.charAt(0).toUpperCase() + status.slice(1).toLowerCase();
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
