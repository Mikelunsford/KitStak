import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';

import { paymentMethodsKeys } from '@/lib/queryKeys/paymentMethods';
import { listPaymentMethods } from '@/lib/services/paymentMethodsService';

import { paymentMethodOptionLabel } from './pickerOptionLabels';

/**
 * PaymentMethodPicker. Native-select reference picker for a quote's payment
 * method, modeled on QuotePicker. Lists the org's active payment methods; the
 * empty option means "use the org default". Replaces the raw-UUID text field on
 * the quote create form (P1-2).
 */
export interface PaymentMethodPickerProps {
  value: string | null;
  onChange: (id: string | null) => void;
  label?: string;
  disabled?: boolean;
  placeholder?: string;
}

export function PaymentMethodPicker({
  value,
  onChange,
  label = 'Payment method',
  disabled = false,
  placeholder = 'Use org default',
}: PaymentMethodPickerProps) {
  const { data, isLoading } = useQuery({
    queryKey: paymentMethodsKeys.list(),
    queryFn: () => listPaymentMethods(),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    retry: 1,
  });
  const items = useMemo(() => (data ?? []).filter((m) => m.is_active), [data]);

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
        {items.map((method) => (
          <option key={method.id} value={method.id}>
            {paymentMethodOptionLabel(method)}
          </option>
        ))}
      </select>
    </label>
  );
}
