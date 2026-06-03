// StatCard. Shared count tile for pillar-home status grids (F-Wave10-UI-KIT-01).
// A bordered surface that links to a filtered list, with a large count and an
// uppercase label. Promoted from the identical count-card markup the Co-Pack,
// Manufacturing, and KitForce home pages each inlined. While loading, the count
// renders as a single dot so the tile stays navigable before the number lands.

import { Link } from 'react-router-dom';

export interface StatCardProps {
  /** Destination route (typically a filtered list deep-link). */
  to: string;
  /** The resolved count. */
  count: number;
  /** Uppercase label under the count. */
  label: string;
  /** When true, render a placeholder dot instead of the count. */
  loading?: boolean;
}

export function StatCard({ to, count, label, loading = false }: StatCardProps) {
  return (
    <Link
      to={to}
      aria-busy={loading}
      className="bg-bg-2 border border-line p-6 flex flex-col gap-2 hover:border-accent"
    >
      <span className="text-4xl font-display tracking-wide text-ink">
        {loading ? '.' : count}
      </span>
      <span className="font-sans text-sm text-ink-dim tracking-wide uppercase">
        {label}
      </span>
    </Link>
  );
}
