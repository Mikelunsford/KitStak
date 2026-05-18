import { useParams } from 'react-router-dom';
import { useProductionRun, useStartProductionRun, useCompleteProductionRun } from '@/lib/hooks/useOps';
import { useVioCapabilities } from '@/lib/hooks/useVioCapabilities';

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
      <header className="flex items-center justify-between">
        <h1 className="text-4xl font-display tracking-wide text-ink">RUN {d.run_number ?? d.id.slice(0, 8)}</h1>
        <span className="px-2 py-0.5 border border-line text-xs font-mono uppercase text-ink-dim">{d.status}</span>
      </header>
      <div className="flex gap-2">
        {d.status === 'planned' && caps.can('production.start') ? (
          <button onClick={() => start.mutate()} disabled={start.isPending}
            className="px-3 py-1 border border-line font-sans text-xs uppercase text-ink hover:bg-bg-2">Start</button>
        ) : null}
        {d.status === 'in_progress' && caps.can('production.complete') ? (
          <button
            onClick={() => complete.mutate({ quantity_produced: d.quantity_planned, consumed: [] })}
            disabled={complete.isPending}
            className="px-3 py-1 border border-line font-sans text-xs uppercase text-ink hover:bg-bg-2">Complete</button>
        ) : null}
      </div>
      <dl className="grid grid-cols-2 gap-4 font-sans text-sm">
        <dt className="text-ink-dim">Warehouse</dt><dd className="text-ink">{d.warehouse_id}</dd>
        <dt className="text-ink-dim">Output item</dt><dd className="text-ink">{d.output_item_id}</dd>
        <dt className="text-ink-dim">Planned</dt><dd className="text-ink">{String(d.quantity_planned)}</dd>
        <dt className="text-ink-dim">Produced</dt><dd className="text-ink">{String(d.quantity_produced)}</dd>
        <dt className="text-ink-dim">Scheduled</dt><dd className="text-ink">{d.scheduled_for ?? ''}</dd>
      </dl>
    </section>
  );
}
