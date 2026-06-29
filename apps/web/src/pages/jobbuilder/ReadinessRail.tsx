// The Job Builder readiness rail: schedule verdict (ship vs MABD), the BOM unit
// total, and the 5-point readiness checklist. Pure / presentational (no hooks)
// so the element-tree walk can test it directly. Reconciled to the live design
// system: semantic tokens, flat and square, no slate/brand classes. ADR 0006 P2c.

import { readinessChecks, scheduleCheck, totalInboundUnits } from '@/lib/jobbuilder/jobLogic';
import type { Job } from '@/lib/jobbuilder/jobModel';

export function ReadinessRail({ job }: { job: Job }) {
  const sched = scheduleCheck(job.timeline, job.mabd, job.ro.eta);
  const { checks, readyCount } = readinessChecks(job);
  // Flat palette: neutral ink until a ship date is set, ink when on track, the
  // brand accent (red) when at risk. No invented success/warn colors.
  const statusColor = !job.timeline.ship
    ? 'text-ink-dim'
    : sched.allGreen
      ? 'text-ink'
      : 'text-accent';

  return (
    <aside className="flex flex-col gap-5 border border-line bg-bg-2 p-5">
      <div className="flex flex-col gap-1">
        <span className="font-sans text-xs uppercase tracking-wide text-ink-dim">
          Schedule check
        </span>
        <span className={`font-display text-2xl tracking-wide ${statusColor}`}>
          {sched.statusBig}
        </span>
        <span className="font-sans text-sm text-ink-dim">{sched.statusDetail}</span>
      </div>

      <div className="h-px bg-line" />

      <div className="flex flex-col gap-1">
        <span className="font-sans text-xs uppercase tracking-wide text-ink-dim">
          BOM units (inbound total)
        </span>
        <span className="font-display text-3xl tracking-wide text-ink tabular-nums">
          {totalInboundUnits(job).toLocaleString()}
        </span>
      </div>

      <div className="h-px bg-line" />

      <div className="flex flex-col gap-3">
        <span className="font-sans text-xs uppercase tracking-wide text-ink-dim">
          {`Readiness · ${readyCount}/5`}
        </span>
        {checks.map((c) => (
          <div key={c.label} className="flex items-center gap-3">
            <span
              className={
                'flex h-4 w-4 items-center justify-center border text-[10px] ' +
                (c.ok ? 'border-accent bg-accent text-ink' : 'border-line text-transparent')
              }
              aria-hidden="true"
            >
              {c.ok ? 'x' : ''}
            </span>
            <span className={`font-sans text-sm ${c.ok ? 'text-ink' : 'text-ink-faint'}`}>
              {c.label}
            </span>
          </div>
        ))}
      </div>
    </aside>
  );
}
