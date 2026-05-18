import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';

import { itemsKeys } from '@/lib/queryKeys/items';
import { listItems } from '@/lib/services/itemsService';
import type { ItemKind } from '@/lib/types/sales';

/**
 * ItemPicker. Fetches the items catalog (sales-config-api). Caller may
 * narrow by kind ('good' = product or kit; 'service' = service) or by active.
 * The schema's ItemKind is the canonical enum; 'good'/'service' here is a
 * SPA-side coarse grouping for callers that only need to distinguish things
 * you ship vs. things you charge for time on.
 */
export interface ItemPickerProps {
  value: string | null;
  onChange: (id: string | null) => void;
  label?: string;
  required?: boolean;
  disabled?: boolean;
  placeholder?: string;
  filter?: { kind?: 'good' | 'service'; active?: boolean } | undefined;
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
  const { data, isLoading } = useQuery({
    queryKey: itemsKeys.list(),
    queryFn: () => listItems(),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    retry: 1,
  });

  const items = useMemo(() => {
    const all = data ?? [];
    return all.filter((i) => {
      if (filter?.active !== undefined && i.is_active !== filter.active) {
        return false;
      }
      if (filter?.kind === 'good' && !GOOD_KINDS.includes(i.kind)) return false;
      if (filter?.kind === 'service' && !SERVICE_KINDS.includes(i.kind)) {
        return false;
      }
      return true;
    });
  }, [data, filter?.active, filter?.kind]);

  return (
    <label className="flex flex-col gap-2">
      {label && (
        <span className="font-sans text-sm text-ink-dim tracking-wide uppercase">
          {label}
          {required && <span className="text-accent ml-1">*</span>}
        </span>
      )}
      <select
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)}
        required={required}
        disabled={disabled || isLoading}
        className="bg-bg-2 border border-line text-ink px-4 py-3 font-sans focus:outline-none focus:border-accent disabled:opacity-50"
      >
        <option value="">{isLoading ? 'Loading.' : placeholder}</option>
        {items.map((i) => (
          <option key={i.id} value={i.id}>
            {i.sku} · {i.name}
          </option>
        ))}
      </select>
    </label>
  );
}
