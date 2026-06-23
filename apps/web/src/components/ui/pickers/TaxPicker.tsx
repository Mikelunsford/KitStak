import { useMemo } from 'react';

import { useTaxesList } from '@/lib/hooks/useTaxes';

import { taxOptionLabel } from './pickerOptionLabels';

/**
 * TaxPicker. Native-select reference picker for a quote's default tax, modeled
 * on QuotePicker. Lists the org's active taxes by name and rate; the empty
 * option means "use the org default" (the caller sends null and the org default
 * applies). Replaces the raw-UUID text field on the quote create form (P1-2).
 */
export interface TaxPickerProps {
  value: string | null;
  onChange: (id: string | null) => void;
  label?: string;
  disabled?: boolean;
  placeholder?: string;
}

export function TaxPicker({
  value,
  onChange,
  label = 'Default tax',
  disabled = false,
  placeholder = 'Use org default',
}: TaxPickerProps) {
  const { data, isLoading } = useTaxesList();
  const items = useMemo(() => (data ?? []).filter((t) => t.is_active), [data]);

  return (
    <label className="flex flex-col gap-2">
      {label && (
        <span className="font-sans text-sm text-ink-dim tracking-wide uppercase">
          {label}
        </span>
      )}
      <select
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)}
        disabled={disabled || isLoading}
        className="bg-bg-2 border border-line text-ink px-4 py-3 font-sans focus:outline-none focus:border-accent disabled:opacity-50"
      >
        <option value="">{isLoading ? 'Loading.' : placeholder}</option>
        {items.map((tax) => (
          <option key={tax.id} value={tax.id}>
            {taxOptionLabel(tax)}
          </option>
        ))}
      </select>
    </label>
  );
}
