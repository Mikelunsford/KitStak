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

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    // F-Wave7-MUTATION-ERRORS-SWEEP-01: switch from await mutateAsync to
    // mutate(input, { onSuccess }) so a 4xx surfaces in the inline error
    // renderer below instead of silently failing.
    create.mutate(
      {
        sku, name,
        unit_price_cents: String(unitPriceCents ?? 0),
      },
      {
        onSuccess: (result) => {
          navigate(`/3pl-operations/items/${result.id}`);
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
