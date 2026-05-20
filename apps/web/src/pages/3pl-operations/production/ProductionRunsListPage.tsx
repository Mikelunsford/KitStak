import { Link } from 'react-router-dom';
import { EntityLabel } from '@/components/data/EntityLabel';
import { useProductionRunsList } from '@/lib/hooks/useOps';
import { useVioCapabilities } from '@/lib/hooks/useVioCapabilities';

export function ProductionRunsListPage() {
  const { data, isLoading } = useProductionRunsList();
  const caps = useVioCapabilities();
  return (
    <section className="px-8 py-12 max-w-6xl mx-auto flex flex-col gap-6">
      <header className="flex items-center justify-between">
        <h1 className="text-4xl font-display tracking-wide text-ink">PRODUCTION RUNS</h1>
        {caps.can('production.run.create') ? (
          <Link to="/3pl-operations/production/new" className="px-4 py-2 bg-accent text-on-primary font-sans text-sm">New Production Run</Link>
        ) : null}
      </header>
      {isLoading ? <p className="text-ink-dim">Loading.</p> : null}
      <table className="w-full border border-line text-sm font-sans">
        <thead className="bg-bg-2 text-left text-ink-dim">
          <tr><th className="px-4 py-2">#</th><th className="px-4 py-2">Status</th><th className="px-4 py-2">Output item</th><th className="px-4 py-2">Planned</th><th className="px-4 py-2">Produced</th></tr>
        </thead>
        <tbody>
          {(data ?? []).map((r) => (
            <tr key={r.id} className="border-t border-line">
              <td className="px-4 py-2"><Link to={`/3pl-operations/production/${r.id}`} className="text-ink underline">{r.run_number ?? r.id.slice(0, 8)}</Link></td>
              <td className="px-4 py-2"><span className="inline-block px-2 py-0.5 border border-line text-xs font-mono uppercase text-ink-dim">{r.status}</span></td>
              <td className="px-4 py-2 text-ink-dim"><EntityLabel kind="item" id={r.output_item_id} /></td>
              <td className="px-4 py-2 text-ink-dim">{String(r.quantity_planned)}</td>
              <td className="px-4 py-2 text-ink-dim">{String(r.quantity_produced)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
