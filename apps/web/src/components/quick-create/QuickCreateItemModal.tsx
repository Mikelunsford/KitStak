// QuickCreateItemModal. Minimal inline create for a catalog item, opened from
// the "+ New item" row on ItemPicker (F-UIUX-ENTITYPICKER-01).
//
// Scope is the required fields only (sku, name). Pricing, cost, tax, and the
// supply-source dimension stay on the full /catalog/items/new page; the
// supply-source control is added here in Phase 3 once items.supply_source
// lands. On save it POSTs through the existing createItem service
// (Idempotency-Key minted by apiClient, org from the JWT, one audit row
// server-side), then hands the created record back so the parent picker can
// auto-select it without the operator leaving the form.

import { useEffect, useState, type FormEvent } from 'react';

import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Select';
import { TextInput } from '@/components/ui/TextInput';
import { SUPPLY_SOURCE_OPTIONS } from '@/lib/supplySource';
import { useCreateItem } from '@/lib/hooks/useItems';
import type { Item, ItemSupplySource } from '@/lib/types/sales';

export interface QuickCreateItemModalProps {
  open: boolean;
  onClose: () => void;
  onCreated: (item: Item) => void;
  /** Optional seed for the name, e.g. the text already typed in the picker. */
  initialName?: string;
}

export function QuickCreateItemModal({
  open,
  onClose,
  onCreated,
  initialName = '',
}: QuickCreateItemModalProps): JSX.Element | null {
  const create = useCreateItem();
  const [sku, setSku] = useState('');
  const [name, setName] = useState(initialName);
  const [supplySource, setSupplySource] = useState<ItemSupplySource>('in_house');

  useEffect(() => {
    if (!open) return;
    setSku('');
    setName(initialName);
    setSupplySource('in_house');
    create.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialName]);

  if (!open) return null;

  const skuTrimmed = sku.trim();
  const nameTrimmed = name.trim();
  const valid = skuTrimmed !== '' && nameTrimmed !== '';
  const pending = create.isPending;
  const errorMessage = create.error instanceof Error ? create.error.message : null;

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    try {
      const item = await create.mutateAsync({
        sku: skuTrimmed,
        name: nameTrimmed,
        supply_source: supplySource,
      });
      onCreated(item);
    } catch {
      // Error surfaces via the inline banner below.
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New item"
      footer={
        <>
          <Button type="button" variant="ghost" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" form="quick-create-item-form" disabled={pending || !valid}>
            {pending ? 'Saving.' : 'Save item'}
          </Button>
        </>
      }
    >
      <form id="quick-create-item-form" onSubmit={onSubmit} className="flex flex-col gap-4">
        <TextInput
          label="SKU"
          name="sku"
          value={sku}
          onChange={(e) => setSku(e.target.value)}
          placeholder="WIDGET-001"
          required
          autoFocus
        />
        <TextInput
          label="Name"
          name="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Standard widget"
          required
        />
        <label className="flex flex-col gap-2">
          <span className="font-sans text-sm text-ink-dim tracking-wide uppercase">
            Supply source
          </span>
          <Select
            value={supplySource}
            onChange={(e) => setSupplySource(e.target.value as ItemSupplySource)}
          >
            {SUPPLY_SOURCE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </label>
        {errorMessage && (
          <p className="font-sans text-sm text-danger">{errorMessage}</p>
        )}
      </form>
    </Modal>
  );
}
