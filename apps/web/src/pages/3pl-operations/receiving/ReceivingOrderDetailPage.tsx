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
import { TextInput } from '@/components/ui/TextInput';
import { ItemPicker } from '@/components/ui/pickers';
import {
  useReceivingOrder, useTransitionReceivingOrder,
  useReceivingOrderLineItems, useCreateReceivingOrderLineItem,
  useDeleteReceivingOrderLineItem,
} from '@/lib/hooks/useOps';
import { useVioCapabilities } from '@/lib/hooks/useVioCapabilities';
import { RECEIVING_ORDER_FSM } from '@/lib/workflow/vendors_inventory_ops';
import type { ReceivingOrderStatus } from '@/lib/types/vendors_inventory_ops';
import { formatCents } from '@/lib/money';
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

  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [qty, setQty] = useState('1');
  const [unitCost, setUnitCost] = useState('');
  const [uom, setUom] = useState('');
  const [reference, setReference] = useState('');

  if (r.isLoading) return <p className="px-8 py-12 text-ink-dim">Loading.</p>;
  if (r.error || !r.data) return <p className="px-8 py-12 text-accent">Receiving order not found.</p>;
  const d = r.data;
  const next = RECEIVING_ORDER_FSM.transitions.filter((t) => t.from === d.status).map((t) => t.to);

  // Line editing is allowed while the parent is editable. Once received or
  // cancelled the lines are part of the immutable record; the emit_movements
  // trigger has already fired against receiving_order_line_items on the
  // transition to received.
  const linesEditable = d.status === 'created' || d.status === 'in_progress';

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
      },
      {
        onSuccess: () => {
          setSelectedItemId(null);
          setQty('1');
          setUnitCost('');
          setUom('');
          setReference('');
        },
      },
    );
  };

  return (
    <section className="px-8 py-12 max-w-4xl mx-auto flex flex-col gap-6">
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
      <header className="flex items-center justify-between">
        <h1 className="text-4xl font-display tracking-wide text-ink">RECEIVING {d.receiving_number ?? d.id.slice(0, 8)}</h1>
      </header>
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
                transition.mutate(to as ReceivingOrderStatus);
              }}
              disabled={transition.isPending}
              className="px-3 py-1 border border-line font-sans text-xs uppercase text-ink hover:bg-bg-2">{to}</button>
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
              to={`/3pl-operations/projects/${d.project_id}`}
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
                    <td className="px-4 py-2 font-mono text-sm">
                      {Number(l.quantity).toFixed(2)}
                    </td>
                    <td className="px-4 py-2 font-mono text-sm">
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

      <section className="mt-6">
        <h2 className="text-2xl font-display tracking-wide text-ink mb-3">HISTORY</h2>
        <AuditTimeline entityType="receiving_order" entityId={id ?? null} />
      </section>
    </section>
  );
}
