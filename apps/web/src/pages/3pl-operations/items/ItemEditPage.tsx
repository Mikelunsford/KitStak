import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import { PageHeader } from '@/components/ui/PageHeader';
import { DollarInput } from '@/components/forms/DollarInput';
import { useItem, useUpdateItem } from '@/lib/hooks/useItems';
import { ItemPatchSchema } from '@/lib/types/sales';
import type { Item } from '@/lib/types/sales';

export function ItemEditPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const query = useItem(id);
  const update = useUpdateItem(id ?? '');

  const [sku, setSku] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [unitPriceCents, setUnitPriceCents] = useState<number | null>(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (query.data) {
      setSku(query.data.sku);
      setName(query.data.name);
      setDescription(query.data.description ?? '');
      const raw = query.data.unit_price_cents;
      setUnitPriceCents(raw !== null && raw !== undefined ? Number(raw) : 0);
    }
  }, [query.data]);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const draft = {
      sku,
      name,
      description: description || null,
      unit_price_cents: String(unitPriceCents ?? 0),
    };
    const parsed = ItemPatchSchema.safeParse(draft);
    if (!parsed.success) {
      setError(parsed.error.issues.map((i) => i.message).join('; '));
      return;
    }
    // Zod has validated the shape; cast to the service Partial type.
    const patch: Partial<Item> = parsed.data as Partial<Item>;
    update.mutate(patch, {
      onSuccess: () => navigate(`/catalog/items/${id}`),
    });
  }

  if (query.isLoading) {
    return <p className="px-8 py-10 font-sans text-ink-dim">Loading.</p>;
  }
  if (!query.data) {
    return <p className="px-8 py-10 font-sans text-accent">Item not found.</p>;
  }

  return (
    <section className="px-8 py-10 max-w-2xl mx-auto flex flex-col gap-6">
      <PageHeader eyebrow="Library / Items" title="Edit item" />
      <form onSubmit={onSubmit} className="flex flex-col gap-4 font-sans">
        <label className="flex flex-col gap-1">
          <span className="text-sm text-ink-dim">SKU</span>
          <input
            type="text"
            value={sku}
            onChange={(e) => setSku(e.target.value)}
            required
            className="bg-bg-2 border border-line px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm text-ink-dim">Name</span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            className="bg-bg-2 border border-line px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm text-ink-dim">Description</span>
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="bg-bg-2 border border-line px-3 py-2"
          />
        </label>
        <DollarInput
          label="Unit price"
          value={unitPriceCents}
          onChange={setUnitPriceCents}
        />
        {error ? <p className="text-accent text-sm">{error}</p> : null}
        {update.error ? (
          <p className="text-accent text-sm">
            {update.error instanceof Error ? update.error.message : 'Failed to save.'}
          </p>
        ) : null}
        <button
          type="submit"
          disabled={update.isPending}
          className="self-start px-4 py-2 bg-accent text-on-primary font-display tracking-wider disabled:opacity-50"
        >
          {update.isPending ? 'SAVING.' : 'SAVE'}
        </button>
      </form>
    </section>
  );
}
