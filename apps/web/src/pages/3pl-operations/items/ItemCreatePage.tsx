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

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const result = await create.mutateAsync({
      sku, name,
      unit_price_cents: unitPrice,
    });
    navigate(`/3pl-operations/items/${result.id}`);
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
      </form>
    </section>
  );
}
