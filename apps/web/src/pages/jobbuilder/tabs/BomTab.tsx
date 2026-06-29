// BOM tab: the project materials this job consumes (read-only here; the bill of
// materials is owned by the project / catalog surfaces). Pure presentational so
// the element-tree walk can test it. ADR 0006 P2c.

import { Link } from 'react-router-dom';

import { num } from '@/lib/jobbuilder/jobLogic';
import type { BomItem } from '@/lib/jobbuilder/jobModel';

export function BomTab({ items, projectId }: { items: BomItem[]; projectId: string | null }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h3 className="font-display text-lg tracking-wide text-ink">Bill of materials</h3>
          <p className="font-sans text-sm text-ink-dim">
            The project materials this job consumes. Edit them on the project.
          </p>
        </div>
        {projectId ? (
          <Link
            to={`/projects/${projectId}`}
            className="shrink-0 font-sans text-sm text-accent"
          >
            Open project
          </Link>
        ) : null}
      </div>

      {items.length === 0 ? (
        <p className="border border-line bg-bg-2 px-4 py-6 text-center font-sans text-sm text-ink-faint">
          No materials on the project yet.
        </p>
      ) : (
        <div className="border border-line">
          <div className="grid grid-cols-[1fr_120px] gap-3 border-b border-line bg-bg-2 px-4 py-2 font-sans text-xs uppercase tracking-wide text-ink-dim">
            <span>Material</span>
            <span className="text-right">Quantity</span>
          </div>
          {items.map((it, idx) => (
            <div
              key={idx}
              className="grid grid-cols-[1fr_120px] items-center gap-3 border-b border-line px-4 py-2.5 last:border-0"
            >
              <span className="font-sans text-sm text-ink">{it.desc || it.itemNo}</span>
              <span className="text-right font-sans text-sm tabular-nums text-ink-dim">
                {num(it.perUnit).toLocaleString()}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
