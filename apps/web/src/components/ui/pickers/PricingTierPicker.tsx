import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';

import { pricingTiersKeys } from '@/lib/queryKeys/pricingTiers';
import { listPricingTiers } from '@/lib/services/pricingTiersService';

import { pricingTierOptionLabel } from './pickerOptionLabels';

/**
 * PricingTierPicker. Native-select reference picker for a quote's pricing tier,
 * modeled on QuotePicker. Lists the org's active pricing tiers by name and
 * discount. Pricing tiers have no org default, so the empty option means "no
 * pricing tier". Replaces the raw-UUID text field on the quote create form
 * (P1-2).
 */
export interface PricingTierPickerProps {
  value: string | null;
  onChange: (id: string | null) => void;
  label?: string;
  disabled?: boolean;
  placeholder?: string;
}

export function PricingTierPicker({
  value,
  onChange,
  label = 'Pricing tier',
  disabled = false,
  placeholder = 'No pricing tier',
}: PricingTierPickerProps) {
  const { data, isLoading } = useQuery({
    queryKey: pricingTiersKeys.list(),
    queryFn: () => listPricingTiers(),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    retry: 1,
  });
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
        {items.map((tier) => (
          <option key={tier.id} value={tier.id}>
            {pricingTierOptionLabel(tier)}
          </option>
        ))}
      </select>
    </label>
  );
}
