import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { z } from 'zod';

import { Button } from '@/components/ui/Button';
import { TextInput } from '@/components/ui/TextInput';
import { useCreateProductionRun } from '@/lib/hooks/useOps';
import { useVioCapabilities } from '@/lib/hooks/useVioCapabilities';

const FormSchema = z.object({
  run_number: z.string().optional(),
  warehouse_id: z.string().uuid('Must be a UUID'),
  output_item_id: z.string().uuid('Must be a UUID'),
  quantity_planned: z.string().min(1, 'Required').regex(/^\d+(\.\d+)?$/, 'Must be a number'),
  scheduled_for: z.string().optional(),
  notes: z.string().optional(),
});

type Errors = Partial<Record<keyof z.infer<typeof FormSchema>, string>>;

export function ProductionRunCreatePage() {
  const navigate = useNavigate();
  const caps = useVioCapabilities();
  const create = useCreateProductionRun();

  const [runNumber, setRunNumber] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [outputItemId, setOutputItemId] = useState('');
  const [quantityPlanned, setQuantityPlanned] = useState('');
  const [scheduledFor, setScheduledFor] = useState('');
  const [notes, setNotes] = useState('');
  const [errors, setErrors] = useState<Errors>({});

  if (!caps.can('production.run.create')) {
    return (
      <section className="px-8 py-12 max-w-3xl mx-auto flex flex-col gap-6">
        <p className="text-ink">Forbidden.</p>
      </section>
    );
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const parsed = FormSchema.safeParse({
      run_number: runNumber,
      warehouse_id: warehouseId,
      output_item_id: outputItemId,
      quantity_planned: quantityPlanned,
      scheduled_for: scheduledFor,
      notes,
    });
    if (!parsed.success) {
      const fieldErrors: Errors = {};
      for (const issue of parsed.error.issues) {
        fieldErrors[issue.path[0] as keyof Errors] = issue.message;
      }
      setErrors(fieldErrors);
      return;
    }
    setErrors({});
    const created = await create.mutateAsync({
      run_number: parsed.data.run_number ? parsed.data.run_number : null,
      warehouse_id: parsed.data.warehouse_id,
      output_item_id: parsed.data.output_item_id,
      quantity_planned: parsed.data.quantity_planned,
      scheduled_for: parsed.data.scheduled_for ? parsed.data.scheduled_for : null,
      notes: parsed.data.notes ? parsed.data.notes : null,
    });
    navigate(`/3pl-operations/production/${created.id}`);
  }

  return (
    <section className="px-8 py-12 max-w-3xl mx-auto flex flex-col gap-6">
      <h1 className="text-4xl font-display tracking-wide text-ink">NEW PRODUCTION RUN</h1>
      <form onSubmit={onSubmit} className="flex flex-col gap-4 font-sans text-sm">
        <TextInput
          label="Run number"
          value={runNumber}
          onChange={(e) => setRunNumber(e.target.value)}
          {...(errors.run_number ? { error: errors.run_number } : {})}
          placeholder="RUN-0001"
        />
        <TextInput
          label="Warehouse id"
          value={warehouseId}
          onChange={(e) => setWarehouseId(e.target.value)}
          required
          {...(errors.warehouse_id ? { error: errors.warehouse_id } : {})}
          placeholder="UUID"
        />
        <TextInput
          label="Output item id"
          value={outputItemId}
          onChange={(e) => setOutputItemId(e.target.value)}
          required
          {...(errors.output_item_id ? { error: errors.output_item_id } : {})}
          placeholder="UUID"
        />
        <TextInput
          label="Quantity planned"
          value={quantityPlanned}
          onChange={(e) => setQuantityPlanned(e.target.value)}
          required
          {...(errors.quantity_planned ? { error: errors.quantity_planned } : {})}
          placeholder="100"
          inputMode="decimal"
        />
        <TextInput
          label="Scheduled for"
          value={scheduledFor}
          onChange={(e) => setScheduledFor(e.target.value)}
          {...(errors.scheduled_for ? { error: errors.scheduled_for } : {})}
          placeholder="YYYY-MM-DD"
        />
        <TextInput
          label="Notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          {...(errors.notes ? { error: errors.notes } : {})}
        />

        {create.error ? (
          <p className="text-accent">{create.error instanceof Error ? create.error.message : 'Failed to create production run.'}</p>
        ) : null}

        <Button type="submit" disabled={create.isPending} className="self-start">
          {create.isPending ? 'Saving.' : 'Create'}
        </Button>
      </form>
    </section>
  );
}
