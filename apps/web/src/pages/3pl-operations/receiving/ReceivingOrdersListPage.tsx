import { Link } from 'react-router-dom';
import { useReceivingOrdersList } from '@/lib/hooks/useOps';
import { useVioCapabilities } from '@/lib/hooks/useVioCapabilities';

export function ReceivingOrdersListPage() {
  const { data, isLoading } = useReceivingOrdersList();
  const caps = useVioCapabilities();
  return (
    <section className="px-8 py-12 max-w-6xl mx-auto flex flex-col gap-6">
      <header className="flex items-center justify-between">
        <h1 className="text-4xl font-display tracking-wide text-ink">RECEIVING</h1>
        {caps.can('receiving.order.create') ? (
          <Link to="/3pl-operations/receiving/new" className="px-4 py-2 bg-accent text-on-primary font-sans text-sm">New receiving order</Link>
        ) : null}
      </header>
      {isLoading ? <p className="text-ink-dim">Loading.</p> : null}
      <table className="w-full border border-line text-sm font-sans">
        <thead className="bg-bg-2 text-left text-ink-dim">
          <tr><th className="px-4 py-2">#</th><th className="px-4 py-2">Status</th><th className="px-4 py-2">Warehouse</th><th className="px-4 py-2">Expected</th></tr>
        </thead>
        <tbody>
          {(data ?? []).map((r) => (
            <tr key={r.id} className="border-t border-line">
              <td className="px-4 py-2"><Link to={`/3pl-operations/receiving/${r.id}`} className="text-ink underline">{r.receiving_number ?? r.id.slice(0, 8)}</Link></td>
              <td className="px-4 py-2"><span className="inline-block px-2 py-0.5 border border-line text-xs font-mono uppercase text-ink-dim">{r.status}</span></td>
              <td className="px-4 py-2 text-ink-dim">{r.warehouse_id.slice(0, 8)}</td>
              <td className="px-4 py-2 text-ink-dim">{r.expected_date ?? ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
