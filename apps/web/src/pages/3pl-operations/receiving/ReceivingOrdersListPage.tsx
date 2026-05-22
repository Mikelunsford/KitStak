import { Link, useSearchParams } from 'react-router-dom';
import { EntityLabel } from '@/components/data/EntityLabel';
import { ListEmptyState } from '@/components/shell/ListEmptyState';
import { useReceivingOrdersList } from '@/lib/hooks/useOps';
import { useVioCapabilities } from '@/lib/hooks/useVioCapabilities';
import { parseProjectIdParam } from './receivingProjectParam';

export function ReceivingOrdersListPage() {
  const [searchParams] = useSearchParams();
  // UX-Q6: optional server-side filter on project_id. When present, the
  // list shows only receiving orders bound to that project. Mirrors how
  // UX-Q5's status filter narrows the dashboard cards.
  const projectFilter = parseProjectIdParam(searchParams.get('project_id'));
  const { data, isLoading } = useReceivingOrdersList(
    projectFilter ? { project_id: projectFilter } : {},
  );
  const caps = useVioCapabilities();
  return (
    <section className="px-8 py-12 max-w-6xl mx-auto flex flex-col gap-6">
      <header className="flex items-center justify-between">
        <h1 className="text-4xl font-display tracking-wide text-ink">RECEIVING</h1>
        {caps.can('receiving.order.create') ? (
          <Link to="/3pl-operations/receiving/new" className="px-4 py-2 bg-accent text-on-primary font-sans text-sm">New receiving order</Link>
        ) : null}
      </header>
      {projectFilter ? (
        <p className="text-ink-dim text-sm font-sans">
          Filtered to project <EntityLabel kind="project" id={projectFilter} />.{' '}
          <Link to="/3pl-operations/receiving" className="text-accent hover:text-accent-bright">
            Clear filter
          </Link>
        </p>
      ) : null}
      {isLoading ? <p className="text-ink-dim">Loading.</p> : null}
      {!isLoading && (data ?? []).length === 0 ? (
        <ListEmptyState
          entity="receiving order"
          explainer="Receiving orders track inbound inventory from a vendor or customer."
          addLabel="Add receiving order"
          addTo="/3pl-operations/receiving/new"
          canAdd={caps.can('receiving.order.create')}
        />
      ) : (
      <table className="w-full border border-line text-sm font-sans">
        <thead className="bg-bg-2 text-left text-ink-dim">
          <tr>
            <th className="px-4 py-2">#</th>
            <th className="px-4 py-2">Status</th>
            <th className="px-4 py-2">Warehouse</th>
            <th className="px-4 py-2">Project</th>
            <th className="px-4 py-2">Expected</th>
          </tr>
        </thead>
        <tbody>
          {(data ?? []).map((r) => (
            <tr key={r.id} className="border-t border-line">
              <td className="px-4 py-2"><Link to={`/3pl-operations/receiving/${r.id}`} className="text-ink underline">{r.receiving_number ?? r.id.slice(0, 8)}</Link></td>
              <td className="px-4 py-2"><span className="inline-block px-2 py-0.5 border border-line text-xs font-mono uppercase text-ink-dim">{r.status}</span></td>
              <td className="px-4 py-2 text-ink-dim"><EntityLabel kind="warehouse" id={r.warehouse_id} /></td>
              <td className="px-4 py-2 text-ink-dim">
                {r.project_id ? (
                  <Link
                    to={`/3pl-operations/projects/${r.project_id}`}
                    className="text-ink hover:text-accent"
                  >
                    <EntityLabel kind="project" id={r.project_id} />
                  </Link>
                ) : (
                  ''
                )}
              </td>
              <td className="px-4 py-2 text-ink-dim">{r.expected_date ?? ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
      )}
    </section>
  );
}
