import { useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Package } from 'lucide-react';

import { AuditTimeline } from '@/components/shell/AuditTimeline';
import { Breadcrumbs } from '@/components/shell/Breadcrumbs';
import { DetailSectionEmptyCoaching } from '@/components/shell/DetailSectionEmptyCoaching';
import { StateStepper } from '@/components/shell/StateStepper';
import { EntityLabel } from '@/components/data/EntityLabel';
import {
  STATE_STEPPER_PATHS,
  isOffPath,
} from '@/lib/workflow/stateStepperPaths';
import { Button } from '@/components/ui/Button';
import { PageHeader } from '@/components/ui/PageHeader';
import { DetailLayout } from '@/components/ui/DetailLayout';
import { TextInput } from '@/components/ui/TextInput';
import { Select } from '@/components/ui/Select';
import { ItemPicker } from '@/components/ui/pickers';
import { SupplySourceSelect } from '@/components/forms/SupplySourceSelect';
import {
  useReceivingOrder, useTransitionReceivingOrder,
  useReceivingOrderLineItems, useCreateReceivingOrderLineItem,
  useDeleteReceivingOrderLineItem,
} from '@/lib/hooks/useOps';
import { useVioCapabilities } from '@/lib/hooks/useVioCapabilities';
import { useOrgFlags } from '@/lib/hooks/useOrgFlags';
import { useWmsLocationsList } from '@/lib/hooks/useWmsLocations';
import { useWmsLotsList } from '@/lib/hooks/useWmsLots';
import { FEATURE_FLAGS } from '@/lib/constants';
import { RECEIVING_ORDER_FSM } from '@/lib/workflow/vendors_inventory_ops';
import type { ReceivingOrderStatus } from '@/lib/types/vendors_inventory_ops';
import { formatCents } from '@/lib/money';
import { isZeroCostSupplySource } from '@/lib/supplySource';
import type { ItemSupplySource } from '@/lib/types/sales';
import { destructiveConfirm } from '@/lib/destructiveConfirm';

