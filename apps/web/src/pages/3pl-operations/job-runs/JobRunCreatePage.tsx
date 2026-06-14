// JobRunCreatePage (Wave 12 Phase A6). Creates a planned job run for a project.
// The warehouse is where posted daily logs move stock, so it is selectable here
// (posting only emits movements when the run has a warehouse). When a project is
// chosen, the server freezes that project's job-template snapshot onto the run.
// run_number (JR-) is allocated server-side. On success, route to the new run's
// detail page to add daily logs.

import { useMemo, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';

import { Button } from '@/components/ui/Button';
import { TextInput } from '@/components/ui/TextInput';
import { PageHeader } from '@/components/ui/PageHeader';
import { Select } from '@/components/ui/Select';
import { ProjectPicker } from '@/components/ui/pickers';
import { useCreateJobRun } from '@/lib/hooks/useJobRuns';
import { useWarehousesList } from '@/lib/hooks/useInventory';
import { useCapabilities } from '@/lib/hooks/useCapabilities';

export function JobRunCreatePage() {
  const navigate = useNavigate();
  const create = useCreateJobRun();
  const warehouses = useWarehousesList();
  const caps = useCapabilities();

  const [projectId, setProjectId] = useState<string | null>(null);
  const [warehouseId, setWarehouseId] = useState<string>('');
  const [notes, setNotes] = useState('');

  const warehouseOptions = useMemo(() => warehouses.data ?? [], [warehouses.data]);
  const canCreate = caps.can('threepl.job_run.create');

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!canCreate) return;
    create.mutate(
      {
        project_id: projectId,
        warehouse_id: warehouseId ? warehouseId : null,
        notes: notes.trim() ? notes.trim() : null,
      },
      {
        onSuccess: (run) => navigate(`/3pl-operations/job-runs/${run.id}`),
      },
    );
  };

  return (
    <section className="mx-auto flex max-w-2xl flex-col gap-6 px-8 py-12">
      <PageHeader eyebrow="3PL Operations" title="New job run" />

      {!canCreate ? (
        <p className="font-sans text-sm text-accent">
          You do not have permission to create job runs.
        </p>
      ) : null}

      <form
        onSubmit={onSubmit}
        className="flex flex-col gap-4 border border-line p-6"
      >
        <ProjectPicker
          value={projectId}
          onChange={setProjectId}
          label="Project (the work this run executes)"
        />
        <label className="flex flex-col gap-2">
          <span className="font-sans text-sm text-ink-dim tracking-wide uppercase">
            Warehouse (where posted logs move stock)
          </span>
          <Select
            value={warehouseId}
            onChange={(e) => setWarehouseId(e.target.value)}
            disabled={warehouses.isLoading}
          >
            <option value="">
              {warehouses.isLoading ? 'Loading.' : 'No warehouse (set before posting)'}
            </option>
            {warehouseOptions.map((w) => (
              <option key={w.id} value={w.id}>
                {w.code} · {w.display_name}
              </option>
            ))}
          </Select>
        </label>
        <TextInput
          label="Notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
        <div className="flex gap-3">
          <Button type="submit" disabled={!canCreate || create.isPending}>
            {create.isPending ? 'Creating.' : 'Create job run'}
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => navigate('/3pl-operations/job-runs')}
          >
            Cancel
          </Button>
        </div>
        {create.isError && (
          <p className="font-sans text-sm text-accent">
            {create.error instanceof Error
              ? create.error.message
              : 'Create job run failed.'}
          </p>
        )}
      </form>
    </section>
  );
}
