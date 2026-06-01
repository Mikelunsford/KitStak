import { useMemo, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import { AuditTimeline } from '@/components/shell/AuditTimeline';
import { Breadcrumbs } from '@/components/shell/Breadcrumbs';
import { EntityLabel } from '@/components/data/EntityLabel';
import { Button } from '@/components/ui/Button';
import { TextInput } from '@/components/ui/TextInput';
import { ItemPicker } from '@/components/ui/pickers';
import {
  useSalesOrder,
  useSalesChannelsList,
  useConfirmSalesOrder,
  useCancelSalesOrder,
  useDeleteSalesOrder,
  useSalesOrderLines,
  useAddSalesOrderLine,
  useDeleteSalesOrderLine,
} from '@/lib/hooks/useCoPack';
import { useVioCapabilities } from '@/lib/hooks/useVioCapabilities';
import { formatCents, roundHalfEven } from '@/lib/money';
import { destructiveConfirm } from '@/lib/destructiveConfirm';
import { defaultStateLabel } from '@/components/shell/auditStateFormatters';
import { formatDateTimeMedium } from '@/lib/dates';

/**
 * SalesOrderDetailPage. Pillar 3. Mirrors ManufacturingRunDetailPage.
 *
 * State machine: draft -> confirmed -> picking -> packed -> shipped;
 * draft|confirmed|picking|packed -> cancelled. picking/packed/shipped are
 * advanced by the fulfillment lifecycle, not from this page; here the operator
 * confirms a draft or cancels an order that has not shipped. Lines are editable
 * only while the order is draft. Status renders as a simple inline pill (no
 * StateStepper: the copack FSMs are not registered in STATE_STEPPER_PATHS).
 */
export function SalesOrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const orderId = id ?? '';
  const navigate = useNavigate();

  const order = useSalesOrder(id);
  const channels = useSalesChannelsList();
  const confirm = useConfirmSalesOrder(orderId);
  const cancel = useCancelSalesOrder(orderId);
  const remove = useDeleteSalesOrder(orderId);

  const lines = useSalesOrderLines(id);
  const addLine = useAddSalesOrderLine(orderId);
  const removeLine = useDeleteSalesOrderLine(orderId);

  const caps = useVioCapabilities();

  const [lineItemId, setLineItemId] = useState<string | null>(null);
  const [lineQty, setLineQty] = useState('1');
  const [linePrice, setLinePrice] = useState('');
  const [lineUom, setLineUom] = useState('');
  const [lineReference, setLineReference] = useState('');

  const channelName = useMemo(() => {
    const map: Record<string, string> = {};
    for (const c of channels.data ?? []) map[c.id] = c.name;
    return map;
  }, [channels.data]);

  if (order.isLoading) return <p className="px-8 py-12 text-ink-dim">Loading.</p>;
  if (order.error || !order.data) {
    return <p className="px-8 py-12 text-accent">Sales order not found.</p>;
  }
  const d = order.data;
  const orderCurrency = d.currency_code ?? 'USD';
  const orderTotalCents = (lines.data ?? []).reduce(
    (sum, l) =>
      sum + (l.unit_price_cents == null ? 0 : roundHalfEven(Number(l.quantity) * Number(l.unit_price_cents))),
    0,
  );

  const isDraft = d.status === 'draft';
  const canCancel = d.status === 'draft' || d.status === 'confirmed' || d.status === 'picking' || d.status === 'packed';

  function onAddLine(e: FormEvent) {
    e.preventDefault();
    if (!lineItemId) return;
    addLine.mutate(
      {
        item_id: lineItemId,
        quantity: lineQty,
        unit_price_cents: linePrice === '' ? null : Number(linePrice),
        uom: lineUom === '' ? null : lineUom,
        reference: lineReference === '' ? null : lineReference,
      },
      {
        onSuccess: () => {
          setLineItemId(null);
          setLineQty('1');
          setLinePrice('');
          setLineUom('');
          setLineReference('');
        },
      },
    );
  }

  async function onRemoveLine(lineId: string) {
    if (!(await destructiveConfirm({
      action: 'Remove this order line',
      consequence: 'The line will be deleted from the order.',
    }))) return;
    removeLine.mutate(lineId);
  }

  async function onConfirm() {
    if (!(await destructiveConfirm({
      action: 'Confirm this sales order',
      consequence: 'The order moves to confirmed and its lines are locked.',
    }))) return;
    confirm.mutate();
  }

  async function onCancel() {
    if (!(await destructiveConfirm({
      action: 'Cancel this sales order',
      consequence: 'The order will move to cancelled and stop appearing in active order lists.',
    }))) return;
    cancel.mutate();
  }

  async function onDelete() {
    if (!(await destructiveConfirm({
      action: 'Delete this draft sales order',
      consequence: 'The draft will be removed permanently.',
      irreversible: true,
    }))) return;
    remove.mutate(undefined, {
      onSuccess: () => navigate('/copack/orders'),
    });
  }

  return (
    <section className="px-8 py-12 max-w-4xl mx-auto flex flex-col gap-6">
      <Breadcrumbs
        items={[
          { label: 'Co-Pack', to: '/copack/orders' },
          { label: 'Orders', to: '/copack/orders' },
          { label: d.order_number ?? d.id.slice(0, 8) },
        ]}
      />
      <header className="flex items-center justify-between">
        <h1 className="text-4xl font-display tracking-wide text-ink">
          SALES ORDER {d.order_number ?? d.id.slice(0, 8)}
        </h1>
        <span className="inline-block px-3 py-1 border border-line text-xs font-mono uppercase text-ink-dim">
          {defaultStateLabel(d.status)}
        </span>
      </header>

      <div className="flex gap-2 flex-wrap">
        {isDraft && caps.can('copack.order.confirm') && (
          <button
            onClick={onConfirm}
            disabled={confirm.isPending}
            className="px-3 py-1 border border-line font-sans text-xs uppercase text-ink hover:bg-bg-2"
          >
            Confirm
          </button>
        )}
        {canCancel && caps.can('copack.order.cancel') && (
          <button
            onClick={onCancel}
            disabled={cancel.isPending}
            className="px-3 py-1 border border-line font-sans text-xs uppercase text-ink hover:bg-bg-2"
          >
            Cancel order
          </button>
        )}
        {isDraft && caps.can('copack.order.update') && (
          <button
            onClick={onDelete}
            disabled={remove.isPending}
            className="px-3 py-1 border border-line font-sans text-xs uppercase text-ink hover:bg-bg-2"
          >
            Delete
          </button>
        )}
      </div>
      {confirm.error ? (
        <p className="font-sans text-sm text-accent">
          {confirm.error instanceof Error ? confirm.error.message : 'Confirm failed.'}
        </p>
      ) : null}
      {cancel.error ? (
        <p className="font-sans text-sm text-accent">
          {cancel.error instanceof Error ? cancel.error.message : 'Cancel failed.'}
        </p>
      ) : null}
      {remove.error ? (
        <p className="font-sans text-sm text-accent">
          {remove.error instanceof Error ? remove.error.message : 'Delete failed.'}
        </p>
      ) : null}

      <dl className="grid grid-cols-2 gap-4 font-sans text-sm">
        <dt className="text-ink-dim">Channel</dt>
        <dd className="text-ink">
          {d.channel_id ? (channelName[d.channel_id] ?? d.channel_id.slice(0, 8)) : 'None'}
        </dd>
        <dt className="text-ink-dim">Customer</dt>
        <dd className="text-ink">
          {d.customer_id ? <EntityLabel kind="customer" id={d.customer_id} /> : 'None'}
        </dd>
        <dt className="text-ink-dim">Project</dt>
        <dd className="text-ink">
          {d.project_id ? <EntityLabel kind="project" id={d.project_id} /> : 'None'}
        </dd>
        <dt className="text-ink-dim">Currency</dt>
        <dd className="text-ink">{d.currency_code ?? ''}</dd>
        <dt className="text-ink-dim">Ordered</dt>
        <dd className="text-ink">{formatDateTimeMedium(d.ordered_at)}</dd>
        <dt className="text-ink-dim">Confirmed</dt>
        <dd className="text-ink">{formatDateTimeMedium(d.confirmed_at)}</dd>
        <dt className="text-ink-dim">Shipped</dt>
        <dd className="text-ink">{formatDateTimeMedium(d.shipped_at)}</dd>
        <dt className="text-ink-dim">Cancelled</dt>
        <dd className="text-ink">{formatDateTimeMedium(d.cancelled_at)}</dd>
        <dt className="text-ink-dim">Notes</dt>
        <dd className="text-ink whitespace-pre-wrap">{d.notes ?? ''}</dd>
      </dl>

      <section>
        <div className="flex items-baseline gap-3 mb-3">
          <h2 className="text-2xl font-display tracking-wider text-ink">ORDER LINES</h2>
          {lines.isFetching && !lines.isLoading ? (
            <span className="text-xs text-ink-dim font-sans" aria-live="polite">Updating.</span>
          ) : null}
        </div>
        {lines.isLoading ? (
          <p className="text-ink-dim text-sm">Loading lines.</p>
        ) : lines.error ? (
          <p className="text-accent text-sm">
            {lines.error instanceof Error ? lines.error.message : 'Failed to load lines.'}
          </p>
        ) : (
          <table className="w-full border border-line">
            <thead className="bg-bg-2 text-left text-sm font-display tracking-wider text-ink">
              <tr>
                <th className="px-4 py-2">Item</th>
                <th className="px-4 py-2">Qty</th>
                <th className="px-4 py-2">Unit price</th>
                <th className="px-4 py-2">UOM</th>
                <th className="px-4 py-2">Reference</th>
                <th className="px-4 py-2">Line total</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {(lines.data ?? []).length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-3 text-ink-dim text-sm">
                    No order lines yet.
                  </td>
                </tr>
              ) : (
                (lines.data ?? []).map((l) => (
                  <tr key={l.id} className="border-t border-line">
                    <td className="px-4 py-2">
                      <EntityLabel kind="item" id={l.item_id} />
                    </td>
                    <td className="px-4 py-2 font-mono text-sm">{Number(l.quantity).toFixed(2)}</td>
                    <td className="px-4 py-2 font-mono text-sm">
                      {l.unit_price_cents == null ? '·' : formatCents(l.unit_price_cents, orderCurrency)}
                    </td>
                    <td className="px-4 py-2 font-mono text-sm">{l.uom ?? '·'}</td>
                    <td className="px-4 py-2 text-sm text-ink-dim">{l.reference ?? '·'}</td>
                    <td className="px-4 py-2 font-mono text-sm">
                      {l.unit_price_cents == null
                        ? '·'
                        : formatCents(roundHalfEven(Number(l.quantity) * Number(l.unit_price_cents)), orderCurrency)}
                    </td>
                    <td className="px-4 py-2">
                      {isDraft && caps.can('copack.order.line_item.delete') && (
                        <Button
                          variant="ghost"
                          onClick={() => onRemoveLine(l.id)}
                          disabled={removeLine.isPending}
                        >
                          Remove
                        </Button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
            {(lines.data ?? []).length > 0 ? (
              <tfoot>
                <tr className="border-t border-line bg-bg-2">
                  <td colSpan={5} className="px-4 py-2 text-right font-display tracking-wider text-ink">
                    Order total
                  </td>
                  <td className="px-4 py-2 font-mono text-sm text-ink">
                    {formatCents(orderTotalCents, orderCurrency)}
                  </td>
                  <td className="px-4 py-2"></td>
                </tr>
              </tfoot>
            ) : null}
          </table>
        )}
        {removeLine.error ? (
          <p className="mt-2 text-accent font-sans text-sm">
            Remove failed:{' '}
            {removeLine.error instanceof Error ? removeLine.error.message : 'unknown error'}
          </p>
        ) : null}

        {isDraft && caps.can('copack.order.line_item.create') && (
          <form onSubmit={onAddLine} className="flex flex-col gap-3 border border-line p-4 mt-4">
            <h3 className="font-display tracking-wider text-ink">ADD ORDER LINE</h3>
            <ItemPicker
              value={lineItemId}
              onChange={setLineItemId}
              label="Item"
              filter={{ active: true }}
            />
            <div className="flex gap-3 flex-wrap items-end">
              <TextInput
                label="Quantity"
                value={lineQty}
                onChange={(e) => setLineQty(e.target.value)}
                inputMode="decimal"
                required
              />
              <TextInput
                label="Unit price (whole cents, e.g. 250 = $2.50)"
                value={linePrice}
                onChange={(e) => setLinePrice(e.target.value)}
                inputMode="numeric"
              />
              <TextInput
                label="UOM"
                value={lineUom}
                onChange={(e) => setLineUom(e.target.value)}
              />
              <TextInput
                label="Reference"
                value={lineReference}
                onChange={(e) => setLineReference(e.target.value)}
              />
              <Button type="submit" disabled={!lineItemId || addLine.isPending}>
                {addLine.isPending ? 'Adding.' : 'Add line'}
              </Button>
            </div>
            {addLine.error ? (
              <p className="text-accent font-sans text-sm">
                Add failed:{' '}
                {addLine.error instanceof Error ? addLine.error.message : 'unknown error'}
              </p>
            ) : null}
          </form>
        )}
      </section>

      <section className="mt-6">
        <h2 className="text-2xl font-display tracking-wide text-ink mb-3">HISTORY</h2>
        <AuditTimeline entityType="sales_order" entityId={id ?? null} />
      </section>
    </section>
  );
}
