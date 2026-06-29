// The Job Builder list: every job_run as a buildable job, opening the builder.
// Pure / presentational (receives the runs, renders Links) so the element-tree
// walk can test it. Reconciled to the live design system. ADR 0006 P2c.

import { Link } from 'react-router-dom';

import type { JobRun } from '@/lib/types/threepl';

export const JOB_BUILDER_BASE = '/3pl-operations/job-builder';

export function JobBuilderList({ runs }: { runs: JobRun[] }) {
  if (runs.length === 0) {
    return (
      <p className="border border-line bg-bg-2 px-4 py-6 text-center font-sans text-sm text-ink-faint">
        No jobs yet. Build one from an approved quote.
      </p>
    );
  }

  return (
    <div className="border border-line">
      <div className="grid grid-cols-[1.4fr_1fr_1fr] gap-3 border-b border-line bg-bg-2 px-4 py-2.5 font-sans text-xs uppercase tracking-wide text-ink-dim">
        <span>Run</span>
        <span>Status</span>
        <span className="text-right">Open</span>
      </div>
      {runs.map((run) => (
        <Link
          key={run.id}
          to={`${JOB_BUILDER_BASE}/${run.id}`}
          className="grid grid-cols-[1.4fr_1fr_1fr] items-center gap-3 border-b border-line px-4 py-3 last:border-0 hover:bg-bg-2"
        >
          <span className="font-sans text-sm text-ink">{run.run_number ?? run.id}</span>
          <span className="font-sans text-xs uppercase tracking-wide text-ink-dim">
            {run.status}
          </span>
          <span className="text-right font-sans text-sm text-accent">Open the build</span>
        </Link>
      ))}
    </div>
  );
}
