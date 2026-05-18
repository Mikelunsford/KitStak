import { Link } from 'react-router-dom';
import { useWarehousesList } from '@/lib/hooks/useInventory';
import { useVioCapabilities } from '@/lib/hooks/useVioCapabilities';

export function WarehousesListPage() {
  const { data, isLoading } = useWarehousesList();
  const caps = useVioCapabilities();
  return (
    <section className="px-8 py-12 max-w-6xl mx-auto flex flex-col gap-6">
      <header className="flex items-center justify-between">
        <h1 className="text-4xl font-display tracking-wide text-ink">WAREHOUSES</h1>
        {caps.can('warehouses.warehouse.create') ? (
          <Link to="/3pl-operations/warehouses/new" className="px-4 py-2 bg-accent text-on-primary font-sans text-sm">New Warehouse</Link>
        ) : null}
      </header>
      {isLoading ? <p className="text-ink-dim">Loading.</p> : null}
      <table className="w-full border border-line text-sm font-sans">
        <thead className="bg-bg-2 text-left text-ink-dim">
          <tr><th className="px-4 py-2">Code</th><th className="px-4 py-2">Name</th><th className="px-4 py-2">Default</th><th className="px-4 py-2">Active</th></tr>
        </thead>
        <tbody>
          {(data ?? []).map((w) => (
            <tr key={w.id} className="border-t border-line">
              <td className="px-4 py-2"><Link to={`/3pl-operations/warehouses/${w.id}`} className="text-ink underline">{w.code}</Link></td>
              <td className="px-4 py-2 text-ink-dim">{w.display_name}</td>
              <td className="px-4 py-2 text-ink-dim">{w.is_default ? 'Yes' : ''}</td>
              <td className="px-4 py-2 text-ink-dim">{w.is_active ? 'Yes' : 'No'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
