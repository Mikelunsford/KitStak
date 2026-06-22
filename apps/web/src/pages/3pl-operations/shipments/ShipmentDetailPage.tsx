import { useState, type FormEvent } from 'react';
import { useParams } from 'react-router-dom';
import { Package } from 'lucide-react';

import { AuditTimeline } from '@/components/shell/AuditTimeline';
import { Breadcrumbs } from '@/components/shell/Breadcrumbs';
import { DetailSectionEmptyCoaching } from '@/components/shell/DetailSectionEmptyCoaching';
import { NextStepCTA } from '@/components/shell/NextStepCTA';
import { StateStepper } from '@/components/shell/StateStepper';
import { EntityLabel } from '@/components/data/EntityLabel';
import {
  STATE_STEPPER_PATHS,
  isOffPath,
  nextStepperState,
} from '@/lib/workflow/stateStepperPaths';
import { Button } from '@/components/ui/Button';
import { PageHeader } from '@/components/ui/PageHeader';
import { DetailLayout } from '@/components/ui/DetailLayout';
import { TextInput } from '@/components/ui/TextInput';
import { ItemPicker } from '@/components/ui/pickers';
import { SupplySourceSelect } from '@/components/forms/SupplySourceSelect';
import {
  useShipment, useTransitionShipment, useShipShipment,
  useShipmentLineItems, useCreateShipmentLineItem, useDeleteShipmentLineItem,
} from '@/lib/hooks/useOps';
import { useVioCapabilities } from '@/lib/hooks/useVioCapabilities';
import { SHIPMENT_FSM } from '@/lib/workflow/vendors_inventory_ops';
import { shouldShowShipmentNextStepCTA } from '@/lib/workflow/nextStepCTA';
import type { ShipmentStatus } from '@/lib/types/vendors_inventory_ops';
import type { ItemSupplySource } from '@/lib/types/sales';
import { formatCents } from '@/lib/money';
import { destructiveConfirm } from '@/lib/destructiveConfirm';
import { buildCreateInvoiceUrl, getShipmentProjectId } from './shipmentInvoiceLink';

