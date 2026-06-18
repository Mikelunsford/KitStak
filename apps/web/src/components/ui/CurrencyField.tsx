// CurrencyField. The currency picker for create/money forms. It seeds itself
// from the org-wide default currency (settings store) exactly once on load, then
// the operator's choice flows through unchanged. Hosting forms keep their own
// currency-code state (a plain string) and tuck this control into an Advanced
// section, so the main create flow is not cluttered by a field that almost
// always takes the org default.

import { useEffect, useRef } from 'react';

import { useCurrenciesList } from '@/lib/hooks/useCurrencies';
import { useDefaultCurrency } from '@/lib/hooks/useDefaultCurrency';

export interface CurrencyFieldProps {
  value: string;
  onChange: (code: string) => void;
  label?: string;
  disabled?: boolean;
}

export function CurrencyField({
  value,
  onChange,
  label = 'Currency',
  disabled = false,
}: CurrencyFieldProps) {
  const defaultCurrency = useDefaultCurrency();
  const { data: currencies } = useCurrenciesList();
  const seeded = useRef(false);

  // Seed from the org default exactly once, when the setting resolves. The ref
  // guard means a later user choice is never overwritten, and a no-op when the
  // default already matches the form's initial value.
  useEffect(() => {
    if (!seeded.current && defaultCurrency) {
      seeded.current = true;
      if (defaultCurrency !== value) onChange(defaultCurrency);
    }
  }, [defaultCurrency, value, onChange]);

  const options =
    currencies && currencies.length > 0 ? currencies : [{ code: value || 'USD' }];

  return (
    <label className="flex flex-col gap-2">
      <span className="font-sans text-sm text-ink-dim tracking-wide uppercase">
        {label}
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="bg-bg-2 border border-line text-ink px-4 py-3 font-sans focus:outline-none focus:border-accent disabled:opacity-50"
      >
        {options.map((c) => (
          <option key={c.code} value={c.code}>
            {c.code}
          </option>
        ))}
      </select>
    </label>
  );
}
