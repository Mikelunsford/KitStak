import { useMemo } from 'react';
import { Link } from 'react-router-dom';

import { useSalesOrdersList } from '@/lib/hooks/useCoPack';
import { useVioCapabilities } from '@/lib/hooks/useVioCapabilities';
import type { SalesOrderStatus } from '@/lib/types/copack';

/**
 * CoPackHomePage. Pillar 3 landing for the Co-Pack and Ecom surface.
 *
 * Orients the operator with a live status breakdown of sales orders and the
 * primary entry points (new order, kitting jobs, fulfillments, channels).
 * Gated by plugins.copack_ecom at the route layer (requiresPlugin), so orgs
 * without the pillar flag never render it. Action tiles mirror the role policy
 * for button hiding only. The server stays the authority.
 */
const STATUS_CARDS: ReadonlyArray<{
  status: SalesOrderStatus;
  label: string;
}> = [
  { status: 'draft', label: 'Draft' },
  { status: 'confirmed', label: 'Confirmed' },
  { status: 'picking', label: 'Picking' },
  { status: 'shipped', label: 'Shipped' },
];

export function CoPackHomePage() {
  const orders = useSalesOrdersList();
  const caps = useVioCapabilities();

  const counts = useMemo(() => {
    const tally: Record<string, number> = {};
    for (const order of orders.data ?? []) {
      tally[order.status] = (tally[order.status] ?? 0) + 1;
    }
    return tally;
  }, [orders.data]);

  const canCreateOrder = caps.can('copack.order.create');
  const canCreateKitting = caps.can('copack.kitting_job.create');
  const canPickFulfillment = caps.can('copack.fulfillment.pick');

  return (
    <section className="px-8 py-12 max-w-6xl mx-auto flex flex-col gap-12">
      <header className="flex flex-col gap-2">
        <h1 className="text-6xl font-display tracking-wide text-ink">CO-PACK AND ECOM</h1>
        <p className="font-sans text-lg text-ink-dim max-w-2xl">
          Take orders, kit them, and ship them. Track every order from draft to shipped.
        </p>
      </header>

      <div className="flex flex-col gap-4">
        <h2 className="font-display text-2xl tracking-wide text-ink-dim">ORDERS</h2>
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
          {STATUS_CARDS.map((card) => (
            <Link
              key={card.status}
              to={`/copack/orders?status=${card.status}`}
              className="bg-bg-2 border border-line p-6 flex flex-col gap-2 hover:border-accent"
            >
              <span className="text-4xl font-display tracking-wide text-ink">
                {orders.isLoading ? '.' : (counts[card.status] ?? 0)}
              </span>
              <span className="font-sans text-sm text-ink-dim tracking-wide uppercase">
                {card.label}
              </span>
            </Link>
          ))}
        </div>
        {orders.error ? (
          <p className="font-sans text-sm text-accent">
            {orders.error instanceof Error ? orders.error.message : 'Failed to load sales orders.'}
          </p>
        ) : null}
      </div>

      <div className="flex flex-col gap-4">
        <h2 className="font-display text-2xl tracking-wide text-ink-dim">WORK</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <ActionTile
            to="/copack/orders"
            title="ALL ORDERS"
            body="Browse, filter, and open every sales order."
          />
          {canCreateOrder ? (
            <ActionTile
              to="/copack/orders/new"
              title="NEW ORDER"
              body="Open a blank draft order and add lines by hand."
            />
          ) : null}
          <ActionTile
            to="/copack/kitting"
            title="KITTING JOBS"
            body="Assemble finished kits from their components."
          />
          {canCreateKitting ? (
            <ActionTile
              to="/copack/kitting/new"
              title="NEW KITTING JOB"
              body="Open a blank draft kitting job and add lines by hand."
            />
          ) : null}
          <ActionTile
            to="/copack/fulfillments"
            title="FULFILLMENTS"
            body="Pick, pack, and ship the orders that are ready."
          />
          {canPickFulfillment ? (
            <ActionTile
              to="/copack/fulfillments/new"
              title="NEW FULFILLMENT"
              body="Open a fulfillment against a confirmed order."
            />
          ) : null}
          <ActionTile
            to="/copack/channels"
            title="SALES CHANNELS"
            body="Define where your orders come from."
          />
        </div>
      </div>
    </section>
  );
}

type ActionTileProps = { to: string; title: string; body: string };

function ActionTile({ to, title, body }: ActionTileProps) {
  return (
    <Link
      to={to}
      className="bg-bg-2 border border-line p-6 flex flex-col gap-3 hover:border-accent"
    >
      <h3 className="text-xl font-display tracking-wider text-ink">{title}</h3>
      <p className="font-sans text-ink-dim text-sm">{body}</p>
    </Link>
  );
}
