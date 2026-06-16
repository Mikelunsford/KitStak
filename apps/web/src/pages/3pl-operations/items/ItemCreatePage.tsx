import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';

import { Button } from '@/components/ui/Button';
import { PageHeader } from '@/components/ui/PageHeader';
import { TextInput } from '@/components/ui/TextInput';
import { DollarInput } from '@/components/forms/DollarInput';
import { useCreateItem } from '@/lib/hooks/useItems';

export function ItemCreatePage() {
  const navigate = useNavigate();
  const create = useCreateItem();
  const [sku, setSku] = useState('');
  const [name, setName] = useState('');
  // PR A2: state holds integer cents (DollarInput emits number | null).
  // Wire format is unchanged: the cents value goes out as a string to
  // match CentsSchema's z.union<int, string-of-digits>.
  const [unitPriceCents, setUnitPriceCents] = useState<number | null>(0);
  // R-W13-CAT-01 catalog deepening: unit of measure, distinct cost, reorder
  // point, and barcode/UPC. cost follows the same cents wire convention as
  // unit price (DollarInput emits integer cents, sent out as a digit string).
  const [unitOfMeasure, setUnitOfMeasure] = useState('');
  const [costCents, setCostCents] = useState<number | null>(null);
  const [reorderPoint, setReorderPoint] = useState('');
  const [barcode, setBarcode] = useState('');

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    // F-Wave7-MUTATION-ERRORS-SWEEP-01: switch from await mutateAsync to
    // mutate(input, { onSuccess }) so a 4xx surfaces in the inline error
    // renderer below instead of silently failing.
    const reorderTrimmed = reorderPoint.trim();
    create.mutate(
      {
        sku, name,
        unit_price_cents: String(unitPriceCents ?? 0),
        unit_of_measure: unitOfMeasure.trim() || null,
        cost_cents: costCents !== null ? String(costCents) : null,
        reorder_point: reorderTrimmed === '' ? null : Number(reorderTrimmed),
        barcode: barcode.trim() || null,
      },
      {
        onSuccess: (result) => {
          navigate(`/catalog/items/${result.id}`);
        },
      },
    );
  };

  return (
    <section className="px-8 py-12 max-w-xl mx-auto flex flex-col gap-6">
      <PageHeader eyebrow="Library / Items" title="New item" />
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <TextInput
          label="SKU"
          value={sku}
          onChange={(e) => setSku(e.target.value)}
          required
        />
        <TextInput
          label="Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
        <DollarInput
          label="Unit price"
          value={unitPriceCents}
          onChange={setUnitPriceCents}
        />
        <DollarInput
          label="Cost"
          value={costCents}
          onChange={setCostCents}
        />
        <TextInput
          label="Unit of measure"
          value={unitOfMeasure}
          onChange={(e) => setUnitOfMeasure(e.target.value)}
          placeholder="each, case, lb"
        />
        <TextInput
          label="Reorder point"
          value={reorderPoint}
          onChange={(e) => setReorderPoint(e.target.value)}
          inputMode="decimal"
        />
        <TextInput
          label="Barcode / UPC"
          value={barcode}
          onChange={(e) => setBarcode(e.target.value)}
        />
        <Button type="submit" disabled={create.isPending}>
          {create.isPending ? 'Saving.' : 'Create'}
        </Button>
        {create.error && (
          <p className="font-sans text-sm text-accent">
            {create.error instanceof Error ? create.error.message : 'Create item failed.'}
          </p>
        )}
      </form>
    </section>
  );
}
