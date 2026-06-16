import { useParams } from 'react-router-dom';

import { AuditTimeline } from '@/components/shell/AuditTimeline';
import { Breadcrumbs } from '@/components/shell/Breadcrumbs';
import { EntityLabel } from '@/components/data/EntityLabel';
import { Button } from '@/components/ui/Button';
import { PageHeader } from '@/components/ui/PageHeader';
import { DetailLayout } from '@/components/ui/DetailLayout';
import { StatusBadge } from '@/components/ui/StatusBadge';
import {
  useFulfillment,
  usePickFulfillment,
  usePackFulfillment,
  useShipFulfillment,
  useCancelFulfillment,
} from '@/lib/hooks/useCoPack';
import { useVioCapabilities } from '@/lib/hooks/useVioCapabilities';
import { destructiveConfirm } from '@/lib/destructiveConfirm';
import { formatDateTimeMedium } from '@/lib/dates';

/**
 * FulfillmentDetailPage. Pillar 3. Migrated to the shared UI kit
 * (F-Wave10-UI-KIT-01): PageHeader (status as a StatusBadge in the meta slot,
 * replacing the inline defaultStateLabel pill) plus DetailLayout with the audit
 * history in the rail. The copack FSMs are not registered in
 * STATE_STEPPER_PATHS, so there is no StateStepper.
 *
 * State machine: pending -> picking -> packed -> shipped;
 * pending|picking|packed -> cancelled. Each forward transition gates on its own
 * capability (pick/pack/ship). There is no copack.fulfillment.cancel capability,
 * so cancel reuses copack.fulfillment.pick.
 */
export function FulfillmentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const fulfillmentId = id ?? '';

  const fulfillment = useFulfillment(id);
  const pick = usePickFulfillment(fulfillmentId);
  const pack = usePackFulfillment(fulfillmentId);
  const ship = useShipFulfillment(fulfillmentId);
  const cancel = useCancelFulfillment(fulfillmentId);

  const caps = useVioCapabilities();

  if (fulfillment.isLoading) return <p className="px-8 py-12 text-ink-dim">Loading.</p>;
  if (fulfillment.error || !fulfillment.data) {
    return <p className="px-8 py-12 text-accent">Fulfillment not found.</p>;
  }
  const d = fulfillment.data;

  const isPending = d.status === 'pending';
  const isPicking = d.status === 'picking';
  const isPacked = d.status === 'packed';
  const canCancel = isPending || isPicking || isPacked;

  async function onShip() {
    if (!(await destructiveConfirm({
      action: 'Ship this fulfillment',
      consequence: 'The fulfillment moves to shipped and can no longer be edited.',
      irreversible: true,
    }))) return;
    ship.mutate();
  }

  async function onCancel() {
    if (!(await destructiveConfirm({
      action: 'Cancel this fulfillment',
      consequence: 'The fulfillment will move to cancelled and stop appearing in active lists.',
    }))) return;
    cancel.mutate();
  }

  return (
    <section className="px-8 py-12 max-w-5xl mx-auto flex flex-col gap-6">
      <Breadcrumbs
        items={[
          { label: 'Co-Pack', to: '/copack/orders' },
          { label: 'Fulfillments', to: '/copack/fulfillments' },
          { label: d.fulfillment_number ?? d.id.slice(0, 8) },
        ]}
      />
      <PageHeader
        eyebrow="Co-Pack and Ecom / Fulfillments"
        title={`Fulfillment ${d.fulfillment_number ?? d.id.slice(0, 8)}`}
        meta={<StatusBadge status={d.status} />}
      />

      <DetailLayout
        rail={
          <section>
            <h2 className="text-2xl font-display tracking-wide text-ink mb-3">HISTORY</h2>
            <AuditTimeline entityType="fulfillment" entityId={id ?? null} />
          </section>
        }
      >
        <div className="flex gap-2 flex-wrap">
          {isPending && caps.can('copack.fulfillment.pick') && (
            <Button variant="secondary" onClick={() => pick.mutate()} disabled={pick.isPending}>
              Pick
            </Button>
          )}
          {isPicking && caps.can('copack.fulfillment.pack') && (
            <Button variant="secondary" onClick={() => pack.mutate()} disabled={pack.isPending}>
              Pack
            </Button>
          )}
          {isPacked && caps.can('copack.fulfillment.ship') && (
            <Button variant="secondary" onClick={onShip} disabled={ship.isPending}>
              Ship
            </Button>
          )}
          {canCancel && caps.can('copack.fulfillment.pick') && (
            <Button variant="ghost" onClick={onCancel} disabled={cancel.isPending}>
              Cancel fulfillment
            </Button>
          )}
        </div>
        {pick.error ? (
          <p className="font-sans text-sm text-accent">
            {pick.error instanceof Error ? pick.error.message : 'Pick failed.'}
          </p>
        ) : null}
        {pack.error ? (
          <p className="font-sans text-sm text-accent">
            {pack.error instanceof Error ? pack.error.message : 'Pack failed.'}
          </p>
        ) : null}
        {ship.error ? (
          <p className="font-sans text-sm text-accent">
            {ship.error instanceof Error ? ship.error.message : 'Ship failed.'}
          </p>
        ) : null}
        {cancel.error ? (
          <p className="font-sans text-sm text-accent">
            {cancel.error instanceof Error ? cancel.error.message : 'Cancel failed.'}
          </p>
        ) : null}

        <dl className="grid grid-cols-2 gap-4 font-sans text-sm">
          <dt className="text-ink-dim">Sales order</dt>
          <dd className="text-ink">
            <EntityLabel kind="sales_order" id={d.sales_order_id} />
          </dd>
          <dt className="text-ink-dim">Warehouse</dt>
          <dd className="text-ink">
            {d.warehouse_id ? <EntityLabel kind="copack_warehouse" id={d.warehouse_id} /> : 'None'}
          </dd>
          <dt className="text-ink-dim">Shipment</dt>
          <dd className="text-ink">{d.shipment_id ? d.shipment_id.slice(0, 8) : 'None'}</dd>
          <dt className="text-ink-dim">Picked</dt>
          <dd className="text-ink">{formatDateTimeMedium(d.picked_at)}</dd>
          <dt className="text-ink-dim">Packed</dt>
          <dd className="text-ink">{formatDateTimeMedium(d.packed_at)}</dd>
          <dt className="text-ink-dim">Shipped</dt>
          <dd className="text-ink">{formatDateTimeMedium(d.shipped_at)}</dd>
          <dt className="text-ink-dim">Cancelled</dt>
          <dd className="text-ink">{formatDateTimeMedium(d.cancelled_at)}</dd>
          <dt className="text-ink-dim">Notes</dt>
          <dd className="text-ink whitespace-pre-wrap">{d.notes ?? ''}</dd>
        </dl>
      </DetailLayout>
    </section>
  );
}
