// The Job Builder for one run: header, the six build tabs, and the readiness
// rail. Container component (uses the data + mutation hooks) that feeds the pure
// rail and the editing tabs. ADR 0006 P2c.

import { Link } from 'react-router-dom';

import { Tabs } from '@/components/ui/Tabs';
import { fmtDate } from '@/lib/jobbuilder/jobLogic';
import { useJobBuilderData } from './useJobBuilderData';
import { JOB_BUILDER_BASE } from './JobBuilderList';
import { ReadinessRail } from './ReadinessRail';
import { BomTab } from './tabs/BomTab';
import { ReceivingTab } from './tabs/ReceivingTab';
import { LabelsTab } from './tabs/LabelsTab';
import { SowTab } from './tabs/SowTab';
import { TimelineTab } from './tabs/TimelineTab';
import { JacketTab } from './tabs/JacketTab';

export function JobBuilderDetail({ runId }: { runId: string }) {
  const bundle = useJobBuilderData(runId);
  const { job } = bundle;

  if (bundle.notFound) {
    return <p className="px-8 py-12 font-sans text-sm text-accent">Job not found.</p>;
  }
  if (bundle.isLoading) {
    return <p className="px-8 py-12 font-sans text-sm text-ink-dim">Loading the build.</p>;
  }

  const tabs = [
    { key: 'bom', label: `BOM · ${job.items.length}`, panel: <BomTab items={job.items} projectId={bundle.projectId} /> },
    { key: 'receiving', label: 'Receiving', panel: <ReceivingTab receivingOrder={bundle.receivingOrder} receivingOrderId={bundle.receivingOrderId} /> },
    { key: 'labels', label: `Labels · ${bundle.labelRows.length}`, panel: <LabelsTab runId={runId} labels={bundle.labelRows} /> },
    { key: 'sow', label: `Scope · ${bundle.sowRows.length}`, panel: <SowTab runId={runId} steps={bundle.sowRows} /> },
    { key: 'timeline', label: 'Timeline', panel: <TimelineTab runId={runId} job={job} /> },
    { key: 'jacket', label: 'Job jacket', panel: <JacketTab runId={runId} jacket={bundle.jacketRow} job={job} /> },
  ];

  return (
    <section className="mx-auto flex max-w-6xl flex-col gap-6 px-8 py-12">
      <div className="flex flex-col gap-1">
        <Link to={JOB_BUILDER_BASE} className="self-start font-sans text-sm text-ink-dim hover:text-accent">
          All jobs
        </Link>
        <div className="flex flex-wrap items-end justify-between gap-4 border-b border-line pb-5">
          <div className="flex flex-col gap-1">
            <h1 className="font-display text-4xl uppercase tracking-wide text-ink">{job.id}</h1>
            <span className="font-sans text-sm text-ink-dim">
              {[job.project, job.customer].filter(Boolean).join(' · ') || 'Unlinked run'}
            </span>
          </div>
          <div className="flex flex-col items-end gap-0.5">
            <span className="font-sans text-xs uppercase tracking-wide text-ink-dim">MABD / target ship</span>
            <span className="font-display text-lg tracking-wide text-ink tabular-nums">{fmtDate(job.mabd)}</span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 items-start gap-7 lg:grid-cols-[1fr_300px]">
        <div className="min-w-0">
          <Tabs tabs={tabs} aria-label="Job build" defaultKey="bom" />
        </div>
        <ReadinessRail job={job} />
      </div>
    </section>
  );
}