export function ReceivingOrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const receivingOrderId = id ?? '';
  const r = useReceivingOrder(id);
  const transition = useTransitionReceivingOrder(receivingOrderId);
  const lineItems = useReceivingOrderLineItems(id);
  const addLine = useCreateReceivingOrderLineItem(receivingOrderId);
  const removeLine = useDeleteReceivingOrderLineItem(receivingOrderId);
  const caps = useVioCapabilities();

  // WMS receiving-to-dock (F-Wave12-WMS-RECEIVE-DOCK-01): the dock / staging
  // picker renders only when plugins.wms is enabled for the active org. The
  // gate is read via the same flags hook RequirePlugin uses (no new gate). When
  // WMS is off the picker is absent and dock_location_id is never sent, so the
  // receive path stays a pure NULL no-op.
  const flags = useOrgFlags();
  const wmsEnabled = flags.data[FEATURE_FLAGS.PLUGINS_WMS] === true;
  const warehouseId = r.data?.warehouse_id;
  // B1 WMS locations filtered to this order's warehouse. The list filter accepts
  // one location_type, so dock and staging are two queries merged client-side.
  // Lazy: this whole page is a lazy route, so the WMS code lands in the receiving
  // chunk, not the eager SPA index.
  const dockEnabled = wmsEnabled && !!warehouseId;
  // warehouseId is coalesced for the filter type (exactOptionalPropertyTypes);
  // the query is disabled via dockEnabled until the order (and its warehouse)
  // resolves, so the empty string is never sent.
  const dockLocations = useWmsLocationsList(
    { warehouse_id: warehouseId ?? '', location_type: 'dock', active: true },
    dockEnabled,
  );
  const stagingLocations = useWmsLocationsList(
    { warehouse_id: warehouseId ?? '', location_type: 'staging', active: true },
    dockEnabled,
  );
  const dockOptions = wmsEnabled
    ? [...(dockLocations.data ?? []), ...(stagingLocations.data ?? [])]
    : [];
  const [selectedDockId, setSelectedDockId] = useState('');

  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [qty, setQty] = useState('1');
  const [unitCost, setUnitCost] = useState('');
  const [uom, setUom] = useState('');
  const [reference, setReference] = useState('');
  const [supplySource, setSupplySource] = useState<ItemSupplySource | null>(null);
  const [itemDefaultSource, setItemDefaultSource] =
    useState<ItemSupplySource | null>(null);
  const [lotId, setLotId] = useState('');

  // WMS Body B Phase B4 lot capture: an optional lot on the received line. The
  // picker renders only when plugins.wms is on AND an item is selected; the lot
  // list is filtered to that item. When WMS is off the picker is absent and
  // lot_id is never sent, so the receive path stays a pure NULL no-op. Lazy: the
  // whole page is a lazy route, so the WMS lot code lands in this chunk.
  const lotPickerEnabled = wmsEnabled && !!selectedItemId;
  const lotOptions = useWmsLotsList(
    { item_id: selectedItemId ?? '', status: 'active' },
    lotPickerEnabled,
  );

  if (r.isLoading) return <p className="px-8 py-12 text-ink-dim">Loading.</p>;
  if (r.error || !r.data) return <p className="px-8 py-12 text-accent">Receiving order not found.</p>;
  const d = r.data;
  const next = RECEIVING_ORDER_FSM.transitions.filter((t) => t.from === d.status).map((t) => t.to);

  // Line editing is allowed while the parent is editable. Once received or
  // cancelled the lines are part of the immutable record; the emit_movements
  // trigger has already fired against receiving_order_line_items on the
  // transition to received.
  const linesEditable = d.status === 'created' || d.status === 'in_progress';

  // The effective source for this line is the override if set, else the item
  // default. Org cost is not captured for not-org-owned material, so the unit
  // cost input is disabled (and sent null) when the effective source is
  // customer_supplied or third_party_consigned.
  const effectiveSupplySource: ItemSupplySource | null =
    supplySource ?? itemDefaultSource;
  const costDisabled =
    effectiveSupplySource !== null &&
    isZeroCostSupplySource(effectiveSupplySource);

  const onAddLine = (e: FormEvent) => {
    e.preventDefault();
    if (!selectedItemId) return;
    addLine.mutate(
      {
        item_id: selectedItemId,
        quantity: qty,
        unit_cost_cents: costDisabled || unitCost === '' ? null : Number(unitCost),
        uom: uom === '' ? null : uom,
        reference: reference === '' ? null : reference,
        supply_source: supplySource,
        // Send lot_id only when WMS is on and a lot was chosen; otherwise omit it
        // so the line keeps a NULL lot (the no-lot partition).
        ...(wmsEnabled && lotId ? { lot_id: lotId } : {}),
      },
      {
        onSuccess: () => {
          setSelectedItemId(null);
          setQty('1');
          setUnitCost('');
          setUom('');
          setReference('');
          setSupplySource(null);
          setItemDefaultSource(null);
          setLotId('');
        },
      },
    );
  };

  return (
    <section className="px-8 py-12 max-w-5xl mx-auto flex flex-col gap-6">
      <Breadcrumbs
        items={[
          { label: 'Receiving', to: '/3pl-operations/receiving' },
          { label: d.receiving_number ?? d.id.slice(0, 8) },
        ]}
      />
      {/* UX-Q7: display-only horizontal progress stepper. */}
      <StateStepper
        steps={[...STATE_STEPPER_PATHS.receiving_order.path]}
        current={d.status}
        offPath={
          isOffPath('receiving_order', d.status)
            ? {
                state: d.status,
                label: STATE_STEPPER_PATHS.receiving_order.resolveLabel(d.status),
              }
            : undefined
        }
      />
      <PageHeader
        title={`Receiving ${d.receiving_number ?? d.id.slice(0, 8)}`}
      />

      <DetailLayout
        rail={
          <section>
            <h2 className="text-2xl font-display tracking-wide text-ink mb-3">
              HISTORY
            </h2>
            <AuditTimeline entityType="receiving_order" entityId={id ?? null} />
          </section>
        }
      >
        {/* WMS receiving-to-dock: a single dock / staging selector for the whole
            receipt. Rendered only when plugins.wms is on AND 'received' is a
            reachable next state (the receipt has not yet posted). The 'Received'
            FSM transition carries the chosen dock on its /transition POST so the
            dock rides the same UPDATE that flips status -> received and the
            receipt-emitting trigger stamps it onto every movement. The server
            forces the dock to NULL when plugins.wms is off, so this picker is a
            convenience surface, not the authority. */}
        {wmsEnabled && caps.can('receiving.order.update') && next.includes('received') ? (
          <div className="flex flex-col gap-1 max-w-sm">
            <label
              htmlFor="dock-location"
              className="font-sans text-xs uppercase tracking-wider text-ink-dim"
            >
              Dock / staging location
            </label>
            <Select
              id="dock-location"
              value={selectedDockId}
              onChange={(e) => setSelectedDockId(e.target.value)}
              disabled={dockLocations.isLoading || stagingLocations.isLoading}
            >
              <option value="">No dock (warehouse level)</option>
              {dockOptions.map((loc) => (
                <option key={loc.id} value={loc.id}>
                  {loc.code} ({loc.location_type})
                </option>
              ))}
            </Select>
          </div>
        ) : null}
        {caps.can('receiving.order.update') && next.length > 0 ? (
          <div className="flex gap-2">
            {next.map((to) => (
              <button
                key={to}
                onClick={async () => {
                  // UX-Q8: cancelling reverses an inbound expectation.
                  if (to === 'cancelled' && !(await destructiveConfirm({
                    action: 'Cancel this receiving order',
                    consequence: 'The order will move to cancelled and the expected inbound stock will no longer be tracked.',
                  }))) return;
                  // WMS receiving-to-dock: the 'received' transition carries the
                  // chosen dock (null when none picked) on the SAME /transition
                  // POST so the dock rides the UPDATE that flips status ->
                  // received. WMS off keeps the plain transition with no dock,
                  // and the server forces NULL regardless, a pure no-op.
                  if (to === 'received' && wmsEnabled) {
                    transition.mutate({
                      to: 'received',
                      dock_location_id: selectedDockId === '' ? null : selectedDockId,
                    });
                    return;
                  }
                  transition.mutate({ to: to as ReceivingOrderStatus });
                }}
                disabled={transition.isPending}
                className="px-3 py-1 border border-line font-sans text-xs uppercase text-ink hover:bg-bg-2">{to.replace('_', ' ')}</button>
            ))}
          </div>
        ) : null}
        {transition.error && (
          <p className="font-sans text-sm text-accent">
            {transition.error instanceof Error
              ? transition.error.message
              : 'Transition failed.'}
          </p>
        )}
        <dl className="grid grid-cols-2 gap-4 font-sans text-sm">
          <dt className="text-ink-dim">Warehouse</dt><dd className="text-ink"><EntityLabel kind="warehouse" id={d.warehouse_id} /></dd>
          <dt className="text-ink-dim">Project</dt>
          <dd className="text-ink">
            {d.project_id ? (
              <Link
                to={`/projects/${d.project_id}`}
                className="text-ink hover:text-accent"
              >
                <EntityLabel kind="project" id={d.project_id} />
              </Link>
            ) : (
              ''
            )}
          </dd>
          <dt className="text-ink-dim">Expected</dt><dd className="text-ink">{d.expected_date ?? ''}</dd>
          <dt className="text-ink-dim">Received</dt><dd className="text-ink">{d.received_date ?? ''}</dd>
          <dt className="text-ink-dim">Reference</dt><dd className="text-ink">{d.reference ?? ''}</dd>
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
              explainer="Lines are the items expected on this inbound receipt. Add them so the warehouse knows what to check in and stock counts update correctly."
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
                        {linesEditable && caps.can('receiving.line_item.delete') && (
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

          {linesEditable && caps.can('receiving.line_item.create') && (
            <form
              onSubmit={onAddLine}
              className="flex flex-col gap-3 border border-line p-4 mt-4"
            >
              <h3 className="font-display tracking-wider text-ink">ADD LINE</h3>
              <ItemPicker
                value={selectedItemId}
                onChange={(itemId, item) => {
                  setSelectedItemId(itemId);
                  setItemDefaultSource(item?.supply_source ?? null);
                  // Reset the lot when the item changes so a stale lot picked for
                  // a prior item cannot ride onto a new item line (the lot list is
                  // item-filtered; the server also 404s a cross-item lot, but the
                  // reset keeps the UI coherent).
                  setLotId('');
                }}
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
                  value={costDisabled ? '' : unitCost}
                  onChange={(e) => setUnitCost(e.target.value)}
                  inputMode="numeric"
                  disabled={costDisabled}
                />
                <SupplySourceSelect
                  value={supplySource}
                  onChange={setSupplySource}
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
                {wmsEnabled && (
                  <label className="flex flex-col gap-2">
                    <span className="font-sans text-sm text-ink-dim tracking-wide uppercase">
                      Lot
                    </span>
                    <Select
                      value={lotId}
                      onChange={(e) => setLotId(e.target.value)}
                      aria-label="Lot"
                      disabled={!selectedItemId}
                    >
                      <option value="">None</option>
                      {(lotOptions.data ?? []).map((l) => (
                        <option key={l.id} value={l.id}>
                          {l.lot_code}
                        </option>
                      ))}
                    </Select>
                  </label>
                )}
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
