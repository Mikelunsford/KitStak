import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import { EntityPicker } from '@/components/ui/EntityPicker';
import { QuickCreateItemModal } from '@/components/quick-create/QuickCreateItemModal';
import { useCapabilities } from '@/lib/hooks/useCapabilities';
import { itemsKeys } from '@/lib/queryKeys/items';
import { listItems } from '@/lib/services/itemsService';
import { SUPPLY_SOURCE_LABEL } from '@/lib/supplySource';
import type { Item, ItemKind, ItemSupplySource } from '@/lib/types/sales';

/**
 * ItemPicker. Typeahead combobox over the items catalog (sales-config-api),
 * with an inline "+ New item" row gated on the items.item.write capability
 * (F-UIUX-ENTITYPICKER-01). Caller may narrow by kind ('good' = product or kit;
 * 'service' = service) or by active.
 *
 * `onChange` emits the matched Item (or undefined on clear) as a second argument
 * so callers can synchronously pre-fill dependent form fields without a separate
 * useItem(id) query. On inline create the new item is auto-selected and merged
 * into the list ahead of the refetch. Public props are unchanged from the prior
 * native-select version, so call sites need no edits.
 */
export interface ItemPickerProps {
  value: string | null;
  onChange: (id: string | null, item?: Item) => void;
  label?: string;
  required?: boolean;
  disabled?: boolean;
  placeholder?: string;
  filter?:
    | { kind?: 'good' | 'service'; active?: boolean; supply_source?: ItemSupplySource }
    | undefined;
}

const GOOD_KINDS: ItemKind[] = ['product', 'kit', 'bundle'];
const SERVICE_KINDS: ItemKind[] = ['service', 'subscription'];

export function ItemPicker({
  value,
  onChange,
  label = 'Item',
  required = false,
  disabled = false,
  placeholder = 'Select an item.',
  filter,
}: ItemPickerProps) {
  const { can } = useCapabilities();
  const [createOpen, setCreateOpen] = useState(false);
  const [justCreated, setJustCreated] = useState<Item | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: itemsKeys.list(),
    queryFn: () => listItems(),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    retry: 1,
  });

  const options = useMemo(() => {
    const all = data ?? [];
    const merged =
      justCreated && !all.some((i) => i.id === justCreated.id)
        ? [justCreated, ...all]
        : all;
    return merged.filter((i) => {
      if (filter?.active !== undefined && i.is_active !== filter.active) {
        return false;
      }
      if (filter?.kind === 'good' && !GOOD_KINDS.includes(i.kind)) return false;
      if (filter?.kind === 'service' && !SERVICE_KINDS.includes(i.kind)) {
        return false;
      }
      if (filter?.supply_source && i.supply_source !== filter.supply_source) {
        return false;
      }
      return true;
    });
  }, [data, justCreated, filter?.active, filter?.kind, filter?.supply_source]);

  return (
    <>
      <EntityPicker<Item>
        value={value}
        onChange={(id, item) => onChange(id, item)}
        options={options}
        getOptionId={(i) => i.id}
        getOptionLabel={(i) =>
          i.supply_source === 'in_house'
            ? `${i.sku} · ${i.name}`
            : `${i.sku} · ${i.name} · ${SUPPLY_SOURCE_LABEL[i.supply_source]}`
        }
        label={label}
        required={required}
        disabled={disabled}
        loading={isLoading}
        placeholder={placeholder}
        allowCreate={can('items.item.write')}
        createLabel="New item"
        onCreate={() => setCreateOpen(true)}
      />
      <QuickCreateItemModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(item) => {
          setJustCreated(item);
          onChange(item.id, item);
          setCreateOpen(false);
        }}
      />
    </>
  );
}
