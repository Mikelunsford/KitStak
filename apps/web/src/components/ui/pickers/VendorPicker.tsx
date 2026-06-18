import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import { EntityPicker } from '@/components/ui/EntityPicker';
import { QuickCreateVendorModal } from '@/components/quick-create/QuickCreateVendorModal';
import { useCapabilities } from '@/lib/hooks/useCapabilities';
import { vendorsKeys } from '@/lib/queryKeys/vendors';
import { listVendors } from '@/lib/services/vendorsService';
import type { Vendor } from '@/lib/types/vendors_inventory_ops';

/**
 * VendorPicker. Typeahead combobox over the org's vendors (vendors-api), with a
 * "+ New vendor" button beside the search field, gated on vendors.vendor.create
 * (F-UIUX-ENTITYPICKER-01). The status filter narrows by is_active client-side.
 * Public props are unchanged from the prior native-select version.
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
  placeholder = 'Search vendors.',
  filter,
}: VendorPickerProps) {
  const { can } = useCapabilities();
  const [createOpen, setCreateOpen] = useState(false);
  const [justCreated, setJustCreated] = useState<Vendor | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: vendorsKeys.list(),
    queryFn: () => listVendors(),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    retry: 1,
  });

  const options = useMemo(() => {
    const all = data?.items ?? [];
    const merged =
      justCreated && !all.some((v) => v.id === justCreated.id)
        ? [justCreated, ...all]
        : all;
    if (!filter?.status) return merged;
    const wantActive = filter.status === 'active';
    return merged.filter((v) => v.is_active === wantActive);
  }, [data, justCreated, filter?.status]);

  return (
    <>
      <EntityPicker<Vendor>
        value={value}
        onChange={(id) => onChange(id)}
        options={options}
        getOptionId={(v) => v.id}
        getOptionLabel={(v) => v.display_name}
        label={label}
        required={required}
        disabled={disabled}
        loading={isLoading}
        placeholder={placeholder}
        allowCreate={can('vendors.vendor.create')}
        createLabel="New vendor"
        onCreate={() => setCreateOpen(true)}
      />
      <QuickCreateVendorModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(vendor) => {
          setJustCreated(vendor);
          onChange(vendor.id);
          setCreateOpen(false);
        }}
      />
    </>
  );
}
