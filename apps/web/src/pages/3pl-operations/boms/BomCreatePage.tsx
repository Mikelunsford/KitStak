// BomCreatePage. Migration to the shared UI kit (F-Wave10-UI-KIT-01, 3PL CRUD
// tail): PageHeader replaces the hand-rolled title and the two raw item selects
// become the kit Select. The Zod FormSchema (including the cross-field refine
// that rejects parent === component), the per-field error spans, the cap-gate
// early return, and the redirect to the new BOM's detail page are preserved.

import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { z } from 'zod';

import { Button } from '@/components/ui/Button';
import { PageHeader } from '@/components/ui/PageHeader';
import { Select } from '@/components/ui/Select';
import { TextInput } from '@/components/ui/TextInput';
import { useCreateBomItem } from '@/lib/hooks/useInventory';
import { useItemsList } from '@/lib/hooks/useItems';
import { useVioCapabilities } from '@/lib/hooks/useVioCapabilities';

const FormSchema = z
  .object({
    parent_item_id: z.string().uuid('Select a finished item'),
    component_item_id: z.string().uuid('Select a component item'),
    quantity_per: z.coerce.number().positive('Must be greater than zero'),
    unit_of_measure: z.string().optional(),
    notes: z.string().optional(),
  })
  .refine((v) => v.parent_item_id !== v.component_item_id, {
    path: ['component_item_id'],
    message: 'A component cannot be the finished item itself',
  });

type Errors = Partial<Record<keyof z.infer<typeof FormSchema>, string>>;

export function BomCreatePage() {
  const navigate = useNavigate();
  const caps = useVioCapabilities();
  const create = useCreateBomItem();
  const { data: items } = useItemsList();

  const [parentItemId, setParentItemId] = useState('');
  const [componentItemId, setComponentItemId] = useState('');
  const [quantityPer, setQuantityPer] = useState('1');
  const [unitOfMeasure, setUnitOfMeasure] = useState('');
  const [notes, setNotes] = useState('');
  const [errors, setErrors] = useState<Errors>({});

  if (!caps.can('stock.bom.write')) {
    return (
      <section className="mx-auto flex max-w-3xl flex-col gap-6 px-8 py-12">
        <p className="text-ink">Forbidden.</p>
      </section>
    );
  }

  const options = (items ?? []).map((item) => ({
    id: item.id,
    label: `${item.sku} · ${item.name}`,
  }));

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const parsed = FormSchema.safeParse({
      parent_item_id: parentItemId,
      component_item_id: componentItemId,
      quantity_per: quantityPer,
      unit_of_measure: unitOfMeasure,
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
    await create.mutateAsync({
      parent_item_id: parsed.data.parent_item_id,
      component_item_id: parsed.data.component_item_id,
      quantity_per: parsed.data.quantity_per,
      unit_of_measure: parsed.data.unit_of_measure
        ? parsed.data.unit_of_measure
        : null,
      notes: parsed.data.notes ? parsed.data.notes : null,
    });
    navigate(`/catalog/boms/${parsed.data.parent_item_id}`);
  }

  return (
    <section className="mx-auto flex max-w-3xl flex-col gap-6 px-8 py-12">
      <PageHeader eyebrow="Catalog / Bills of materials" title="New BOM" />
      <p className="font-sans text-sm text-ink-dim">
        Pick the finished item, then add its first component. You can add more
        components from the BOM detail page.
      </p>
      <form onSubmit={onSubmit} className="flex flex-col gap-4 font-sans text-sm">
        <label className="flex flex-col gap-2">
          <span className="font-sans text-sm text-ink-dim tracking-wide uppercase">
            Finished item
          </span>
          <Select
            value={parentItemId}
            onChange={(e) => setParentItemId(e.target.value)}
          >
            <option value="">Select an item</option>
            {options.map((opt) => (
              <option key={opt.id} value={opt.id}>
                {opt.label}
              </option>
            ))}
          </Select>
          {errors.parent_item_id ? (
            <span className="font-sans text-sm text-danger">
              {errors.parent_item_id}
            </span>
          ) : null}
        </label>

        <label className="flex flex-col gap-2">
          <span className="font-sans text-sm text-ink-dim tracking-wide uppercase">
            Component item
          </span>
          <Select
            value={componentItemId}
            onChange={(e) => setComponentItemId(e.target.value)}
          >
            <option value="">Select an item</option>
            {options.map((opt) => (
              <option key={opt.id} value={opt.id}>
                {opt.label}
              </option>
            ))}
          </Select>
          {errors.component_item_id ? (
            <span className="font-sans text-sm text-danger">
              {errors.component_item_id}
            </span>
          ) : null}
        </label>

        <TextInput
          label="Quantity per"
          type="number"
          step="0.0001"
          min="0"
          value={quantityPer}
          onChange={(e) => setQuantityPer(e.target.value)}
          required
          {...(errors.quantity_per ? { error: errors.quantity_per } : {})}
        />
        <TextInput
          label="Unit of measure"
          value={unitOfMeasure}
          onChange={(e) => setUnitOfMeasure(e.target.value)}
          {...(errors.unit_of_measure ? { error: errors.unit_of_measure } : {})}
          placeholder="ea"
        />
        <TextInput
          label="Notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          {...(errors.notes ? { error: errors.notes } : {})}
        />

        {create.error ? (
          <p className="text-accent">
            {create.error instanceof Error
              ? create.error.message
              : 'Failed to create BOM.'}
          </p>
        ) : null}

        <Button type="submit" disabled={create.isPending} className="self-start">
          {create.isPending ? 'Saving.' : 'Create'}
        </Button>
      </form>
    </section>
  );
}
