import { useQuery } from '@tanstack/react-query';

import { customersKeys } from '@/lib/queryKeys/customers';
import { listCustomers } from '@/lib/services/customersService';

/**
 * CustomerPicker. Reusable FK-resolution dropdown that fetches the org's
 * customers via the crm-api list endpoint and surfaces display_name. RLS
 * filters server-side; the picker shows what the caller is allowed to see.
 *
 * Used by quote / project / invoice / payment / credit-note create forms.
 */
export interface CustomerPickerProps {
  value: string | null;
  onChange: (id: string | null) => void;
  label?: string;
  required?: boolean;
  disabled?: boolean;
  placeholder?: string;
  filter?: { status?: 'active' | 'inactive' } | undefined;
}

export function CustomerPicker({
  value,
  onChange,
  label = 'Customer',
  required = false,
  disabled = false,
  placeholder = 'Select a customer.',
  filter,
}: CustomerPickerProps) {
  const filters = filter?.status ? { status: filter.status } : {};
  const { data, isLoading } = useQuery({
    queryKey: customersKeys.list(filters as Record<string, unknown>),
    queryFn: () => listCustomers(filters),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    retry: 1,
  });

  const items = data ?? [];

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
        {items.map((c) => (
          <option key={c.id} value={c.id}>
            {c.display_name}
          </option>
        ))}
      </select>
    </label>
  );
}
