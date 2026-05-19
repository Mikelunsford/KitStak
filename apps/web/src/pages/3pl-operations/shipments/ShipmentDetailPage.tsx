import { useParams } from 'react-router-dom';
import { AuditTimeline } from '@/components/shell/AuditTimeline';
import { EntityLabel } from '@/components/data/EntityLabel';
import { useShipment, useTransitionShipment, useShipShipment } from '@/lib/hooks/useOps';
import { useVioCapabilities } from '@/lib/hooks/useVioCapabilities';
import { SHIPMENT_FSM } from '@/lib/workflow/vendors_inventory_ops';
import type { ShipmentStatus } from '@/lib/types/vendors_inventory_ops';

export function ShipmentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const s = useShipment(id);
  const transition = useTransitionShipment(id ?? '');
  const ship = useShipShipment(id ?? '');
  const caps = useVioCapabilities();
  if (s.isLoading) return <p className="px-8 py-12 text-ink-dim">Loading.</p>;
  if (s.error || !s.data) return <p className="px-8 py-12 text-accent">Shipment not found.</p>;
  const d = s.data;
  const next = SHIPMENT_FSM.transitions.filter((t) => t.from === d.status).map((t) => t.to);
  return (
    <section className="px-8 py-12 max-w-4xl mx-auto flex flex-col gap-6">
      <header className="flex items-center justify-between">
        <h1 className="text-4xl font-display tracking-wide text-ink">SHIPMENT {d.shipment_number ?? d.id.slice(0, 8)}</h1>
        <span className="px-2 py-0.5 border border-line text-xs font-mono uppercase text-ink-dim">{d.status}</span>
      </header>
      <div className="flex gap-2">
        {caps.can('shipments.shipment.update') && next.length > 0
          ? next.map((to) => (
            <button key={to} onClick={() => transition.mutate(to as ShipmentStatus)} disabled={transition.isPending}
              className="px-3 py-1 border border-line font-sans text-xs uppercase text-ink hover:bg-bg-2">{to.replace('_', ' ')}</button>
          ))
          : null}
        {d.status === 'picking' && caps.can('shipments.ship') ? (
          <button onClick={() => ship.mutate({ lines: [] })} disabled={ship.isPending}
            className="px-3 py-1 border border-accent text-accent font-sans text-xs uppercase hover:bg-bg-2">Ship</button>
        ) : null}
      </div>
      {(transition.error || ship.error) && (
        <p className="font-sans text-sm text-accent">
          {(transition.error instanceof Error && transition.error.message) ||
            (ship.error instanceof Error && ship.error.message) ||
            'Action failed.'}
        </p>
      )}
      <dl className="grid grid-cols-2 gap-4 font-sans text-sm">
        <dt className="text-ink-dim">Warehouse</dt><dd className="text-ink"><EntityLabel kind="warehouse" id={d.warehouse_id} /></dd>
        <dt className="text-ink-dim">Ship date</dt><dd className="text-ink">{d.ship_date ?? ''}</dd>
        <dt className="text-ink-dim">Carrier</dt><dd className="text-ink">{d.carrier ?? ''}</dd>
        <dt className="text-ink-dim">Tracking</dt><dd className="text-ink">{d.tracking_number ?? ''}</dd>
      </dl>

      <section className="mt-6">
        <h2 className="text-2xl font-display tracking-wide text-ink mb-3">HISTORY</h2>
        <AuditTimeline entityType="shipment" entityId={id ?? null} />
      </section>
    </section>
  );
}
