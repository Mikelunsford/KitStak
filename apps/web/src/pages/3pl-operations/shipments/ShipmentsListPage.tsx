import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { EntityLabel } from '@/components/data/EntityLabel';
import { useShipmentsList } from '@/lib/hooks/useOps';

const ALLOWED_SHIPMENT_STATUSES = new Set<string>([
  'created',
  'picking',
  'shipped',
  'cancelled',
]);

function parseShipmentStatusParam(raw: string | null): string | undefined {
  if (raw && ALLOWED_SHIPMENT_STATUSES.has(raw)) return raw;
  return undefined;
}

export function ShipmentsListPage() {
  // UX-Q5: support ?status= deep-links from the dashboard work card
  // ("Shipments ready to ship" -> ?status=picking). The shipments service
  // does not yet accept a status filter on the wire, so the predicate is
  // applied client-side over the page payload. This is acceptable because
  // the v1 operator's working set is small and the page is already paged
  // through TanStack Query.
  const [searchParams] = useSearchParams();
  const statusFilter = parseShipmentStatusParam(searchParams.get('status'));

  const { data, isLoading } = useShipmentsList();

  const filtered = useMemo(() => {
    if (!data) return data;
    if (!statusFilter) return data;
    return data.filter((s) => s.status === statusFilter);
  }, [data, statusFilter]);

  return (
    <section className="px-8 py-12 max-w-6xl mx-auto flex flex-col gap-6">
      <header className="flex items-center justify-between">
        <h1 className="text-4xl font-display tracking-wide text-ink">SHIPMENTS</h1>
        <Link to="/3pl-operations/shipments/new" className="px-4 py-2 bg-accent text-on-primary font-sans text-sm">New shipment</Link>
      </header>
      {statusFilter ? (
        <p className="text-xs font-sans uppercase tracking-wider text-ink-dim">
          Filtering by status: {statusFilter}
        </p>
      ) : null}
      {isLoading ? <p className="text-ink-dim">Loading.</p> : null}
      <table className="w-full border border-line text-sm font-sans">
        <thead className="bg-bg-2 text-left text-ink-dim">
          <tr><th className="px-4 py-2">#</th><th className="px-4 py-2">Status</th><th className="px-4 py-2">Warehouse</th><th className="px-4 py-2">Ship date</th><th className="px-4 py-2">Carrier</th></tr>
        </thead>
        <tbody>
          {(filtered ?? []).map((s) => (
            <tr key={s.id} className="border-t border-line">
              <td className="px-4 py-2"><Link to={`/3pl-operations/shipments/${s.id}`} className="text-ink underline">{s.shipment_number ?? s.id.slice(0, 8)}</Link></td>
              <td className="px-4 py-2"><span className="inline-block px-2 py-0.5 border border-line text-xs font-mono uppercase text-ink-dim">{s.status}</span></td>
              <td className="px-4 py-2 text-ink-dim"><EntityLabel kind="warehouse" id={s.warehouse_id} /></td>
              <td className="px-4 py-2 text-ink-dim">{s.ship_date ?? ''}</td>
              <td className="px-4 py-2 text-ink-dim">{s.carrier ?? ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
