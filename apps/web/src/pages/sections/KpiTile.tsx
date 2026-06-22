// Shared KPI tile for the Section Dashboards (Phase 1). Bordered surface with a
// muted uppercase label, a large display value, and an optional sub-line.
// Matches the KitCost dashboard tile so the section homes read as one family.

export interface KpiTileProps {
  label: string;
  value: string;
  sub?: string;
  /** Render the value in the accent color (used for attention metrics like late jobs). */
  accent?: boolean;
}

export function KpiTile({ label, value, sub, accent = false }: KpiTileProps) {
  return (
    <div className="border border-line bg-bg-2 p-4">
      <p className="text-xs uppercase tracking-wider text-ink-dim">{label}</p>
      <p
        className={`mt-1 font-display text-3xl tracking-wide ${
          accent ? 'text-accent' : 'text-ink'
        }`}
      >
        {value}
      </p>
      {sub ? <p className="mt-1 text-xs text-ink-dim">{sub}</p> : null}
    </div>
  );
}
