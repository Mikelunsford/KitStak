import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import { PageHeader } from '@/components/ui/PageHeader';
import { DollarInput } from '@/components/forms/DollarInput';
import { useItem, useUpdateItem } from '@/lib/hooks/useItems';
import { SUPPLY_SOURCE_OPTIONS } from '@/lib/supplySource';
import { ItemPatchSchema } from '@/lib/types/sales';
import type { Item, ItemSupplySource } from '@/lib/types/sales';

export function ItemEditPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const query = useItem(id);
  const update = useUpdateItem(id ?? '');

  const [sku, setSku] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [unitPriceCents, setUnitPriceCents] = useState<number | null>(0);
  // R-W13-CAT-01 catalog deepening fields.
  const [unitOfMeasure, setUnitOfMeasure] = useState('');
  const [costCents, setCostCents] = useState<number | null>(null);
  const [reorderPoint, setReorderPoint] = useState('');
  const [barcode, setBarcode] = useState('');
  const [supplySource, setSupplySource] = useState<ItemSupplySource>('in_house');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (query.data) {
      setSku(query.data.sku);
      setName(query.data.name);
      setDescription(query.data.description ?? '');
      const raw = query.data.unit_price_cents;
      setUnitPriceCents(raw !== null && raw !== undefined ? Number(raw) : 0);
      setUnitOfMeasure(query.data.unit_of_measure ?? '');
      const rawCost = query.data.cost_cents;
      setCostCents(rawCost !== null && rawCost !== undefined ? Number(rawCost) : null);
      setReorderPoint(
        query.data.reorder_point !== null && query.data.reorder_point !== undefined
          ? String(query.data.reorder_point)
          : '',
      );
      setBarcode(query.data.barcode ?? '');
      setSupplySource(query.data.supply_source);
    }
  }, [query.data]);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const reorderTrimmed = reorderPoint.trim();
    const draft = {
      sku,
      name,
      description: description || null,
      unit_price_cents: String(unitPriceCents ?? 0),
      unit_of_measure: unitOfMeasure.trim() || null,
      cost_cents: costCents !== null ? String(costCents) : null,
      reorder_point: reorderTrimmed === '' ? null : Number(reorderTrimmed),
      barcode: barcode.trim() || null,
      supply_source: supplySource,
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
      <PageHeader eyebrow="Catalog / Items" title="Edit item" />
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
        <DollarInput
          label="Cost"
          value={costCents}
          onChange={setCostCents}
        />
        <label className="flex flex-col gap-1">
          <span className="text-sm text-ink-dim">Unit of measure</span>
          <input
            type="text"
            value={unitOfMeasure}
            onChange={(e) => setUnitOfMeasure(e.target.value)}
            placeholder="each, case, lb"
            className="bg-bg-2 border border-line px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm text-ink-dim">Reorder point</span>
          <input
            type="text"
            inputMode="decimal"
            value={reorderPoint}
            onChange={(e) => setReorderPoint(e.target.value)}
            className="bg-bg-2 border border-line px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm text-ink-dim">Barcode / UPC</span>
          <input
            type="text"
            value={barcode}
            onChange={(e) => setBarcode(e.target.value)}
            className="bg-bg-2 border border-line px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm text-ink-dim">Supply source</span>
          <select
            value={supplySource}
            onChange={(e) => setSupplySource(e.target.value as ItemSupplySource)}
            className="bg-bg-2 border border-line px-3 py-2"
          >
            {SUPPLY_SOURCE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
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
