import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';

import { Button } from '@/components/ui/Button';
import { TextInput } from '@/components/ui/TextInput';
import { useCreateItem } from '@/lib/hooks/useItems';

export function ItemCreatePage() {
  const navigate = useNavigate();
  const create = useCreateItem();
  const [sku, setSku] = useState('');
  const [name, setName] = useState('');
  const [unitPrice, setUnitPrice] = useState('0');

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    // F-Wave7-MUTATION-ERRORS-SWEEP-01: switch from await mutateAsync to
    // mutate(input, { onSuccess }) so a 4xx surfaces in the inline error
    // renderer below instead of silently failing.
    create.mutate(
      {
        sku, name,
        unit_price_cents: unitPrice,
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
      <h1 className="text-4xl font-display tracking-wide text-ink">NEW ITEM</h1>
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
        <TextInput
          label="Unit price (cents)"
          value={unitPrice}
          onChange={(e) => setUnitPrice(e.target.value)}
          inputMode="numeric"
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
