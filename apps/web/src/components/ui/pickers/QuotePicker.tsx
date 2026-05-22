import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';

import { quotesKeys } from '@/lib/queryKeys/quotes';
import { listQuotes } from '@/lib/services/quotesService';
import type { QuoteState } from '@/lib/types/sales';

/**
 * QuotePicker. Reusable FK-resolution dropdown for picking a source
 * quote on the invoice create form (B2 of Wave B). Modeled on the
 * existing CustomerPicker / InvoicePicker shape.
 *
 * Filters:
 *   - customer_id (server-side via /quotes-api list endpoint)
 *   - state       (server-side)
 *
 * The list endpoint already enforces RLS server-side so the picker only
 * surfaces quotes the caller may see. Label format is "{number}" — the
 * customer name is omitted to keep the option terse; callers already
 * scope by customer_id at the parent form level (B2 invoice flow).
 */
export interface QuotePickerProps {
  value: string | null;
  onChange: (id: string | null) => void;
  label?: string;
  required?: boolean;
  disabled?: boolean;
  placeholder?: string;
  filter?:
    | {
        customer_id?: string;
        state?: QuoteState;
      }
    | undefined;
}

export function QuotePicker({
  value,
  onChange,
  label = 'Source quote',
  required = false,
  disabled = false,
  placeholder = 'Select a quote.',
  filter,
}: QuotePickerProps) {
  const serverFilters: { customer_id?: string; state?: string } = {};
  if (filter?.customer_id) serverFilters.customer_id = filter.customer_id;
  if (filter?.state) serverFilters.state = filter.state;

  const { data, isLoading } = useQuery({
    queryKey: quotesKeys.list({
      state: serverFilters.state ?? null,
      customer_id: serverFilters.customer_id ?? null,
    }),
    queryFn: () => listQuotes(serverFilters),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    retry: 1,
  });

  const items = useMemo(() => data ?? [], [data]);

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
        {items.map((q) => (
          <option key={q.id} value={q.id}>
            {q.number} ({q.state})
          </option>
        ))}
      </select>
    </label>
  );
}
