import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import { EntityLabel } from '@/components/data/EntityLabel';
import { ListEmptyState } from '@/components/shell/ListEmptyState';
import { useSalesOrdersList, useSalesChannelsList } from '@/lib/hooks/useCoPack';
import { useVioCapabilities } from '@/lib/hooks/useVioCapabilities';
import { formatDateMedium } from '@/lib/dates';
import type { SalesOrderStatus } from '@/lib/types/copack';

/**
 * SalesOrdersListPage. Pillar 3 surface. Mirrors ManufacturingRunsListPage.
 *
 * The route is reachable today but the copack-api bundle gates on
 * plugins.copack_ecom and returns 404 for orgs without the flag. The Sidebar
 * entry that lands here is also flag-gated, so unauthorised orgs never see the
 * link. Supports ?status= deep-links from the home status cards.
 */
type StatusFilter = SalesOrderStatus | 'all';

const ALLOWED_ORDER_STATUSES = new Set<string>([
  'draft',
  'confirmed',
  'picking',
  'packed',
  'shipped',
  'cancelled',
]);

function parseOrderStatusParam(raw: string | null): StatusFilter {
  if (raw && ALLOWED_ORDER_STATUSES.has(raw)) {
    return raw as SalesOrderStatus;
  }
  return 'all';
}

export function SalesOrdersListPage() {
  const [searchParams] = useSearchParams();
  const [status, setStatus] = useState<StatusFilter>(() =>
    parseOrderStatusParam(searchParams.get('status')),
  );
  const [channelId, setChannelId] = useState<string>('');

  const filters = useMemo(() => {
    const f: { status?: StatusFilter; channel_id?: string } = {};
    if (status !== 'all') f.status = status;
    if (channelId) f.channel_id = channelId;
    return f;
  }, [status, channelId]);

  const orders = useSalesOrdersList(filters);
  const channels = useSalesChannelsList();
  const caps = useVioCapabilities();

  const channelName = useMemo(() => {
    const map: Record<string, string> = {};
    for (const c of channels.data ?? []) map[c.id] = c.name;
    return map;
  }, [channels.data]);

  return (
    <section className="px-8 py-12 max-w-6xl mx-auto flex flex-col gap-6">
      <header className="flex items-center justify-between">
        <h1 className="text-4xl font-display tracking-wide text-ink">SALES ORDERS</h1>
        {caps.can('copack.order.create') ? (
          <Link
            to="/copack/orders/new"
            className="px-4 py-2 bg-accent text-on-primary font-sans text-sm"
          >
            New sales order
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
            <option value="draft">Draft</option>
            <option value="confirmed">Confirmed</option>
            <option value="picking">Picking</option>
            <option value="packed">Packed</option>
            <option value="shipped">Shipped</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-sans text-xs text-ink-dim tracking-wide uppercase">Channel</span>
          <select
            value={channelId}
            onChange={(e) => setChannelId(e.target.value)}
            disabled={channels.isLoading}
            className="bg-bg-2 border border-line text-ink px-3 py-2 font-sans focus:outline-none focus:border-accent disabled:opacity-50"
          >
            <option value="">All channels</option>
            {(channels.data ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      {orders.isLoading ? <p className="text-ink-dim">Loading.</p> : null}
      {orders.error ? (
        <p className="text-accent font-sans text-sm">
          {orders.error instanceof Error ? orders.error.message : 'Failed to load sales orders.'}
        </p>
      ) : null}

      {!orders.isLoading && (orders.data ?? []).length === 0 && status === 'all' && !channelId ? (
        <ListEmptyState
          entity="sales order"
          explainer="Sales orders capture what a customer wants before it is kitted and shipped."
          addLabel="Add sales order"
          addTo="/copack/orders/new"
          canAdd={caps.can('copack.order.create')}
        />
      ) : (
        <table className="w-full border border-line text-sm font-sans">
          <thead className="bg-bg-2 text-left text-ink-dim">
            <tr>
              <th className="px-4 py-2">Order</th>
              <th className="px-4 py-2">Status</th>
              <th className="px-4 py-2">Channel</th>
              <th className="px-4 py-2">Customer</th>
              <th className="px-4 py-2">Ordered</th>
              <th className="px-4 py-2">Created</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {(orders.data ?? []).length === 0 && !orders.isLoading ? (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-ink-dim text-sm">
                  No sales orders match the current filters.
                </td>
              </tr>
            ) : (
              (orders.data ?? []).map((o) => (
                <tr key={o.id} className="border-t border-line">
                  <td className="px-4 py-2">
                    <Link to={`/copack/orders/${o.id}`} className="text-ink underline">
                      {o.order_number ?? o.id.slice(0, 8)}
                    </Link>
                  </td>
                  <td className="px-4 py-2">
                    <span className="inline-block px-2 py-0.5 border border-line text-xs font-mono uppercase text-ink-dim">
                      {o.status}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-ink-dim">
                    {o.channel_id ? (channelName[o.channel_id] ?? o.channel_id.slice(0, 8)) : '.'}
                  </td>
                  <td className="px-4 py-2 text-ink-dim">
                    {o.customer_id ? <EntityLabel kind="customer" id={o.customer_id} /> : '.'}
                  </td>
                  <td className="px-4 py-2 text-ink-dim">{formatDateMedium(o.ordered_at)}</td>
                  <td className="px-4 py-2 text-ink-dim">{formatDateMedium(o.created_at)}</td>
                  <td className="px-4 py-2">
                    <Link to={`/copack/orders/${o.id}`} className="text-ink underline text-xs">
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
