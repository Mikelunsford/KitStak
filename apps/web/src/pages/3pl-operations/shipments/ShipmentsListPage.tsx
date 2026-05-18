import { Link } from 'react-router-dom';
import { useShipmentsList } from '@/lib/hooks/useOps';

export function ShipmentsListPage() {
  const { data, isLoading } = useShipmentsList();
  return (
    <section className="px-8 py-12 max-w-6xl mx-auto flex flex-col gap-6">
      <h1 className="text-4xl font-display tracking-wide text-ink">SHIPMENTS</h1>
      {isLoading ? <p className="text-ink-dim">Loading.</p> : null}
      <table className="w-full border border-line text-sm font-sans">
        <thead className="bg-bg-2 text-left text-ink-dim">
          <tr><th className="px-4 py-2">#</th><th className="px-4 py-2">Status</th><th className="px-4 py-2">Warehouse</th><th className="px-4 py-2">Ship date</th><th className="px-4 py-2">Carrier</th></tr>
        </thead>
        <tbody>
          {(data ?? []).map((s) => (
            <tr key={s.id} className="border-t border-line">
              <td className="px-4 py-2"><Link to={`/3pl-operations/shipments/${s.id}`} className="text-ink underline">{s.shipment_number ?? s.id.slice(0, 8)}</Link></td>
              <td className="px-4 py-2"><span className="inline-block px-2 py-0.5 border border-line text-xs font-mono uppercase text-ink-dim">{s.status}</span></td>
              <td className="px-4 py-2 text-ink-dim">{s.warehouse_id.slice(0, 8)}</td>
              <td className="px-4 py-2 text-ink-dim">{s.ship_date ?? ''}</td>
              <td className="px-4 py-2 text-ink-dim">{s.carrier ?? ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
