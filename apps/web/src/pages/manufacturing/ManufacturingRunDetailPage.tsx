import { useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import { AuditTimeline } from '@/components/shell/AuditTimeline';
import { Breadcrumbs } from '@/components/shell/Breadcrumbs';
import { EntityLabel } from '@/components/data/EntityLabel';
import { Button } from '@/components/ui/Button';
import { TextInput } from '@/components/ui/TextInput';
import { ItemPicker } from '@/components/ui/pickers';
import {
  useManufacturingRun,
  useStartManufacturingRun,
  useCompleteManufacturingRun,
  useCancelManufacturingRun,
  useDeleteManufacturingRun,
  useManufacturingRunConsumedLines,
  useAddConsumedLine,
  useDeleteConsumedLine,
  useManufacturingRunProducedLines,
  useAddProducedLine,
  useDeleteProducedLine,
} from '@/lib/hooks/useManufacturing';
import { useStockLevels } from '@/lib/hooks/useInventory';
import { useVioCapabilities } from '@/lib/hooks/useVioCapabilities';
import { formatCents } from '@/lib/money';

/**
 * Non-blocking warning surfaced when staging a Consumed line would push the
 * projected on-hand for the (run.warehouse_id, item_id) pair below zero.
 *
 * Lives in its own component so useStockLevels only fires when both
 * warehouseId and itemId are present; otherwise the hook would request the
 * entire stock_levels table.
 *
 * Closes F-Wave9-MFG-NEGATIVE-STOCK-WARN-01. Constitution stays permissive:
 * negative on-hand is allowed at the DB layer (no CHECK constraint, no API
 * 422); this is a UI signal only. Save still succeeds.
 */
function ConsumeNegativeStockWarning(props: {
  warehouseId: string;
  itemId: string;
  enteredQty: number;
  stagedConsumedQty: number;
}) {
  const stock = useStockLevels({
    warehouseId: props.warehouseId,
    itemId: props.itemId,
  });
  if (stock.isLoading || stock.error) return null;
  const row = (stock.data ?? []).find(
    (r) => r.warehouse_id === props.warehouseId && r.item_id === props.itemId,
  );
  const onHand = Number(row?.quantity_on_hand ?? 0);
  const projected = onHand - props.stagedConsumedQty - props.enteredQty;
  if (projected >= 0) return null;
  return (
    <p
      role="status"
      className="font-sans text-sm text-warning border-l-2 border-warning pl-3 py-1 bg-warning/5"
    >
      Warning: this consume would result in {projected.toFixed(2)} on hand for
      the selected item at this warehouse. The save will still succeed (Kitstak
      allows negative on-hand by design); confirm the inventory delta is what
      you expect.
    </p>
  );
}

/**
 * ManufacturingRunDetailPage. Path A5. Mirrors ReceivingOrderDetailPage.
 *
 * State machine: draft -> started -> completed; draft|started -> cancelled.
 * Completion fires tg_manufacturing_runs_emit_movements (migration 0053)
 * which writes stock_movements when warehouse_id is non-null. We gate the
 * Complete button behind a confirm() because it's irreversible (the trigger
 * has fired, and the audit chain refuses post-completion delete).
 *
 * Line editing is allowed in draft and started; once the run completes or
 * cancels, line edits are blocked client-side AND server-side (the bundle
 * still allows line CRUD via cap-gating, but operators should not be
 * mutating lines after completion since stock_movements are already booked).
 */
export function ManufacturingRunDetailPage() {
  const { id } = useParams<{ id: string }>();
  const runId = id ?? '';
  const navigate = useNavigate();

  const run = useManufacturingRun(id);
  const start = useStartManufacturingRun(runId);
  const complete = useCompleteManufacturingRun(runId);
  const cancel = useCancelManufacturingRun(runId);
  const remove = useDeleteManufacturingRun(runId);

  const consumed = useManufacturingRunConsumedLines(id);
  const addConsumed = useAddConsumedLine(runId);
  const removeConsumed = useDeleteConsumedLine(runId);

  const produced = useManufacturingRunProducedLines(id);
  const addProduced = useAddProducedLine(runId);
  const removeProduced = useDeleteProducedLine(runId);

  const caps = useVioCapabilities();

  // Consumed add form state.
  const [conItemId, setConItemId] = useState<string | null>(null);
  const [conQty, setConQty] = useState('1');
  const [conCost, setConCost] = useState('');
  const [conUom, setConUom] = useState('');

  // Produced add form state.
  const [prodItemId, setProdItemId] = useState<string | null>(null);
  const [prodQty, setProdQty] = useState('1');
  const [prodCost, setProdCost] = useState('');
  const [prodUom, setProdUom] = useState('');

  if (run.isLoading) return <p className="px-8 py-12 text-ink-dim">Loading.</p>;
  if (run.error || !run.data) {
    return <p className="px-8 py-12 text-accent">Manufacturing run not found.</p>;
  }
  const d = run.data;

  const isDraft = d.status === 'draft';
  const isStarted = d.status === 'started';
  const linesEditable = isDraft || isStarted;

  function onAddConsumed(e: FormEvent) {
    e.preventDefault();
    if (!conItemId) return;
    addConsumed.mutate(
      {
        item_id: conItemId,
        quantity: conQty,
        unit_cost_cents: conCost === '' ? null : Number(conCost),
        uom: conUom === '' ? null : conUom,
      },
      {
        onSuccess: () => {
          setConItemId(null);
          setConQty('1');
          setConCost('');
          setConUom('');
        },
      },
    );
  }

  function onAddProduced(e: FormEvent) {
    e.preventDefault();
    addProduced.mutate(
      {
        item_id: prodItemId ?? null,
        quantity: prodQty,
        unit_cost_cents: prodCost === '' ? null : Number(prodCost),
        uom: prodUom === '' ? null : prodUom,
      },
      {
        onSuccess: () => {
          setProdItemId(null);
          setProdQty('1');
          setProdCost('');
          setProdUom('');
        },
      },
    );
  }

  function onComplete() {
    const ok = window.confirm(
      'Complete this manufacturing run? This writes stock movements and cannot be undone.',
    );
    if (!ok) return;
    complete.mutate();
  }

  function onCancel() {
    const ok = window.confirm('Cancel this manufacturing run?');
    if (!ok) return;
    cancel.mutate();
  }

  function onDelete() {
    const ok = window.confirm('Delete this draft manufacturing run?');
    if (!ok) return;
    remove.mutate(undefined, {
      onSuccess: () => navigate('/manufacturing/runs'),
    });
  }

  return (
    <section className="px-8 py-12 max-w-4xl mx-auto flex flex-col gap-6">
      <Breadcrumbs
        items={[
          { label: 'Manufacturing', to: '/manufacturing/runs' },
          { label: 'Runs', to: '/manufacturing/runs' },
          { label: d.run_number ?? d.id.slice(0, 8) },
        ]}
      />
      <header className="flex items-center justify-between">
        <h1 className="text-4xl font-display tracking-wide text-ink">
          MANUFACTURING RUN {d.run_number ?? d.id.slice(0, 8)}
        </h1>
        <span className="px-2 py-0.5 border border-line text-xs font-mono uppercase text-ink-dim">
          {d.status}
        </span>
      </header>

      <div className="flex gap-2 flex-wrap">
        {isDraft && caps.can('manufacturing.run.start') && (
          <button
            onClick={() => start.mutate()}
            disabled={start.isPending}
            className="px-3 py-1 border border-line font-sans text-xs uppercase text-ink hover:bg-bg-2"
          >
            Start
          </button>
        )}
        {isStarted && caps.can('manufacturing.run.complete') && (
          <button
            onClick={onComplete}
            disabled={complete.isPending}
            className="px-3 py-1 border border-line font-sans text-xs uppercase text-ink hover:bg-bg-2"
          >
            Complete
          </button>
        )}
        {(isDraft || isStarted) && caps.can('manufacturing.run.cancel') && (
          <button
            onClick={onCancel}
            disabled={cancel.isPending}
            className="px-3 py-1 border border-line font-sans text-xs uppercase text-ink hover:bg-bg-2"
          >
            Cancel run
          </button>
        )}
        {isDraft && caps.can('manufacturing.run.delete') && (
          <button
            onClick={onDelete}
            disabled={remove.isPending}
            className="px-3 py-1 border border-line font-sans text-xs uppercase text-ink hover:bg-bg-2"
          >
            Delete
          </button>
        )}
      </div>
      {start.error ? (
        <p className="font-sans text-sm text-accent">
          {start.error instanceof Error ? start.error.message : 'Start failed.'}
        </p>
      ) : null}
      {complete.error ? (
        <p className="font-sans text-sm text-accent">
          {complete.error instanceof Error ? complete.error.message : 'Complete failed.'}
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
        <dt className="text-ink-dim">Warehouse</dt>
        <dd className="text-ink">
          {d.warehouse_id ? <EntityLabel kind="warehouse" id={d.warehouse_id} /> : 'None'}
        </dd>
        <dt className="text-ink-dim">Planned start</dt>
        <dd className="text-ink">{d.planned_start_at ?? ''}</dd>
        <dt className="text-ink-dim">Planned complete</dt>
        <dd className="text-ink">{d.planned_complete_at ?? ''}</dd>
        <dt className="text-ink-dim">Started</dt>
        <dd className="text-ink">{d.started_at ?? ''}</dd>
        <dt className="text-ink-dim">Completed</dt>
        <dd className="text-ink">{d.completed_at ?? ''}</dd>
        <dt className="text-ink-dim">Cancelled</dt>
        <dd className="text-ink">{d.cancelled_at ?? ''}</dd>
        <dt className="text-ink-dim">Notes</dt>
        <dd className="text-ink whitespace-pre-wrap">{d.notes ?? ''}</dd>
      </dl>

      {/* Consumed materials */}
      <section>
        <h2 className="text-2xl font-display tracking-wider text-ink mb-3">CONSUMED MATERIALS</h2>
        {consumed.isLoading ? (
          <p className="text-ink-dim text-sm">Loading lines.</p>
        ) : consumed.error ? (
          <p className="text-accent text-sm">
            {consumed.error instanceof Error ? consumed.error.message : 'Failed to load lines.'}
          </p>
        ) : (
          <table className="w-full border border-line">
            <thead className="bg-bg-2 text-left text-sm font-display tracking-wider text-ink">
              <tr>
                <th className="px-4 py-2">Item</th>
                <th className="px-4 py-2">Qty</th>
                <th className="px-4 py-2">Unit cost</th>
                <th className="px-4 py-2">UOM</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {(consumed.data ?? []).length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-3 text-ink-dim text-sm">
                    No consumed materials yet.
                  </td>
                </tr>
              ) : (
                (consumed.data ?? []).map((l) => (
                  <tr key={l.id} className="border-t border-line">
                    <td className="px-4 py-2">
                      <EntityLabel kind="item" id={l.item_id} />
                    </td>
                    <td className="px-4 py-2 font-mono text-sm">
                      {Number(l.quantity).toFixed(2)}
                    </td>
                    <td className="px-4 py-2 font-mono text-sm">
                      {l.unit_cost_cents == null ? '' : formatCents(l.unit_cost_cents, 'USD')}
                    </td>
                    <td className="px-4 py-2 font-mono text-sm">{l.uom ?? ''}</td>
                    <td className="px-4 py-2">
                      {linesEditable && caps.can('manufacturing.run.line_item.delete') && (
                        <Button
                          variant="ghost"
                          onClick={() => removeConsumed.mutate(l.id)}
                          disabled={removeConsumed.isPending}
                        >
                          Remove
                        </Button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        )}
        {removeConsumed.error ? (
          <p className="mt-2 text-accent font-sans text-sm">
            Remove failed:{' '}
            {removeConsumed.error instanceof Error ? removeConsumed.error.message : 'unknown error'}
          </p>
        ) : null}

        {linesEditable && caps.can('manufacturing.run.line_item.create') && (
          <form
            onSubmit={onAddConsumed}
            className="flex flex-col gap-3 border border-line p-4 mt-4"
          >
            <h3 className="font-display tracking-wider text-ink">ADD CONSUMED MATERIAL</h3>
            <ItemPicker
              value={conItemId}
              onChange={setConItemId}
              label="Item"
              filter={{ active: true }}
            />
            <div className="flex gap-3 flex-wrap items-end">
              <TextInput
                label="Quantity"
                value={conQty}
                onChange={(e) => setConQty(e.target.value)}
                inputMode="decimal"
                required
              />
              <TextInput
                label="Unit cost (whole cents, e.g. 250 = $2.50)"
                value={conCost}
                onChange={(e) => setConCost(e.target.value)}
                inputMode="numeric"
              />
              <TextInput
                label="UOM"
                value={conUom}
                onChange={(e) => setConUom(e.target.value)}
              />
              <Button type="submit" disabled={!conItemId || addConsumed.isPending}>
                {addConsumed.isPending ? 'Adding.' : 'Add material'}
              </Button>
            </div>
            {d.warehouse_id && conItemId && Number(conQty) > 0 ? (
              <ConsumeNegativeStockWarning
                warehouseId={d.warehouse_id}
                itemId={conItemId}
                enteredQty={Number(conQty) || 0}
                stagedConsumedQty={(consumed.data ?? [])
                  .filter((l) => l.item_id === conItemId)
                  .reduce((acc, l) => acc + Number(l.quantity), 0)}
              />
            ) : null}
            {addConsumed.error ? (
              <p className="text-accent font-sans text-sm">
                Add failed:{' '}
                {addConsumed.error instanceof Error ? addConsumed.error.message : 'unknown error'}
              </p>
            ) : null}
          </form>
        )}
      </section>

      {/* Produced outputs */}
      <section>
        <h2 className="text-2xl font-display tracking-wider text-ink mb-3">PRODUCED OUTPUTS</h2>
        {produced.isLoading ? (
          <p className="text-ink-dim text-sm">Loading lines.</p>
        ) : produced.error ? (
          <p className="text-accent text-sm">
            {produced.error instanceof Error ? produced.error.message : 'Failed to load lines.'}
          </p>
        ) : (
          <table className="w-full border border-line">
            <thead className="bg-bg-2 text-left text-sm font-display tracking-wider text-ink">
              <tr>
                <th className="px-4 py-2">Item</th>
                <th className="px-4 py-2">Qty</th>
                <th className="px-4 py-2">Unit cost</th>
                <th className="px-4 py-2">UOM</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {(produced.data ?? []).length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-3 text-ink-dim text-sm">
                    No produced outputs yet.
                  </td>
                </tr>
              ) : (
                (produced.data ?? []).map((l) => (
                  <tr key={l.id} className="border-t border-line">
                    <td className="px-4 py-2">
                      {l.item_id ? (
                        <EntityLabel kind="item" id={l.item_id} />
                      ) : (
                        <span className="text-ink-dim text-xs">No item</span>
                      )}
                    </td>
                    <td className="px-4 py-2 font-mono text-sm">
                      {Number(l.quantity).toFixed(2)}
                    </td>
                    <td className="px-4 py-2 font-mono text-sm">
                      {l.unit_cost_cents == null ? '' : formatCents(l.unit_cost_cents, 'USD')}
                    </td>
                    <td className="px-4 py-2 font-mono text-sm">{l.uom ?? ''}</td>
                    <td className="px-4 py-2">
                      {linesEditable && caps.can('manufacturing.run.line_item.delete') && (
                        <Button
                          variant="ghost"
                          onClick={() => removeProduced.mutate(l.id)}
                          disabled={removeProduced.isPending}
                        >
                          Remove
                        </Button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        )}
        {removeProduced.error ? (
          <p className="mt-2 text-accent font-sans text-sm">
            Remove failed:{' '}
            {removeProduced.error instanceof Error ? removeProduced.error.message : 'unknown error'}
          </p>
        ) : null}

        {linesEditable && caps.can('manufacturing.run.line_item.create') && (
          <form
            onSubmit={onAddProduced}
            className="flex flex-col gap-3 border border-line p-4 mt-4"
          >
            <h3 className="font-display tracking-wider text-ink">ADD PRODUCED OUTPUT</h3>
            <ItemPicker
              value={prodItemId}
              onChange={setProdItemId}
              label="Item (optional)"
              filter={{ active: true }}
            />
            <div className="flex gap-3 flex-wrap items-end">
              <TextInput
                label="Quantity"
                value={prodQty}
                onChange={(e) => setProdQty(e.target.value)}
                inputMode="decimal"
                required
              />
              <TextInput
                label="Unit cost (whole cents, e.g. 250 = $2.50)"
                value={prodCost}
                onChange={(e) => setProdCost(e.target.value)}
                inputMode="numeric"
              />
              <TextInput
                label="UOM"
                value={prodUom}
                onChange={(e) => setProdUom(e.target.value)}
              />
              <Button type="submit" disabled={addProduced.isPending}>
                {addProduced.isPending ? 'Adding.' : 'Add output'}
              </Button>
            </div>
            {addProduced.error ? (
              <p className="text-accent font-sans text-sm">
                Add failed:{' '}
                {addProduced.error instanceof Error ? addProduced.error.message : 'unknown error'}
              </p>
            ) : null}
          </form>
        )}
      </section>

      <section className="mt-6">
        <h2 className="text-2xl font-display tracking-wide text-ink mb-3">HISTORY</h2>
        <AuditTimeline entityType="manufacturing_run" entityId={id ?? null} />
      </section>
    </section>
  );
}
