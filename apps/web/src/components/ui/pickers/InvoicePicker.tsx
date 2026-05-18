import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';

import { invoiceKeys } from '@/lib/queryKeys/invoices';
import { listInvoices } from '@/lib/services/invoicesService';
import type { InvoiceStatus } from '@/lib/types/finance';

/**
 * InvoicePicker. Fetches invoices and narrows by customer / project / state.
 * The list endpoint exposes status + customer_id server-side; project_id is
 * applied client-side until invoices-api adds that query parameter (tracked
 * as a future follow-up).
 */
export interface InvoicePickerProps {
  value: string | null;
  onChange: (id: string | null) => void;
  label?: string;
  required?: boolean;
  disabled?: boolean;
  placeholder?: string;
  filter?:
    | {
        customer_id?: string;
        project_id?: string;
        state?: InvoiceStatus;
      }
    | undefined;
}

export function InvoicePicker({
  value,
  onChange,
  label = 'Invoice',
  required = false,
  disabled = false,
  placeholder = 'Select an invoice.',
  filter,
}: InvoicePickerProps) {
  const serverFilters: { status?: string; customer_id?: string } = {};
  if (filter?.state) serverFilters.status = filter.state;
  if (filter?.customer_id) serverFilters.customer_id = filter.customer_id;

  const { data, isLoading } = useQuery({
    queryKey: invoiceKeys.list(serverFilters),
    queryFn: () => listInvoices(serverFilters),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    retry: 1,
  });

  const items = useMemo(() => {
    const all = data ?? [];
    if (filter?.project_id) {
      return all.filter((i) => i.project_id === filter.project_id);
    }
    return all;
  }, [data, filter?.project_id]);

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
            {i.invoice_number} ({i.status})
          </option>
        ))}
      </select>
    </label>
  );
}
