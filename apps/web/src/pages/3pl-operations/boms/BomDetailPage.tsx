// BomDetailPage. Migration to the shared UI kit (F-Wave10-UI-KIT-01, 3PL CRUD
// tail): PageHeader replaces the hand-rolled title and the component table
// becomes a DataTable (per-row Remove lives in an actions column). The add-
// component form keeps its shape with the raw select swapped for the kit
// Select. BOMs have no FSM or history, so this stays a single-column hub (no
// DetailLayout). The parent-item-keyed routing, the self-reference filter on
// the component options, the quantity validation, and the cap gate are
// preserved verbatim.

import { useMemo, useState, type FormEvent } from 'react';
import { useParams } from 'react-router-dom';

import { Breadcrumbs } from '@/components/shell/Breadcrumbs';
import { Button } from '@/components/ui/Button';
import { PageHeader } from '@/components/ui/PageHeader';
import { Select } from '@/components/ui/Select';
import { TextInput } from '@/components/ui/TextInput';
import { DataTable, type DataColumn } from '@/components/ui/DataTable';
import {
  useBomItemsList,
  useCreateBomItem,
  useDeleteBomItem,
} from '@/lib/hooks/useInventory';
import { useItemsList } from '@/lib/hooks/useItems';
import { useVioCapabilities } from '@/lib/hooks/useVioCapabilities';
import type { BomItem } from '@/lib/types/vendors_inventory_ops';

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

  const actionColumn: DataColumn<BomItem>[] = canWrite
    ? [
        {
          key: 'actions',
          header: '',
          align: 'right',
          render: (line) => (
            <Button
              variant="ghost"
              onClick={() => remove.mutate(line.id)}
              disabled={remove.isPending}
            >
              Remove
            </Button>
          ),
        },
      ]
    : [];

  const columns: ReadonlyArray<DataColumn<BomItem>> = [
    {
      key: 'component',
      header: 'Component',
      render: (line) =>
        itemLabel.get(line.component_item_id) ?? line.component_item_id,
    },
    {
      key: 'qty',
      header: 'Quantity per',
      align: 'right',
      cellClassName: 'tabular-nums',
      render: (line) => String(line.quantity_per),
    },
    {
      key: 'unit',
      header: 'Unit',
      cellClassName: 'text-ink-dim',
      render: (line) => line.unit_of_measure ?? '',
    },
    {
      key: 'notes',
      header: 'Notes',
      cellClassName: 'text-ink-dim',
      render: (line) => line.notes ?? '',
    },
    ...actionColumn,
  ];

  if (isLoading) return <p className="px-8 py-12 text-ink-dim">Loading.</p>;

  return (
    <section className="mx-auto flex max-w-4xl flex-col gap-6 px-8 py-12">
      <Breadcrumbs
        items={[
          { label: 'Bills of materials', to: '/catalog/boms' },
          { label: parentLabel },
        ]}
      />
      <PageHeader eyebrow="Catalog / Bills of materials" title={parentLabel} />

      <DataTable
        columns={columns}
        rows={lines ?? []}
        getRowKey={(line) => line.id}
        empty="No components yet."
      />

      {canWrite ? (
        <form
          onSubmit={onAddLine}
          className="flex flex-col gap-4 border border-line p-6 font-sans text-sm"
        >
          <h2 className="text-xl font-display tracking-wide text-ink">
            ADD COMPONENT
          </h2>
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
            <p className="text-accent">
              {create.error instanceof Error
                ? create.error.message
                : 'Failed to add component.'}
            </p>
          ) : null}
          <Button type="submit" disabled={create.isPending} className="self-start">
            {create.isPending ? 'Saving.' : 'Add component'}
          </Button>
        </form>
      ) : null}
    </section>
  );
}
