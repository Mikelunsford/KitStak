import { useParams } from 'react-router-dom';

import {
  usePurchaseOrder, usePurchaseOrderLines, useTransitionPurchaseOrder,
} from '@/lib/hooks/usePurchaseOrders';
import { useVioCapabilities } from '@/lib/hooks/useVioCapabilities';
import {
  PURCHASE_ORDER_FSM, canTransitionVio,
} from '@/lib/workflow/vendors_inventory_ops';
import type { PurchaseOrderStatus } from '@/lib/types/vendors_inventory_ops';

export function PODetailPage() {
  const { id } = useParams<{ id: string }>();
  const po = usePurchaseOrder(id);
  const lines = usePurchaseOrderLines(id);
  const transition = useTransitionPurchaseOrder(id ?? '');
  const caps = useVioCapabilities();

  if (po.isLoading) return <p className="px-8 py-12 text-ink-dim">Loading.</p>;
  if (po.error || !po.data) return <p className="px-8 py-12 text-accent">PO not found.</p>;

  const data = po.data;
  const allowedNext = PURCHASE_ORDER_FSM.transitions
    .filter((t) => t.from === data.status)
    .map((t) => t.to);

  return (
    <section className="px-8 py-12 max-w-5xl mx-auto flex flex-col gap-6">
      <header className="flex items-center justify-between">
        <h1 className="text-4xl font-display tracking-wide text-ink">
          PO {data.po_number ?? data.id.slice(0, 8)}
        </h1>
        <span className="px-2 py-0.5 border border-line text-xs font-mono uppercase text-ink-dim">
          {data.status}
        </span>
      </header>

      {caps.can('purchase_orders.purchase_order.transition') && allowedNext.length > 0 ? (
        <div className="flex gap-2">
          {allowedNext.map((to) => (
            <button
              key={to}
              type="button"
              disabled={transition.isPending || !canTransitionVio(PURCHASE_ORDER_FSM, data.status, to)}
              onClick={() => transition.mutate(to as PurchaseOrderStatus)}
              className="px-3 py-1 border border-line font-sans text-xs uppercase text-ink hover:bg-bg-2"
            >
              {to.replace('_', ' ')}
            </button>
          ))}
        </div>
      ) : null}

      <dl className="grid grid-cols-2 gap-4 font-sans text-sm">
        <dt className="text-ink-dim">Vendor</dt><dd className="text-ink">{data.vendor_id}</dd>
        <dt className="text-ink-dim">Order date</dt><dd className="text-ink">{data.order_date}</dd>
        <dt className="text-ink-dim">Expected</dt><dd className="text-ink">{data.expected_date ?? ''}</dd>
        <dt className="text-ink-dim">Subtotal</dt><dd className="text-ink">{String(data.subtotal_cents)}</dd>
        <dt className="text-ink-dim">Tax</dt><dd className="text-ink">{String(data.tax_cents)}</dd>
        <dt className="text-ink-dim">Total</dt><dd className="text-ink">{String(data.total_cents)}</dd>
      </dl>

      <h2 className="text-2xl font-display tracking-wide text-ink">LINE ITEMS</h2>
      <table className="w-full border border-line text-sm font-sans">
        <thead className="bg-bg-2 text-left text-ink-dim">
          <tr>
            <th className="px-4 py-2">Description</th>
            <th className="px-4 py-2">Qty</th>
            <th className="px-4 py-2">Received</th>
            <th className="px-4 py-2">Unit</th>
            <th className="px-4 py-2">Total</th>
          </tr>
        </thead>
        <tbody>
          {(lines.data ?? []).map((l) => (
            <tr key={l.id} className="border-t border-line">
              <td className="px-4 py-2 text-ink">{l.description}</td>
              <td className="px-4 py-2 text-ink-dim">{String(l.quantity_ordered)}</td>
              <td className="px-4 py-2 text-ink-dim">{String(l.quantity_received)}</td>
              <td className="px-4 py-2 text-ink-dim">{String(l.unit_price_cents)}</td>
              <td className="px-4 py-2 text-ink-dim">{String(l.line_total_cents)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
