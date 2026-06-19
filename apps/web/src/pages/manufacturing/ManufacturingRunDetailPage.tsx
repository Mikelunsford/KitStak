// ManufacturingRunDetailPage. Pillar 2. Migration to the shared UI kit
// (F-Wave10-UI-KIT-01): PageHeader + DetailLayout (HISTORY in the rail) replace
// the hand-rolled header and bottom history section. manufacturing_run IS
// registered in STATE_STEPPER_PATHS, so the StateStepper is kept (it sits above
// the PageHeader and shows the status, so no separate StatusBadge). FSM
// transition controls move to the kit Button (ghost for the destructive
// cancel/delete, secondary for start/complete). The consumed/produced line
// tables stay hand-rolled (they have inline add forms and the
// ConsumeNegativeStockWarning); the start/complete/cancel/delete
// destructiveConfirms, the linesEditable gate, money via formatCents, and the
// cap gates are preserved verbatim.

import { useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import { AuditTimeline } from '@/components/shell/AuditTimeline';
import { Breadcrumbs } from '@/components/shell/Breadcrumbs';
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
import type { ItemSupplySource } from '@/lib/types/sales';
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
import { destructiveConfirm } from '@/lib/destructiveConfirm';

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
  const [conSupplySource, setConSupplySource] =
    useState<ItemSupplySource | null>(null);

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

  // F-UIUX-RAIL-FIRST-EDGE-01 (Pattern D, UX-Q7 reopened): the rail's immediate
  // next happy-path step is interactive only for the SAFE FIRST EDGE
  // draft -> started, which reuses the existing Start mutation. The rail never
  // offers started -> completed: that edge is destructive (it writes
  // production_consumed and production_produced stock movements) and stays
  // behind the Complete button's destructiveConfirm. Gate mirrors the Start
  // button: draft state, holds manufacturing.run.start, and the path's next
  // step is exactly `started`. The server stays the authority.
  const railNext = nextStepperState(
    STATE_STEPPER_PATHS.manufacturing_run.path,
    d.status,
  );
  const canAdvanceRail =
    railNext === 'started' && isDraft && caps.can('manufacturing.run.start');
  const advance = () => start.mutate();

  function onAddConsumed(e: FormEvent) {
    e.preventDefault();
    if (!conItemId) return;
    addConsumed.mutate(
      {
        item_id: conItemId,
        quantity: conQty,
        unit_cost_cents: conCost === '' ? null : Number(conCost),
        uom: conUom === '' ? null : conUom,
        supply_source: conSupplySource,
      },
      {
        onSuccess: () => {
          setConItemId(null);
          setConQty('1');
          setConCost('');
          setConUom('');
          setConSupplySource(null);
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

  async function onComplete() {
    // UX-Q8: Complete is the original precedent for destructive confirm.
    // Route through destructiveConfirm so the copy stays in sync with the
    // other irreversible transitions across the SPA.
    if (
      !(await destructiveConfirm({
        action: 'Complete this manufacturing run',
        consequence:
          'This writes production_consumed and production_produced stock movements.',
        irreversible: true,
      }))
    )
      return;
    complete.mutate();
  }

  async function onCancel() {
    // UX-Q8: cancelling an in-flight build reverses the work commitment.
    if (
      !(await destructiveConfirm({
        action: 'Cancel this manufacturing run',
        consequence:
          'The run will move to cancelled and stop appearing in active build lists.',
      }))
    )
      return;
    cancel.mutate();
  }

  async function onDelete() {
    if (
      !(await destructiveConfirm({
        action: 'Delete this draft manufacturing run',
        consequence: 'The draft will be removed permanently.',
        irreversible: true,
      }))
    )
      return;
    remove.mutate(undefined, {
      onSuccess: () => navigate('/manufacturing/runs'),
    });
  }

  return (
    <section className="mx-auto flex max-w-4xl flex-col gap-6 px-8 py-12">
      <Breadcrumbs
        items={[
          { label: 'Manufacturing', to: '/manufacturing/runs' },
          { label: 'Runs', to: '/manufacturing/runs' },
          { label: d.run_number ?? d.id.slice(0, 8) },
        ]}
      />
      {/* UX-Q7 reopened (Pattern D): the rail's immediate next step is an
          interactive control ONLY for the safe first edge draft -> started,
          which fires the same Start mutation as the button below. It is never
          interactive for started -> completed (destructive). Past, current, and
          the terminal step stay display-only. */}
      <StateStepper
        steps={[...STATE_STEPPER_PATHS.manufacturing_run.path]}
        current={d.status}
        offPath={
          isOffPath('manufacturing_run', d.status)
            ? {
                state: d.status,
                label: STATE_STEPPER_PATHS.manufacturing_run.resolveLabel(
                  d.status,
                ),
              }
            : undefined
        }
        onAdvance={canAdvanceRail ? advance : undefined}
        advancePending={start.isPending}
      />
      <PageHeader
        title={`Manufacturing run ${d.run_number ?? d.id.slice(0, 8)}`}
      />

      <DetailLayout
        rail={
          <section>
            <h2 className="mb-3 text-2xl font-display tracking-wide text-ink">
              HISTORY
            </h2>
            <AuditTimeline entityType="manufacturing_run" entityId={id ?? null} />
          </section>
        }
      >
        <div className="flex gap-2 flex-wrap">
          {isDraft && caps.can('manufacturing.run.start') && (
            <Button
              variant="secondary"
              onClick={() => start.mutate()}
              disabled={start.isPending}
            >
              Start
            </Button>
          )}
          {isStarted && caps.can('manufacturing.run.complete') && (
            <Button
              variant="secondary"
              onClick={onComplete}
              disabled={complete.isPending}
            >
              Complete
            </Button>
          )}
          {(isDraft || isStarted) && caps.can('manufacturing.run.cancel') && (
            <Button
              variant="ghost"
              onClick={onCancel}
              disabled={cancel.isPending}
            >
              Cancel run
            </Button>
          )}
          {isDraft && caps.can('manufacturing.run.delete') && (
            <Button
              variant="ghost"
              onClick={onDelete}
              disabled={remove.isPending}
            >
              Delete
            </Button>
          )}
        </div>
        {start.error ? (
          <p className="font-sans text-sm text-accent">
            {start.error instanceof Error ? start.error.message : 'Start failed.'}
          </p>
        ) : null}
        {complete.error ? (
          <p className="font-sans text-sm text-accent">
            {complete.error instanceof Error
              ? complete.error.message
              : 'Complete failed.'}
          </p>
        ) : null}
        {cancel.error ? (
          <p className="font-sans text-sm text-accent">
            {cancel.error instanceof Error
              ? cancel.error.message
              : 'Cancel failed.'}
          </p>
        ) : null}
        {remove.error ? (
          <p className="font-sans text-sm text-accent">
            {remove.error instanceof Error
              ? remove.error.message
              : 'Delete failed.'}
          </p>
        ) : null}

        <dl className="grid grid-cols-2 gap-4 font-sans text-sm">
          <dt className="text-ink-dim">Warehouse</dt>
          <dd className="text-ink">
            {d.warehouse_id ? (
              <EntityLabel kind="warehouse" id={d.warehouse_id} />
            ) : (
              'None'
            )}
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
          <h2 className="text-2xl font-display tracking-wider text-ink mb-3">
            CONSUMED MATERIALS
          </h2>
          {consumed.isLoading ? (
            <p className="text-ink-dim text-sm">Loading lines.</p>
          ) : consumed.error ? (
            <p className="text-accent text-sm">
              {consumed.error instanceof Error
                ? consumed.error.message
                : 'Failed to load lines.'}
            </p>
          ) : (
            <table className="w-full border border-line">
              <thead className="bg-bg-2 text-left text-sm font-display tracking-wider text-ink">
                <tr>
                  <th className="px-4 py-2">Item</th>
                  <th className="px-4 py-2 text-right">Qty</th>
                  <th className="px-4 py-2 text-right">Unit cost</th>
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
                      <td className="px-4 py-2 tabular-nums text-sm text-right">
                        {Number(l.quantity).toFixed(2)}
                      </td>
                      <td className="px-4 py-2 tabular-nums text-sm text-right">
                        {l.unit_cost_cents == null
                          ? ''
                          : formatCents(l.unit_cost_cents, 'USD')}
                      </td>
                      <td className="px-4 py-2 font-mono text-sm">
                        {l.uom ?? ''}
                      </td>
                      <td className="px-4 py-2 text-right">
                        {linesEditable &&
                          caps.can('manufacturing.run.line_item.delete') && (
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
              {removeConsumed.error instanceof Error
                ? removeConsumed.error.message
                : 'unknown error'}
            </p>
          ) : null}

          {linesEditable &&
            caps.can('manufacturing.run.line_item.create') && (
              <form
                onSubmit={onAddConsumed}
                className="flex flex-col gap-3 border border-line p-4 mt-4"
              >
                <h3 className="font-display tracking-wider text-ink">
                  ADD CONSUMED MATERIAL
                </h3>
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
                  <SupplySourceSelect
                    value={conSupplySource}
                    onChange={setConSupplySource}
                  />
                  <Button
                    type="submit"
                    disabled={!conItemId || addConsumed.isPending}
                  >
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
                    {addConsumed.error instanceof Error
                      ? addConsumed.error.message
                      : 'unknown error'}
                  </p>
                ) : null}
              </form>
            )}
        </section>

        {/* Produced outputs */}
        <section>
          <h2 className="text-2xl font-display tracking-wider text-ink mb-3">
            PRODUCED OUTPUTS
          </h2>
          {produced.isLoading ? (
            <p className="text-ink-dim text-sm">Loading lines.</p>
          ) : produced.error ? (
            <p className="text-accent text-sm">
              {produced.error instanceof Error
                ? produced.error.message
                : 'Failed to load lines.'}
            </p>
          ) : (
            <table className="w-full border border-line">
              <thead className="bg-bg-2 text-left text-sm font-display tracking-wider text-ink">
                <tr>
                  <th className="px-4 py-2">Item</th>
                  <th className="px-4 py-2 text-right">Qty</th>
                  <th className="px-4 py-2 text-right">Unit cost</th>
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
                      <td className="px-4 py-2 tabular-nums text-sm text-right">
                        {Number(l.quantity).toFixed(2)}
                      </td>
                      <td className="px-4 py-2 tabular-nums text-sm text-right">
                        {l.unit_cost_cents == null
                          ? ''
                          : formatCents(l.unit_cost_cents, 'USD')}
                      </td>
                      <td className="px-4 py-2 font-mono text-sm">
                        {l.uom ?? ''}
                      </td>
                      <td className="px-4 py-2 text-right">
                        {linesEditable &&
                          caps.can('manufacturing.run.line_item.delete') && (
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
              {removeProduced.error instanceof Error
                ? removeProduced.error.message
                : 'unknown error'}
            </p>
          ) : null}

          {linesEditable &&
            caps.can('manufacturing.run.line_item.create') && (
              <form
                onSubmit={onAddProduced}
                className="flex flex-col gap-3 border border-line p-4 mt-4"
              >
                <h3 className="font-display tracking-wider text-ink">
                  ADD PRODUCED OUTPUT
                </h3>
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
                    {addProduced.error instanceof Error
                      ? addProduced.error.message
                      : 'unknown error'}
                  </p>
                ) : null}
              </form>
            )}
        </section>
      </DetailLayout>
    </section>
  );
}
