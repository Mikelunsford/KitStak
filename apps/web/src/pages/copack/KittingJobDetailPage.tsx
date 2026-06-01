import { useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import { AuditTimeline } from '@/components/shell/AuditTimeline';
import { Breadcrumbs } from '@/components/shell/Breadcrumbs';
import { EntityLabel } from '@/components/data/EntityLabel';
import { Button } from '@/components/ui/Button';
import { TextInput } from '@/components/ui/TextInput';
import { ItemPicker } from '@/components/ui/pickers';
import {
  useKittingJob,
  useStartKittingJob,
  useCompleteKittingJob,
  useCancelKittingJob,
  useDeleteKittingJob,
  useKittingConsumedLines,
  useAddKittingConsumedLine,
  useDeleteKittingConsumedLine,
  useKittingProducedLines,
  useAddKittingProducedLine,
  useDeleteKittingProducedLine,
} from '@/lib/hooks/useCoPack';
import { useVioCapabilities } from '@/lib/hooks/useVioCapabilities';
import { formatCents } from '@/lib/money';
import { destructiveConfirm } from '@/lib/destructiveConfirm';
import { defaultStateLabel } from '@/components/shell/auditStateFormatters';
import { formatDateTimeMedium } from '@/lib/dates';

/**
 * KittingJobDetailPage. Pillar 3. Mirrors ManufacturingRunDetailPage.
 *
 * State machine: draft -> started -> completed; draft|started -> cancelled.
 * Lines are editable while the job is draft or started. Consumed lines require
 * an item; produced lines may leave the item null (a kit assembled without a
 * pre-registered SKU). Status renders as a simple inline pill (no StateStepper:
 * the copack FSMs are not registered in STATE_STEPPER_PATHS).
 */
export function KittingJobDetailPage() {
  const { id } = useParams<{ id: string }>();
  const jobId = id ?? '';
  const navigate = useNavigate();

  const job = useKittingJob(id);
  const start = useStartKittingJob(jobId);
  const complete = useCompleteKittingJob(jobId);
  const cancel = useCancelKittingJob(jobId);
  const remove = useDeleteKittingJob(jobId);

  const consumed = useKittingConsumedLines(id);
  const addConsumed = useAddKittingConsumedLine(jobId);
  const removeConsumed = useDeleteKittingConsumedLine(jobId);

  const produced = useKittingProducedLines(id);
  const addProduced = useAddKittingProducedLine(jobId);
  const removeProduced = useDeleteKittingProducedLine(jobId);

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

  if (job.isLoading) return <p className="px-8 py-12 text-ink-dim">Loading.</p>;
  if (job.error || !job.data) {
    return <p className="px-8 py-12 text-accent">Kitting job not found.</p>;
  }
  const d = job.data;

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

  function onRemoveConsumed(lineId: string) {
    if (!destructiveConfirm({
      action: 'Remove this consumed component',
      consequence: 'The component line will be deleted from the job.',
    })) return;
    removeConsumed.mutate(lineId);
  }

  function onRemoveProduced(lineId: string) {
    if (!destructiveConfirm({
      action: 'Remove this produced kit',
      consequence: 'The kit line will be deleted from the job.',
    })) return;
    removeProduced.mutate(lineId);
  }

  function onComplete() {
    if (!destructiveConfirm({
      action: 'Complete this kitting job',
      consequence: 'The job moves to completed and its lines are locked.',
      irreversible: true,
    })) return;
    complete.mutate();
  }

  function onCancel() {
    if (!destructiveConfirm({
      action: 'Cancel this kitting job',
      consequence: 'The job will move to cancelled and stop appearing in active job lists.',
    })) return;
    cancel.mutate();
  }

  function onDelete() {
    if (!destructiveConfirm({
      action: 'Delete this draft kitting job',
      consequence: 'The draft will be removed permanently.',
      irreversible: true,
    })) return;
    remove.mutate(undefined, {
      onSuccess: () => navigate('/copack/kitting'),
    });
  }

  return (
    <section className="px-8 py-12 max-w-4xl mx-auto flex flex-col gap-6">
      <Breadcrumbs
        items={[
          { label: 'Co-Pack', to: '/copack/orders' },
          { label: 'Kitting', to: '/copack/kitting' },
          { label: d.job_number ?? d.id.slice(0, 8) },
        ]}
      />
      <header className="flex items-center justify-between">
        <h1 className="text-4xl font-display tracking-wide text-ink">
          KITTING JOB {d.job_number ?? d.id.slice(0, 8)}
        </h1>
        <span className="inline-block px-3 py-1 border border-line text-xs font-mono uppercase text-ink-dim">
          {defaultStateLabel(d.status)}
        </span>
      </header>

      <div className="flex gap-2 flex-wrap">
        {isDraft && caps.can('copack.kitting_job.start') && (
          <button
            onClick={() => start.mutate()}
            disabled={start.isPending}
            className="px-3 py-1 border border-line font-sans text-xs uppercase text-ink hover:bg-bg-2"
          >
            Start
          </button>
        )}
        {isStarted && caps.can('copack.kitting_job.complete') && (
          <button
            onClick={onComplete}
            disabled={complete.isPending}
            className="px-3 py-1 border border-line font-sans text-xs uppercase text-ink hover:bg-bg-2"
          >
            Complete
          </button>
        )}
        {(isDraft || isStarted) && caps.can('copack.kitting_job.cancel') && (
          <button
            onClick={onCancel}
            disabled={cancel.isPending}
            className="px-3 py-1 border border-line font-sans text-xs uppercase text-ink hover:bg-bg-2"
          >
            Cancel job
          </button>
        )}
        {isDraft && caps.can('copack.kitting_job.delete') && (
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
        <dt className="text-ink-dim">Sales order</dt>
        <dd className="text-ink">
          {d.sales_order_id ? (
            <EntityLabel kind="sales_order" id={d.sales_order_id} />
          ) : 'None'}
        </dd>
        <dt className="text-ink-dim">Warehouse</dt>
        <dd className="text-ink">
          {d.warehouse_id ? <EntityLabel kind="copack_warehouse" id={d.warehouse_id} /> : 'None'}
        </dd>
        <dt className="text-ink-dim">Planned start</dt>
        <dd className="text-ink">{formatDateTimeMedium(d.planned_start_at)}</dd>
        <dt className="text-ink-dim">Planned complete</dt>
        <dd className="text-ink">{formatDateTimeMedium(d.planned_complete_at)}</dd>
        <dt className="text-ink-dim">Started</dt>
        <dd className="text-ink">{formatDateTimeMedium(d.started_at)}</dd>
        <dt className="text-ink-dim">Completed</dt>
        <dd className="text-ink">{formatDateTimeMedium(d.completed_at)}</dd>
        <dt className="text-ink-dim">Cancelled</dt>
        <dd className="text-ink">{formatDateTimeMedium(d.cancelled_at)}</dd>
        <dt className="text-ink-dim">Notes</dt>
        <dd className="text-ink whitespace-pre-wrap">{d.notes ?? ''}</dd>
      </dl>

      {/* Consumed components */}
      <section>
        <div className="flex items-baseline gap-3 mb-3">
          <h2 className="text-2xl font-display tracking-wider text-ink">CONSUMED COMPONENTS</h2>
          {consumed.isFetching && !consumed.isLoading ? (
            <span className="text-xs text-ink-dim font-sans" aria-live="polite">Updating.</span>
          ) : null}
        </div>
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
                    No consumed components yet.
                  </td>
                </tr>
              ) : (
                (consumed.data ?? []).map((l) => (
                  <tr key={l.id} className="border-t border-line">
                    <td className="px-4 py-2">
                      <EntityLabel kind="item" id={l.item_id} />
                    </td>
                    <td className="px-4 py-2 font-mono text-sm">{Number(l.quantity).toFixed(2)}</td>
                    <td className="px-4 py-2 font-mono text-sm">
                      {l.unit_cost_cents == null ? '' : formatCents(l.unit_cost_cents, 'USD')}
                    </td>
                    <td className="px-4 py-2 font-mono text-sm">{l.uom ?? ''}</td>
                    <td className="px-4 py-2">
                      {linesEditable && caps.can('copack.kitting_job.line_item.delete') && (
                        <Button
                          variant="ghost"
                          onClick={() => onRemoveConsumed(l.id)}
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

        {linesEditable && caps.can('copack.kitting_job.line_item.create') && (
          <form onSubmit={onAddConsumed} className="flex flex-col gap-3 border border-line p-4 mt-4">
            <h3 className="font-display tracking-wider text-ink">ADD CONSUMED COMPONENT</h3>
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
                {addConsumed.isPending ? 'Adding.' : 'Add component'}
              </Button>
            </div>
            {addConsumed.error ? (
              <p className="text-accent font-sans text-sm">
                Add failed:{' '}
                {addConsumed.error instanceof Error ? addConsumed.error.message : 'unknown error'}
              </p>
            ) : null}
          </form>
        )}
      </section>

      {/* Produced kits */}
      <section>
        <div className="flex items-baseline gap-3 mb-3">
          <h2 className="text-2xl font-display tracking-wider text-ink">PRODUCED KITS</h2>
          {produced.isFetching && !produced.isLoading ? (
            <span className="text-xs text-ink-dim font-sans" aria-live="polite">Updating.</span>
          ) : null}
        </div>
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
                    No produced kits yet.
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
                    <td className="px-4 py-2 font-mono text-sm">{Number(l.quantity).toFixed(2)}</td>
                    <td className="px-4 py-2 font-mono text-sm">
                      {l.unit_cost_cents == null ? '' : formatCents(l.unit_cost_cents, 'USD')}
                    </td>
                    <td className="px-4 py-2 font-mono text-sm">{l.uom ?? ''}</td>
                    <td className="px-4 py-2">
                      {linesEditable && caps.can('copack.kitting_job.line_item.delete') && (
                        <Button
                          variant="ghost"
                          onClick={() => onRemoveProduced(l.id)}
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

        {linesEditable && caps.can('copack.kitting_job.line_item.create') && (
          <form onSubmit={onAddProduced} className="flex flex-col gap-3 border border-line p-4 mt-4">
            <h3 className="font-display tracking-wider text-ink">ADD PRODUCED KIT</h3>
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
                {addProduced.isPending ? 'Adding.' : 'Add kit'}
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
        <AuditTimeline entityType="kitting_job" entityId={id ?? null} />
      </section>
    </section>
  );
}
