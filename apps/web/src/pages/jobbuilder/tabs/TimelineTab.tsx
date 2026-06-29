// Timeline tab: the run-scoped job_run_timeline (must-arrive-by, materials ETA,
// build window, ship date) run against MABD via the ported jobLogic. Each field
// upserts the singleton timeline. Uses hooks, so it is not element-tree-walk
// tested; the scale / milestone / schedule math is unit-tested in jobLogic.
// ADR 0006 P2c.

import { useUpsertJobRunTimeline } from '@/lib/hooks/useJobArtifacts';
import { milestones, scheduleCheck, timelineScale } from '@/lib/jobbuilder/jobLogic';
import type { Job } from '@/lib/jobbuilder/jobModel';
import type { JobRunTimelinePatch } from '@/lib/types/jobbuilder';

const FIELD =
  'bg-bg-2 border border-line text-ink px-3 py-2 font-sans text-sm focus:outline-none focus:border-accent';

function flagClasses(ok: boolean | null): string {
  if (ok == null) return 'border-line text-ink-dim';
  return ok ? 'border-line text-ink' : 'border-accent text-accent';
}

export function TimelineTab({ runId, job }: { runId: string; job: Job }) {
  const upsert = useUpsertJobRunTimeline(runId);
  const set = (patch: JobRunTimelinePatch) => upsert.mutate(patch);

  const scale = timelineScale(job.timeline, job.mabd);
  const ms = milestones(job.timeline, job.mabd, job.ro.eta);
  const onTrack = scheduleCheck(job.timeline, job.mabd, job.ro.eta).onTrack;
  const mabdColor = onTrack ? 'bg-ink' : 'bg-accent';

  const fields: Array<{ label: string; value: string; key: keyof JobRunTimelinePatch }> = [
    { label: 'MABD / target', value: job.mabd, key: 'mabd' },
    { label: 'Materials ETA', value: job.timeline.materialsEta, key: 'materials_eta' },
    { label: 'Build start', value: job.timeline.buildStart, key: 'build_start' },
    { label: 'Build end', value: job.timeline.buildEnd, key: 'build_end' },
    { label: 'Ship date', value: job.timeline.ship, key: 'ship_date' },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h3 className="font-display text-lg tracking-wide text-ink">Project timeline</h3>
        <p className="font-sans text-sm text-ink-dim">
          Materials ETA, build window, and ship date, run against MABD.
        </p>
      </div>

      <div className="border border-line bg-bg-2 px-6 pb-5 pt-6">
        <div className="relative mx-2 h-12">
          <div className="absolute left-0 right-0 top-5 h-px bg-line" />
          <div className="absolute top-[18px] h-2 bg-ink" style={{ left: `${scale.buildLeft}%`, width: `${scale.buildWidth}%` }} />
          <div className="absolute top-3 h-4 w-px bg-ink-dim" style={{ left: `${scale.matPct}%` }} />
          <div className="absolute top-3 h-4 w-px bg-ink" style={{ left: `${scale.shipPct}%` }} />
          <div className={`absolute bottom-1 top-1 w-px ${mabdColor}`} style={{ left: `${scale.mabdPct}%` }} />
          <span className="absolute top-8 -translate-x-1/2 whitespace-nowrap font-sans text-[10px] text-ink-faint" style={{ left: `${scale.matPct}%` }}>Materials</span>
          <span className="absolute top-0 -translate-x-1/2 whitespace-nowrap font-sans text-[10px] text-ink-dim" style={{ left: `${scale.mabdPct}%` }}>MABD</span>
          <span className="absolute top-8 -translate-x-1/2 whitespace-nowrap font-sans text-[10px] text-ink-dim" style={{ left: `${scale.shipPct}%` }}>Ship</span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {fields.map((f) => (
          <label key={f.key} className="flex flex-col gap-1.5">
            <span className="font-sans text-xs uppercase tracking-wide text-ink-dim">{f.label}</span>
            <input
              type="date"
              defaultValue={f.value}
              onChange={(e) => set({ [f.key]: e.target.value || null })}
              className={FIELD}
            />
          </label>
        ))}
      </div>

      <div className="border border-line">
        {ms.map((m) => (
          <div key={m.label} className="flex items-center justify-between gap-4 border-b border-line px-4 py-3 last:border-0">
            <div className="flex flex-col">
              <span className="font-sans text-sm text-ink">{m.label}</span>
              <span className="font-sans text-xs text-ink-faint tabular-nums">{m.dateStr}</span>
            </div>
            <span className={`border px-2 py-0.5 font-sans text-xs uppercase tracking-wide ${flagClasses(m.ok)}`}>
              {m.flag}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