export function ShipmentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const shipmentId = id ?? '';
  const s = useShipment(id);
  const transition = useTransitionShipment(shipmentId);
  const ship = useShipShipment(shipmentId);
  const lineItems = useShipmentLineItems(id);
  const addLine = useCreateShipmentLineItem(shipmentId);
  const removeLine = useDeleteShipmentLineItem(shipmentId);
  const caps = useVioCapabilities();

  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [qty, setQty] = useState('1');
  const [unitCost, setUnitCost] = useState('');
  const [uom, setUom] = useState('');
  const [reference, setReference] = useState('');
  const [supplySource, setSupplySource] = useState<ItemSupplySource | null>(null);

  if (s.isLoading) return <p className="px-8 py-12 text-ink-dim">Loading.</p>;
  if (s.error || !s.data) return <p className="px-8 py-12 text-accent">Shipment not found.</p>;
  const d = s.data;
  const next = SHIPMENT_FSM.transitions.filter((t) => t.from === d.status).map((t) => t.to);

  // Lines are editable until the shipment ships. After shipped, the
  // emit_movements trigger has already fired against shipment_line_items
  // and the record is immutable.
  const linesEditable = d.status === 'created' || d.status === 'picking';

  // UX-Q7 reopened (Pattern D): the shipment happy path is created -> picking ->
  // shipped. `created -> picking` is a normal FSM transition (transition.mutate,
  // gated by shipments.shipment.update). The rail advance routes the `shipped`
  // step through the dedicated Ship action (ship.mutate, gated by shipments.ship)
  // because that is the proper ship flow that runs the ship RPC and emits stock
  // movements. `shipped` is also a raw FSM target in `next`, so we exclude it
  // from the transition branch and gate it solely on shipments.ship; that keeps
  // the rail button from appearing for an operator who could not run the Ship
  // action it dispatches.
  const railNext = nextStepperState(STATE_STEPPER_PATHS.shipment.path, d.status);
  const canAdvanceRail =
    railNext !== null &&
    ((railNext !== 'shipped' &&
      (next as readonly string[]).includes(railNext) &&
      caps.can('shipments.shipment.update')) ||
      (railNext === 'shipped' &&
        d.status === 'picking' &&
        caps.can('shipments.ship')));
  const advance = (toState: string) => {
    if (toState === 'shipped') {
      ship.mutate({ lines: [] });
    } else {
      transition.mutate(toState as ShipmentStatus);
    }
  };

  const onAddLine = (e: FormEvent) => {
    e.preventDefault();
    if (!selectedItemId) return;
    addLine.mutate(
      {
        item_id: selectedItemId,
        quantity: qty,
        unit_cost_cents: unitCost === '' ? null : Number(unitCost),
        uom: uom === '' ? null : uom,
        reference: reference === '' ? null : reference,
        supply_source: supplySource,
      },
      {
        onSuccess: () => {
          setSelectedItemId(null);
          setQty('1');
          setUnitCost('');
          setUom('');
          setReference('');
          setSupplySource(null);
        },
      },
    );
  };

  return (
    <section className="px-8 py-12 max-w-5xl mx-auto flex flex-col gap-6">
      <Breadcrumbs
        items={[
          { label: 'Shipments', to: '/3pl-operations/shipments' },
          { label: d.shipment_number ?? d.id.slice(0, 8) },
        ]}
      />
      {/* UX-Q7 reopened (Pattern D): the rail's immediate next step is an
          interactive control. `created -> picking` reuses the start-pick
          transition; `picking -> shipped` reuses the separate Ship action
          (ship.mutate). It is only interactive when the operator holds the
          authorizing capability for that move. Past, current, and
          further-future steps stay display-only. */}
      <StateStepper
        steps={[...STATE_STEPPER_PATHS.shipment.path]}
        current={d.status}
        offPath={
          isOffPath('shipment', d.status)
            ? {
                state: d.status,
                label: STATE_STEPPER_PATHS.shipment.resolveLabel(d.status),
              }
            : undefined
        }
        onAdvance={canAdvanceRail ? advance : undefined}
        advancePending={transition.isPending || ship.isPending}
      />
      <PageHeader
        title={`Shipment ${d.shipment_number ?? d.id.slice(0, 8)}`}
      />

      <DetailLayout
        rail={
          <section>
            <h2 className="text-2xl font-display tracking-wide text-ink mb-3">
              HISTORY
            </h2>
            <AuditTimeline entityType="shipment" entityId={id ?? null} />
          </section>
        }
      >
        {/* UX-Q4: forward-transition CTA promoted to primary top placement
            when status === 'shipped'. Predicate lives in
            `@/lib/workflow/nextStepCTA`. Deep-links to the create-invoice
            form with customer_id (and project_id if duck-typed off the
            shipment) pre-filled. InvoiceCreatePage already honors both
            query params. customer_id null-check stays inline because the
            deep link is meaningless without it. */}
        {shouldShowShipmentNextStepCTA(d.status) && d.customer_id && (
          <NextStepCTA
            label="Create invoice"
            to={buildCreateInvoiceUrl(d.customer_id, getShipmentProjectId(d), d.id)}
          />
        )}

        {/* Secondary cluster. FSM transitions (start_pick / cancel) stay
            visible at neutral weight so an operator who needs to cancel
            doesn't have to dig — they are demoted, not hidden. */}
        <div className="flex gap-2">
          {caps.can('shipments.shipment.update') && next.length > 0
            ? next.map((to) => (
              <button
                key={to}
                onClick={async () => {
                  // UX-Q8: cancelling reverses an outbound commitment.
                  if (to === 'cancelled' && !(await destructiveConfirm({
                    action: 'Cancel this shipment',
                    consequence: 'The shipment will move to cancelled and the outbound commitment to the customer will be reversed.',
                  }))) return;
                  transition.mutate(to as ShipmentStatus);
                }}
                disabled={transition.isPending}
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

        <section>
          <h2 className="text-2xl font-display tracking-wider text-ink mb-3">LINES</h2>
          {lineItems.isLoading ? (
            <p className="text-ink-dim text-sm">Loading lines.</p>
          ) : lineItems.error ? (
            <p className="text-accent text-sm">
              {lineItems.error instanceof Error ? lineItems.error.message : 'Failed to load lines.'}
            </p>
          ) : (lineItems.data ?? []).length === 0 ? (
            <DetailSectionEmptyCoaching
              entity="line"
              explainer="Lines are the items packed onto this shipment. Add them so the warehouse knows what to pull and the customer sees the right manifest."
              icon={Package}
            />
          ) : (
            <table className="w-full border border-line">
              <thead className="bg-bg-2 text-left text-sm font-display tracking-wider text-ink">
                <tr>
                  <th className="px-4 py-2">Item</th>
                  <th className="px-4 py-2">Qty</th>
                  <th className="px-4 py-2">Unit cost</th>
                  <th className="px-4 py-2">UOM</th>
                  <th className="px-4 py-2">Reference</th>
                  <th className="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {(lineItems.data ?? []).map((l) => (
                    <tr key={l.id} className="border-t border-line">
                      <td className="px-4 py-2">
                        <EntityLabel kind="item" id={l.item_id} />
                      </td>
                      <td className="px-4 py-2 tabular-nums text-sm">
                        {Number(l.quantity).toFixed(2)}
                      </td>
                      <td className="px-4 py-2 tabular-nums text-sm">
                        {l.unit_cost_cents == null
                          ? ''
                          : formatCents(l.unit_cost_cents, 'USD')}
                      </td>
                      <td className="px-4 py-2 font-mono text-sm">{l.uom ?? ''}</td>
                      <td className="px-4 py-2 font-mono text-sm">{l.reference ?? ''}</td>
                      <td className="px-4 py-2">
                        {linesEditable && caps.can('shipment.line_item.delete') && (
                          <Button
                            variant="ghost"
                            onClick={() => removeLine.mutate(l.id)}
                            disabled={removeLine.isPending}
                          >
                            Remove
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          )}
          {removeLine.isError && (
            <p className="mt-2 text-accent font-sans text-sm">
              Remove line failed:{' '}
              {removeLine.error instanceof Error ? removeLine.error.message : 'unknown error'}
            </p>
          )}

          {linesEditable && caps.can('shipment.line_item.create') && (
            <form
              onSubmit={onAddLine}
              className="flex flex-col gap-3 border border-line p-4 mt-4"
            >
              <h3 className="font-display tracking-wider text-ink">ADD LINE</h3>
              <ItemPicker
                value={selectedItemId}
                onChange={(itemId) => setSelectedItemId(itemId)}
                label="Item"
                filter={{ active: true }}
              />
              <div className="flex gap-3 flex-wrap items-end">
                <TextInput
                  label="Quantity"
                  value={qty}
                  onChange={(e) => setQty(e.target.value)}
                  inputMode="decimal"
                  required
                />
                <TextInput
                  label="Unit cost (whole cents, e.g. 250 = $2.50)"
                  value={unitCost}
                  onChange={(e) => setUnitCost(e.target.value)}
                  inputMode="numeric"
                />
                <TextInput
                  label="UOM"
                  value={uom}
                  onChange={(e) => setUom(e.target.value)}
                />
                <TextInput
                  label="Reference"
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                />
                <SupplySourceSelect
                  value={supplySource}
                  onChange={setSupplySource}
                />
                <Button
                  type="submit"
                  disabled={!selectedItemId || addLine.isPending}
                >
                  {addLine.isPending ? 'Adding.' : 'Add line'}
                </Button>
              </div>
              {addLine.isError && (
                <p className="text-accent font-sans text-sm">
                  Add line failed:{' '}
                  {addLine.error instanceof Error ? addLine.error.message : 'unknown error'}
                </p>
              )}
            </form>
          )}
        </section>
      </DetailLayout>
    </section>
  );
}
