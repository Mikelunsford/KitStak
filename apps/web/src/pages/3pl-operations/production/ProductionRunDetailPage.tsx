import { useParams } from 'react-router-dom';
import { AuditTimeline } from '@/components/shell/AuditTimeline';
import { Breadcrumbs } from '@/components/shell/Breadcrumbs';
import { StateStepper } from '@/components/shell/StateStepper';
import { EntityLabel } from '@/components/data/EntityLabel';
import { useProductionRun, useStartProductionRun, useCompleteProductionRun } from '@/lib/hooks/useOps';
import { useVioCapabilities } from '@/lib/hooks/useVioCapabilities';
import { destructiveConfirm } from '@/lib/destructiveConfirm';
import {
  STATE_STEPPER_PATHS,
  isOffPath,
} from '@/lib/workflow/stateStepperPaths';

export function ProductionRunDetailPage() {
  const { id } = useParams<{ id: string }>();
  const run = useProductionRun(id);
  const start = useStartProductionRun(id ?? '');
  const complete = useCompleteProductionRun(id ?? '');
  const caps = useVioCapabilities();
  if (run.isLoading) return <p className="px-8 py-12 text-ink-dim">Loading.</p>;
  if (run.error || !run.data) return <p className="px-8 py-12 text-accent">Production run not found.</p>;
  const d = run.data;
  return (
    <section className="px-8 py-12 max-w-4xl mx-auto flex flex-col gap-6">
      <Breadcrumbs
        items={[
          { label: 'Production', to: '/3pl-operations/production' },
          { label: 'Runs', to: '/3pl-operations/production' },
          { label: d.run_number ?? d.id.slice(0, 8) },
        ]}
      />
      {/* UX-Q7: display-only horizontal progress stepper. */}
      <StateStepper
        steps={[...STATE_STEPPER_PATHS.production_run.path]}
        current={d.status}
        offPath={
          isOffPath('production_run', d.status)
            ? {
                state: d.status,
                label: STATE_STEPPER_PATHS.production_run.resolveLabel(d.status),
              }
            : undefined
        }
      />
      <header className="flex items-center justify-between">
        <h1 className="text-4xl font-display tracking-wide text-ink">RUN {d.run_number ?? d.id.slice(0, 8)}</h1>
      </header>
      <div className="flex gap-2">
        {d.status === 'planned' && caps.can('production.start') ? (
          <button onClick={() => start.mutate()} disabled={start.isPending}
            className="px-3 py-1 border border-line font-sans text-xs uppercase text-ink hover:bg-bg-2">Start</button>
        ) : null}
        {d.status === 'in_progress' && caps.can('production.complete') ? (
          <button
            onClick={async () => {
              // UX-Q8: Complete on a production run writes
              // production_consumed and production_produced stock
              // movements; the transition cannot be undone.
              if (!(await destructiveConfirm({
                action: 'Complete this production run',
                consequence: 'This writes production_consumed and production_produced stock movements.',
                irreversible: true,
              }))) return;
              complete.mutate({ quantity_produced: d.quantity_planned, consumed: [] });
            }}
            disabled={complete.isPending}
            className="px-3 py-1 border border-line font-sans text-xs uppercase text-ink hover:bg-bg-2">Complete</button>
        ) : null}
      </div>
      {(start.error || complete.error) && (
        <p className="font-sans text-sm text-accent">
          {(start.error instanceof Error && start.error.message) ||
            (complete.error instanceof Error && complete.error.message) ||
            'Action failed.'}
        </p>
      )}
      <dl className="grid grid-cols-2 gap-4 font-sans text-sm">
        <dt className="text-ink-dim">Warehouse</dt><dd className="text-ink"><EntityLabel kind="warehouse" id={d.warehouse_id} /></dd>
        <dt className="text-ink-dim">Output item</dt><dd className="text-ink"><EntityLabel kind="item" id={d.output_item_id} /></dd>
        <dt className="text-ink-dim">Planned</dt><dd className="text-ink">{String(d.quantity_planned)}</dd>
        <dt className="text-ink-dim">Produced</dt><dd className="text-ink">{String(d.quantity_produced)}</dd>
        <dt className="text-ink-dim">Scheduled</dt><dd className="text-ink">{d.scheduled_for ?? ''}</dd>
      </dl>

      <section className="mt-6">
        <h2 className="text-2xl font-display tracking-wide text-ink mb-3">HISTORY</h2>
        <AuditTimeline entityType="production_run" entityId={id ?? null} />
      </section>
    </section>
  );
}
