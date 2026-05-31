import { useMemo, useState, type FormEvent } from 'react';
import { useParams } from 'react-router-dom';

import { Breadcrumbs } from '@/components/shell/Breadcrumbs';
import { Button } from '@/components/ui/Button';
import { TextInput } from '@/components/ui/TextInput';
import {
  useBomItemsList,
  useCreateBomItem,
  useDeleteBomItem,
} from '@/lib/hooks/useInventory';
import { useItemsList } from '@/lib/hooks/useItems';
import { useVioCapabilities } from '@/lib/hooks/useVioCapabilities';

export function BomDetailPage() {
  const { id } = useParams<{ id: string }>();
  const parentItemId = id ?? '';
  const caps = useVioCapabilities();
  const canWrite = caps.can('stock.bom.write');

  const { data: lines, isLoading } = useBomItemsList(parentItemId);
  const { data: items } = useItemsList();
  const create = useCreateBomItem();
  const remove = useDeleteBomItem();

  const [componentItemId, setComponentItemId] = useState('');
  const [quantityPer, setQuantityPer] = useState('1');
  const [unitOfMeasure, setUnitOfMeasure] = useState('');
  const [notes, setNotes] = useState('');
  const [formError, setFormError] = useState('');

  const itemLabel = useMemo(() => {
    const map = new Map<string, string>();
    for (const item of items ?? []) {
      map.set(item.id, `${item.sku} · ${item.name}`);
    }
    return map;
  }, [items]);

  const parentLabel = itemLabel.get(parentItemId) ?? parentItemId;
  const options = (items ?? [])
    .filter((item) => item.id !== parentItemId)
    .map((item) => ({ id: item.id, label: `${item.sku} · ${item.name}` }));

  async function onAddLine(e: FormEvent) {
    e.preventDefault();
    const quantity = Number(quantityPer);
    if (!componentItemId) {
      setFormError('Select a component item.');
      return;
    }
    if (!Number.isFinite(quantity) || quantity <= 0) {
      setFormError('Quantity must be greater than zero.');
      return;
    }
    setFormError('');
    await create.mutateAsync({
      parent_item_id: parentItemId,
      component_item_id: componentItemId,
      quantity_per: quantity,
      unit_of_measure: unitOfMeasure ? unitOfMeasure : null,
      notes: notes ? notes : null,
    });
    setComponentItemId('');
    setQuantityPer('1');
    setUnitOfMeasure('');
    setNotes('');
  }

  if (isLoading) return <p className="px-8 py-12 text-ink-dim">Loading.</p>;

  return (
    <section className="px-8 py-12 max-w-4xl mx-auto flex flex-col gap-6">
      <Breadcrumbs
        items={[
          { label: 'Bills of materials', to: '/3pl-operations/boms' },
          { label: parentLabel },
        ]}
      />
      <h1 className="text-4xl font-display tracking-wide text-ink">{parentLabel}</h1>

      <table className="w-full border border-line text-sm font-sans">
        <thead className="bg-bg-2 text-left text-ink-dim">
          <tr>
            <th className="px-4 py-2">Component</th>
            <th className="px-4 py-2">Quantity per</th>
            <th className="px-4 py-2">Unit</th>
            <th className="px-4 py-2">Notes</th>
            {canWrite ? <th className="px-4 py-2" /> : null}
          </tr>
        </thead>
        <tbody>
          {(lines ?? []).length === 0 ? (
            <tr className="border-t border-line">
              <td className="px-4 py-2 text-ink-dim" colSpan={canWrite ? 5 : 4}>No components yet.</td>
            </tr>
          ) : (
            (lines ?? []).map((line) => (
              <tr key={line.id} className="border-t border-line">
                <td className="px-4 py-2 text-ink">{itemLabel.get(line.component_item_id) ?? line.component_item_id}</td>
                <td className="px-4 py-2 text-ink-dim">{line.quantity_per}</td>
                <td className="px-4 py-2 text-ink-dim">{line.unit_of_measure ?? ''}</td>
                <td className="px-4 py-2 text-ink-dim">{line.notes ?? ''}</td>
                {canWrite ? (
                  <td className="px-4 py-2">
                    <button
                      type="button"
                      onClick={() => remove.mutate(line.id)}
                      disabled={remove.isPending}
                      className="text-accent underline disabled:opacity-50"
                    >
                      Remove
                    </button>
                  </td>
                ) : null}
              </tr>
            ))
          )}
        </tbody>
      </table>

      {canWrite ? (
        <form onSubmit={onAddLine} className="flex flex-col gap-4 font-sans text-sm border border-line p-6">
          <h2 className="text-xl font-display tracking-wide text-ink">ADD COMPONENT</h2>
          <label className="flex flex-col gap-2">
            <span className="font-sans text-sm text-ink-dim tracking-wide uppercase">Component item</span>
            <select
              value={componentItemId}
              onChange={(e) => setComponentItemId(e.target.value)}
              className="bg-bg-2 border border-line text-ink px-4 py-3 font-sans focus:outline-none focus:border-accent"
            >
              <option value="">Select an item</option>
              {options.map((opt) => (
                <option key={opt.id} value={opt.id}>{opt.label}</option>
              ))}
            </select>
          </label>
          <TextInput
            label="Quantity per"
            type="number"
            step="0.0001"
            min="0"
            value={quantityPer}
            onChange={(e) => setQuantityPer(e.target.value)}
            required
          />
          <TextInput
            label="Unit of measure"
            value={unitOfMeasure}
            onChange={(e) => setUnitOfMeasure(e.target.value)}
            placeholder="ea"
          />
          <TextInput
            label="Notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
          {formError ? <p className="text-accent">{formError}</p> : null}
          {create.error ? (
            <p className="text-accent">{create.error instanceof Error ? create.error.message : 'Failed to add component.'}</p>
          ) : null}
          <Button type="submit" disabled={create.isPending} className="self-start">
            {create.isPending ? 'Saving.' : 'Add component'}
          </Button>
        </form>
      ) : null}
    </section>
  );
}
