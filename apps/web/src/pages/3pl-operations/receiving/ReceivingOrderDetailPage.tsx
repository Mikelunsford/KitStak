import { useParams } from 'react-router-dom';
import { AuditTimeline } from '@/components/shell/AuditTimeline';
import { useReceivingOrder, useTransitionReceivingOrder } from '@/lib/hooks/useOps';
import { useVioCapabilities } from '@/lib/hooks/useVioCapabilities';
import { RECEIVING_ORDER_FSM } from '@/lib/workflow/vendors_inventory_ops';
import type { ReceivingOrderStatus } from '@/lib/types/vendors_inventory_ops';

export function ReceivingOrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const r = useReceivingOrder(id);
  const transition = useTransitionReceivingOrder(id ?? '');
  const caps = useVioCapabilities();
  if (r.isLoading) return <p className="px-8 py-12 text-ink-dim">Loading.</p>;
  if (r.error || !r.data) return <p className="px-8 py-12 text-accent">Receiving order not found.</p>;
  const d = r.data;
  const next = RECEIVING_ORDER_FSM.transitions.filter((t) => t.from === d.status).map((t) => t.to);
  return (
    <section className="px-8 py-12 max-w-4xl mx-auto flex flex-col gap-6">
      <header className="flex items-center justify-between">
        <h1 className="text-4xl font-display tracking-wide text-ink">RECEIVING {d.receiving_number ?? d.id.slice(0, 8)}</h1>
        <span className="px-2 py-0.5 border border-line text-xs font-mono uppercase text-ink-dim">{d.status}</span>
      </header>
      {caps.can('receiving.order.update') && next.length > 0 ? (
        <div className="flex gap-2">
          {next.map((to) => (
            <button key={to} onClick={() => transition.mutate(to as ReceivingOrderStatus)} disabled={transition.isPending}
              className="px-3 py-1 border border-line font-sans text-xs uppercase text-ink hover:bg-bg-2">{to}</button>
          ))}
        </div>
      ) : null}
      <dl className="grid grid-cols-2 gap-4 font-sans text-sm">
        <dt className="text-ink-dim">Warehouse</dt><dd className="text-ink">{d.warehouse_id}</dd>
        <dt className="text-ink-dim">Expected</dt><dd className="text-ink">{d.expected_date ?? ''}</dd>
        <dt className="text-ink-dim">Received</dt><dd className="text-ink">{d.received_date ?? ''}</dd>
        <dt className="text-ink-dim">Reference</dt><dd className="text-ink">{d.reference ?? ''}</dd>
      </dl>

      <section className="mt-6">
        <h2 className="text-2xl font-display tracking-wide text-ink mb-3">HISTORY</h2>
        <AuditTimeline entityType="receiving_order" entityId={id ?? null} />
      </section>
    </section>
  );
}
