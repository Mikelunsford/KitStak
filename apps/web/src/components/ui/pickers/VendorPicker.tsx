import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';

import { vendorsKeys } from '@/lib/queryKeys/vendors';
import { listVendors } from '@/lib/services/vendorsService';

/**
 * VendorPicker. Fetches vendors via vendors-api. The status filter narrows
 * by is_active client-side; the list endpoint does not currently expose a
 * server-side status query parameter.
 */
export interface VendorPickerProps {
  value: string | null;
  onChange: (id: string | null) => void;
  label?: string;
  required?: boolean;
  disabled?: boolean;
  placeholder?: string;
  filter?: { status?: 'active' | 'inactive' } | undefined;
}

export function VendorPicker({
  value,
  onChange,
  label = 'Vendor',
  required = false,
  disabled = false,
  placeholder = 'Select a vendor.',
  filter,
}: VendorPickerProps) {
  const { data, isLoading } = useQuery({
    queryKey: vendorsKeys.list(),
    queryFn: () => listVendors(),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    retry: 1,
  });

  const items = useMemo(() => {
    const all = data?.items ?? [];
    if (!filter?.status) return all;
    const wantActive = filter.status === 'active';
    return all.filter((v) => v.is_active === wantActive);
  }, [data, filter?.status]);

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
        {items.map((v) => (
          <option key={v.id} value={v.id}>
            {v.display_name}
          </option>
        ))}
      </select>
    </label>
  );
}
