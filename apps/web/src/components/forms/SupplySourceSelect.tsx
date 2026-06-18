// SupplySourceSelect. The per-line supply-source override control
// (F-UIUX-ENTITYPICKER-LINE-OVERRIDE-01). Distinct from the item-level
// supply_source control on the item forms: this one is nullable, where the empty
// option means "inherit from item" (the line stores NULL and cost roll-ups fall
// back to items.supply_source via COALESCE(line, item)).

import { Select } from '@/components/ui/Select';
import { SUPPLY_SOURCE_OPTIONS } from '@/lib/supplySource';
import type { ItemSupplySource } from '@/lib/types/sales';

export interface SupplySourceSelectProps {
  value: ItemSupplySource | null;
  onChange: (value: ItemSupplySource | null) => void;
  label?: string;
  disabled?: boolean;
}

export function SupplySourceSelect({
  value,
  onChange,
  label = 'Supply source override',
  disabled = false,
}: SupplySourceSelectProps) {
  return (
    <label className="flex flex-col gap-2">
      <span className="font-sans text-sm text-ink-dim tracking-wide uppercase">
        {label}
      </span>
      <Select
        value={value ?? ''}
        onChange={(e) =>
          onChange(e.target.value === '' ? null : (e.target.value as ItemSupplySource))
        }
        disabled={disabled}
      >
        <option value="">Inherit from item</option>
        {SUPPLY_SOURCE_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </Select>
    </label>
  );
}
