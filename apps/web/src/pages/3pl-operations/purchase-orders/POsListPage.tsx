import { Link } from 'react-router-dom';
import { EntityLabel } from '@/components/data/EntityLabel';
import { ListEmptyState } from '@/components/shell/ListEmptyState';
import { usePurchaseOrdersList } from '@/lib/hooks/usePurchaseOrders';
import { useVioCapabilities } from '@/lib/hooks/useVioCapabilities';

function StatusBadge({ status }: { status: string }) {
  return (
    <span className="inline-block px-2 py-0.5 border border-line text-xs font-mono uppercase text-ink-dim">
      {status}
    </span>
  );
}

export function POsListPage() {
  const { data, isLoading, error } = usePurchaseOrdersList();
  const caps = useVioCapabilities();

  return (
    <section className="px-8 py-12 max-w-6xl mx-auto flex flex-col gap-6">
      <header className="flex items-center justify-between">
        <h1 className="text-4xl font-display tracking-wide text-ink">PURCHASE ORDERS</h1>
        {caps.can('purchase_orders.purchase_order.create') ? (
          <Link
            to="/3pl-operations/purchase-orders/new"
            className="px-4 py-2 bg-accent text-on-primary font-sans text-sm"
          >
            New PO
          </Link>
        ) : null}
      </header>

      {isLoading ? <p className="text-ink-dim">Loading.</p> : null}
      {error ? <p className="text-accent">Failed to load.</p> : null}

      {!isLoading && !error && (data ?? []).length === 0 ? (
        <ListEmptyState
          entity="purchase order"
          explainer="Purchase orders commit to buying from a vendor."
          addLabel="Add purchase order"
          addTo="/3pl-operations/purchase-orders/new"
          canAdd={caps.can('purchase_orders.purchase_order.create')}
        />
      ) : (
      <table className="w-full border border-line text-sm font-sans">
        <thead className="bg-bg-2 text-left text-ink-dim">
          <tr>
            <th className="px-4 py-2">PO #</th>
            <th className="px-4 py-2">Vendor</th>
            <th className="px-4 py-2">Status</th>
            <th className="px-4 py-2">Total</th>
            <th className="px-4 py-2">Order date</th>
          </tr>
        </thead>
        <tbody>
          {(data ?? []).map((po) => (
            <tr key={po.id} className="border-t border-line">
              <td className="px-4 py-2">
                <Link to={`/3pl-operations/purchase-orders/${po.id}`} className="text-ink underline">
                  {po.po_number ?? po.id.slice(0, 8)}
                </Link>
              </td>
              <td className="px-4 py-2 text-ink-dim"><EntityLabel kind="vendor" id={po.vendor_id} /></td>
              <td className="px-4 py-2"><StatusBadge status={po.status} /></td>
              <td className="px-4 py-2 text-ink-dim">{String(po.total_cents)}</td>
              <td className="px-4 py-2 text-ink-dim">{po.order_date}</td>
            </tr>
          ))}
        </tbody>
      </table>
      )}
    </section>
  );
}
