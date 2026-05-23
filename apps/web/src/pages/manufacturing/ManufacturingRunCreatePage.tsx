import { useMemo, useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

import { Button } from '@/components/ui/Button';
import { TextInput } from '@/components/ui/TextInput';
import { ProjectPicker } from '@/components/ui/pickers';
import { useCreateManufacturingRun } from '@/lib/hooks/useManufacturing';
import { useWarehousesList } from '@/lib/hooks/useInventory';
import { useVioCapabilities } from '@/lib/hooks/useVioCapabilities';
import { parseProjectIdParam } from '@/lib/urlParams';
import type { ManufacturingRunCreate } from '@/lib/types/vendors_inventory_ops';

/**
 * ManufacturingRunCreatePage. Path A5. Mirrors ReceivingOrderCreatePage
 * shape. All form fields optional: warehouse_id NULLABLE for admin-only
 * runs, run_number auto-assigned by the manufacturing-api handler via
 * next_doc_number when left blank (F-Wave9-MFG-RUN-NUMBERING-01).
 *
 * datetime-local inputs return a "YYYY-MM-DDTHH:mm" string with no timezone
 * suffix. We coerce to ISO via new Date(value).toISOString() before posting
 * so the Iso zod schema on the wire accepts it.
 *
 * F-Wave9-AUDIT-V3-WAVE-C3-01: accepts `?project_id=` deep-link prefill.
 * The picker pre-selects the project when the URL carries a canonical
 * UUID; malformed values fall back to null via parseProjectIdParam so
 * an operator pasting a bad URL does not poison the picker or generate
 * a 422 on submit. The server side (C2, PR #133) already accepts
 * project_id on ManufacturingRunCreate.
 */
function localToIso(value: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

export function ManufacturingRunCreatePage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const create = useCreateManufacturingRun();
  const warehouses = useWarehousesList();
  const caps = useVioCapabilities();

  const prefilledProjectId = parseProjectIdParam(searchParams.get('project_id'));

  const [runNumber, setRunNumber] = useState('');
  const [warehouseId, setWarehouseId] = useState<string>('');
  const [projectId, setProjectId] = useState<string | null>(prefilledProjectId);
  const [plannedStart, setPlannedStart] = useState('');
  const [plannedComplete, setPlannedComplete] = useState('');
  const [notes, setNotes] = useState('');

  const warehouseOptions = useMemo(() => warehouses.data ?? [], [warehouses.data]);

  const canCreate = caps.can('manufacturing.run.create');

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!canCreate) return;

    const body: ManufacturingRunCreate = {};
    if (runNumber.trim()) body.run_number = runNumber.trim();
    if (warehouseId) body.warehouse_id = warehouseId;
    if (projectId) body.project_id = projectId;
    const startIso = localToIso(plannedStart);
    if (startIso) body.planned_start_at = startIso;
    const completeIso = localToIso(plannedComplete);
    if (completeIso) body.planned_complete_at = completeIso;
    if (notes.trim()) body.notes = notes.trim();

    create.mutate(body, {
      onSuccess: (run) => {
        navigate(`/manufacturing/runs/${run.id}`);
      },
    });
  }

  return (
    <section className="px-8 py-12 max-w-2xl mx-auto flex flex-col gap-6">
      <h1 className="text-4xl font-display tracking-wide text-ink">NEW MANUFACTURING RUN</h1>
      {!canCreate ? (
        <p className="text-accent font-sans text-sm">
          You do not have permission to create manufacturing runs.
        </p>
      ) : null}
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <TextInput
          label="Run number (auto-assigned if blank, e.g. MFG-2026-00001)"
          value={runNumber}
          onChange={(e) => setRunNumber(e.target.value)}
        />
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
              {warehouses.isLoading ? 'Loading.' : 'No warehouse (admin-only run)'}
            </option>
            {warehouseOptions.map((w) => (
              <option key={w.id} value={w.id}>
                {w.code} · {w.display_name}
              </option>
            ))}
          </select>
        </label>
        <ProjectPicker
          value={projectId}
          onChange={setProjectId}
          label="Project (optional)"
        />
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
            onClick={() => navigate('/manufacturing/runs')}
          >
            Cancel
          </Button>
        </div>
      </form>
    </section>
  );
}
