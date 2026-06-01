import { useMemo, useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

import { Button } from '@/components/ui/Button';
import { TextInput } from '@/components/ui/TextInput';
import { useCreateKittingJob, useSalesOrdersList, useCoPackWarehousesList } from '@/lib/hooks/useCoPack';
import { useVioCapabilities } from '@/lib/hooks/useVioCapabilities';
import type { KittingJobCreate } from '@/lib/types/copack';

/**
 * KittingJobCreatePage. Pillar 3. Mirrors ManufacturingRunCreatePage.
 *
 * All fields optional: job_number auto-assigned by the copack-api handler via
 * next_doc_number when left blank (KIT- prefix). The job opens in draft;
 * consumed and produced lines are added on the detail page. datetime-local is
 * coerced to ISO before posting so the Iso zod schema accepts it. A ?sales_order_id=
 * deep-link pre-selects the linked order.
 */
function localToIso(value: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

export function KittingJobCreatePage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const create = useCreateKittingJob();
  const warehouses = useCoPackWarehousesList();
  const orders = useSalesOrdersList();
  const caps = useVioCapabilities();

  const [jobNumber, setJobNumber] = useState('');
  const [salesOrderId, setSalesOrderId] = useState<string>(
    () => searchParams.get('sales_order_id') ?? '',
  );
  const [warehouseId, setWarehouseId] = useState<string>('');
  const [plannedStart, setPlannedStart] = useState('');
  const [plannedComplete, setPlannedComplete] = useState('');
  const [notes, setNotes] = useState('');

  const orderOptions = useMemo(() => orders.data ?? [], [orders.data]);

  const canCreate = caps.can('copack.kitting_job.create');

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!canCreate) return;

    const body: KittingJobCreate = {};
    if (jobNumber.trim()) body.job_number = jobNumber.trim();
    if (salesOrderId) body.sales_order_id = salesOrderId;
    if (warehouseId) body.warehouse_id = warehouseId;
    const startIso = localToIso(plannedStart);
    if (startIso) body.planned_start_at = startIso;
    const completeIso = localToIso(plannedComplete);
    if (completeIso) body.planned_complete_at = completeIso;
    if (notes.trim()) body.notes = notes.trim();

    create.mutate(body, {
      onSuccess: (job) => {
        navigate(`/copack/kitting/${job.id}`);
      },
    });
  }

  return (
    <section className="px-8 py-12 max-w-2xl mx-auto flex flex-col gap-6">
      <h1 className="text-4xl font-display tracking-wide text-ink">NEW KITTING JOB</h1>
      {!canCreate ? (
        <p className="text-accent font-sans text-sm">
          You do not have permission to create kitting jobs.
        </p>
      ) : null}
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <TextInput
          label="Job number (auto-assigned if blank, e.g. KIT-2026-00001)"
          value={jobNumber}
          onChange={(e) => setJobNumber(e.target.value)}
        />
        <label className="flex flex-col gap-2">
          <span className="font-sans text-sm text-ink-dim tracking-wide uppercase">
            Sales order (optional)
          </span>
          <select
            value={salesOrderId}
            onChange={(e) => setSalesOrderId(e.target.value)}
            disabled={orders.isLoading}
            className="bg-bg-2 border border-line text-ink px-4 py-3 font-sans focus:outline-none focus:border-accent disabled:opacity-50"
          >
            <option value="">
              {orders.isLoading ? 'Loading.' : 'No sales order'}
            </option>
            {orderOptions.map((o) => (
              <option key={o.id} value={o.id}>
                {o.order_number ?? o.id.slice(0, 8)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-2">
          <span className="font-sans text-sm text-ink-dim tracking-wide uppercase">
            Warehouse (optional)
          </span>
          <select
            value={warehouseId}
            onChange={(e) => setWarehouseId(e.target.value)}
            disabled={warehouses.isLoading}
            className="bg-bg-2 border border-line text-ink px-4 py-3 font-sans focus:outline-none focus:border-accent disabled:opacity-50"
          >
            <option value="">
              {warehouses.isLoading ? 'Loading.' : 'No warehouse'}
            </option>
            {(warehouses.data ?? []).map((w) => (
              <option key={w.id} value={w.id}>
                {w.code} · {w.display_name}
              </option>
            ))}
          </select>
        </label>
        <TextInput
          label="Planned start"
          type="datetime-local"
          value={plannedStart}
          onChange={(e) => setPlannedStart(e.target.value)}
        />
        <TextInput
          label="Planned complete"
          type="datetime-local"
          value={plannedComplete}
          onChange={(e) => setPlannedComplete(e.target.value)}
        />
        <label className="flex flex-col gap-2">
          <span className="font-sans text-sm text-ink-dim tracking-wide uppercase">
            Notes (optional)
          </span>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            className="bg-bg-2 border border-line text-ink px-4 py-3 font-sans focus:outline-none focus:border-accent"
          />
        </label>

        {create.error ? (
          <p className="text-accent font-sans text-sm">
            {create.error instanceof Error ? create.error.message : 'Create failed.'}
          </p>
        ) : null}

        <div className="flex gap-2">
          <Button type="submit" disabled={!canCreate || create.isPending}>
            {create.isPending ? 'Saving.' : 'Create draft'}
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => navigate('/copack/kitting')}
          >
            Cancel
          </Button>
        </div>
      </form>
    </section>
  );
}
