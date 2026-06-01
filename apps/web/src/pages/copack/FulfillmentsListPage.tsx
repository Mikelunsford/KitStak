import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import { EntityLabel } from '@/components/data/EntityLabel';
import { ListEmptyState } from '@/components/shell/ListEmptyState';
import { useFulfillmentsList, useSalesOrdersList } from '@/lib/hooks/useCoPack';
import { useVioCapabilities } from '@/lib/hooks/useVioCapabilities';
import { formatDateMedium } from '@/lib/dates';
import type { FulfillmentStatus } from '@/lib/types/copack';

/**
 * FulfillmentsListPage. Pillar 3 surface. Mirrors SalesOrdersListPage.
 *
 * The route is reachable today but the copack-api bundle gates on
 * plugins.copack_ecom and returns 404 for orgs without the flag. The Sidebar
 * entry that lands here is also flag-gated, so unauthorised orgs never see the
 * link. Supports ?status= deep-links from the home status cards.
 */
type StatusFilter = FulfillmentStatus | 'all';

const ALLOWED_FULFILLMENT_STATUSES = new Set<string>([
  'pending',
  'picking',
  'packed',
  'shipped',
  'cancelled',
]);

function parseFulfillmentStatusParam(raw: string | null): StatusFilter {
  if (raw && ALLOWED_FULFILLMENT_STATUSES.has(raw)) {
    return raw as FulfillmentStatus;
  }
  return 'all';
}

export function FulfillmentsListPage() {
  const [searchParams] = useSearchParams();
  const [status, setStatus] = useState<StatusFilter>(() =>
    parseFulfillmentStatusParam(searchParams.get('status')),
  );

  const filters = useMemo(() => {
    const f: { status?: StatusFilter } = {};
    if (status !== 'all') f.status = status;
    return f;
  }, [status]);

  const fulfillments = useFulfillmentsList(filters);
  const orders = useSalesOrdersList();
  const caps = useVioCapabilities();

  const orderNumber = useMemo(() => {
    const map: Record<string, string> = {};
    for (const o of orders.data ?? []) map[o.id] = o.order_number ?? o.id.slice(0, 8);
    return map;
  }, [orders.data]);

  return (
    <section className="px-8 py-12 max-w-6xl mx-auto flex flex-col gap-6">
      <header className="flex items-center justify-between">
        <h1 className="text-4xl font-display tracking-wide text-ink">FULFILLMENTS</h1>
        {caps.can('copack.fulfillment.pick') ? (
          <Link
            to="/copack/fulfillments/new"
            className="px-4 py-2 bg-accent text-on-primary font-sans text-sm"
          >
            New fulfillment
          </Link>
        ) : null}
      </header>

      <div className="flex flex-wrap gap-4 items-end">
        <label className="flex flex-col gap-1">
          <span className="font-sans text-xs text-ink-dim tracking-wide uppercase">Status</span>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as StatusFilter)}
            className="bg-bg-2 border border-line text-ink px-3 py-2 font-sans focus:outline-none focus:border-accent"
          >
            <option value="all">All</option>
            <option value="pending">Pending</option>
            <option value="picking">Picking</option>
            <option value="packed">Packed</option>
            <option value="shipped">Shipped</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </label>
      </div>

      {fulfillments.isLoading ? <p className="text-ink-dim">Loading.</p> : null}
      {fulfillments.error ? (
        <p className="text-accent font-sans text-sm">
          {fulfillments.error instanceof Error
            ? fulfillments.error.message
            : 'Failed to load fulfillments.'}
        </p>
      ) : null}

      {!fulfillments.isLoading && (fulfillments.data ?? []).length === 0 && status === 'all' ? (
        <ListEmptyState
          entity="fulfillment"
          explainer="Fulfillments pick, pack, and ship the orders that are ready to go out the door."
          addLabel="Add fulfillment"
          addTo="/copack/fulfillments/new"
          canAdd={caps.can('copack.fulfillment.pick')}
        />
      ) : (
        <table className="w-full border border-line text-sm font-sans">
          <thead className="bg-bg-2 text-left text-ink-dim">
            <tr>
              <th className="px-4 py-2">Fulfillment</th>
              <th className="px-4 py-2">Status</th>
              <th className="px-4 py-2">Sales order</th>
              <th className="px-4 py-2">Warehouse</th>
              <th className="px-4 py-2">Created</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {(fulfillments.data ?? []).length === 0 && !fulfillments.isLoading ? (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-ink-dim text-sm">
                  No fulfillments match the current filters.
                </td>
              </tr>
            ) : (
              (fulfillments.data ?? []).map((f) => (
                <tr key={f.id} className="border-t border-line">
                  <td className="px-4 py-2">
                    <Link to={`/copack/fulfillments/${f.id}`} className="text-ink underline">
                      {f.fulfillment_number ?? f.id.slice(0, 8)}
                    </Link>
                  </td>
                  <td className="px-4 py-2">
                    <span className="inline-block px-2 py-0.5 border border-line text-xs font-mono uppercase text-ink-dim">
                      {f.status}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-ink-dim">
                    {orderNumber[f.sales_order_id] ?? f.sales_order_id.slice(0, 8)}
                  </td>
                  <td className="px-4 py-2 text-ink-dim">
                    {f.warehouse_id ? <EntityLabel kind="copack_warehouse" id={f.warehouse_id} /> : '·'}
                  </td>
                  <td className="px-4 py-2 text-ink-dim">{formatDateMedium(f.created_at)}</td>
                  <td className="px-4 py-2">
                    <Link
                      to={`/copack/fulfillments/${f.id}`}
                      className="text-ink underline text-xs"
                    >
                      View
                    </Link>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      )}
    </section>
  );
}
