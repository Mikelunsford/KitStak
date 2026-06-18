import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import { EntityPicker } from '@/components/ui/EntityPicker';
import { QuickCreateCustomerModal } from '@/components/quick-create/QuickCreateCustomerModal';
import { useCapabilities } from '@/lib/hooks/useCapabilities';
import { customersKeys } from '@/lib/queryKeys/customers';
import { listCustomers } from '@/lib/services/customersService';
import type { Customer } from '@/lib/types/crm';

/**
 * CustomerPicker. Typeahead combobox over the org's customers (crm-api list
 * endpoint, RLS-scoped), with a "+ New customer" button beside the search field, gated on the
 * crm.customers.write capability (F-UIUX-ENTITYPICKER-01). On inline create the
 * new customer is auto-selected and merged into the list so the operator never
 * leaves the form. Public props are unchanged from the prior native-select
 * version, so call sites need no edits.
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
  placeholder = 'Search customers.',
  filter,
}: CustomerPickerProps) {
  const { can } = useCapabilities();
  const [createOpen, setCreateOpen] = useState(false);
  const [justCreated, setJustCreated] = useState<Customer | null>(null);

  const filters = filter?.status ? { status: filter.status } : {};
  const { data, isLoading } = useQuery({
    queryKey: customersKeys.list(filters as Record<string, unknown>),
    queryFn: () => listCustomers(filters),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    retry: 1,
  });

  // Merge a just-created record ahead of the refetch so the picker can show its
  // label immediately. Once the invalidated list refetches with the row, the
  // dedupe drops the local copy.
  const options = useMemo(() => {
    const base = data ?? [];
    if (justCreated && !base.some((c) => c.id === justCreated.id)) {
      return [justCreated, ...base];
    }
    return base;
  }, [data, justCreated]);

  return (
    <>
      <EntityPicker<Customer>
        value={value}
        onChange={(id) => onChange(id)}
        options={options}
        getOptionId={(c) => c.id}
        getOptionLabel={(c) => c.display_name}
        label={label}
        required={required}
        disabled={disabled}
        loading={isLoading}
        placeholder={placeholder}
        allowCreate={can('crm.customers.write')}
        createLabel="New customer"
        onCreate={() => setCreateOpen(true)}
      />
      <QuickCreateCustomerModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(customer) => {
          setJustCreated(customer);
          onChange(customer.id);
          setCreateOpen(false);
        }}
      />
    </>
  );
}
