import { useEffect, useRef, useState, type ChangeEvent, type FocusEvent } from 'react';

import { TextInput } from '@/components/ui/TextInput';
import { roundHalfEven } from '@/lib/money';

/**
 * QuantityInput. Operator types a human decimal quantity ("100" or
 * "100.500"). Component stores integer `qty_e3` (×1000) via `onChange`.
 * Closes the E3-trap audit item for SPA forms by ending visible "(e3)"
 * labels. No "x1000" hint is rendered.
 *
 * Constitutional invariants:
 *   - Storage stays integer qty_e3 on the wire.
 *   - Half-even rounding via `@/lib/money#roundHalfEven`.
 *   - Negative quantities are rejected (operator workflow has no use for
 *     negative line-item quantities; credit notes use DollarInput with
 *     `allowNegative`).
 *   - No new top-level deps.
 */
export interface QuantityInputProps {
  /** Stored value in integer qty_e3 (×1000). `null` is empty. */
  value: number | null;
  /** Called with the integer qty_e3 value (or null for empty input). */
  onChange: (qtyE3: number | null) => void;
  label?: string;
  name?: string;
  required?: boolean;
  disabled?: boolean;
  error?: string;
  placeholder?: string;
}

/**
 * Parse a user-typed quantity string into integer qty_e3 (×1000).
 * Strips commas, whitespace. Returns `null` for empty input and `NaN`
 * for unparseable input or negative values.
 *
 * Parses lexically (digits + optional decimal) rather than via
 * `Number(x) * 1000` so half-unit boundaries land on the same integer
 * the server-side math would produce.
 */
export function parseQuantityToE3(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  const cleaned = trimmed.replace(/[,\s]/g, '');
  if (cleaned === '' || cleaned === '.' || cleaned === '-') return NaN;

  const match = /^(\d*)(?:\.(\d*))?$/.exec(cleaned);
  if (!match) return NaN;
  const wholePart = match[1] ?? '';
  const fracPart = match[2] ?? '';
  if (wholePart === '' && fracPart === '') return NaN;

  const whole = wholePart === '' ? 0 : Number(wholePart);
  if (!Number.isFinite(whole)) return NaN;

  // 1 unit = 1000 qty_e3. Pad/truncate fractional to 4 digits so we have
  // a ten-thousandth precision, then half-even on the fourth digit.
  const fracPadded = (fracPart + '0000').slice(0, 4);
  const fracTenK = Number(fracPadded);
  if (!Number.isFinite(fracTenK)) return NaN;
  const thousandths = Math.floor(fracTenK / 10); // first three digits as qty_e3 units
  const tenKRemainder = fracTenK - thousandths * 10;
  const e3BeforeRounding = whole * 1000 + thousandths + tenKRemainder / 10;
  return roundHalfEven(e3BeforeRounding);
}

/**
 * Format integer qty_e3 back into a human decimal string. Trailing zeros
 * in the fractional part are stripped: 100000 -> "100", 100500 -> "100.5".
 */
export function formatE3ForDisplay(qtyE3: number | null): string {
  if (qtyE3 === null) return '';
  const human = qtyE3 / 1000;
  // Render up to 3 fractional digits and trim trailing zeros so 100000
  // shows as "100" instead of "100.000".
  const fixed = human.toFixed(3);
  return fixed.replace(/\.?0+$/, '');
}

export function QuantityInput({
  value,
  onChange,
  label,
  name,
  required = false,
  disabled = false,
  error,
  placeholder,
}: QuantityInputProps) {
  const [display, setDisplay] = useState<string>(() => formatE3ForDisplay(value));
  const [localError, setLocalError] = useState<string | null>(null);
  const lastEmittedRef = useRef<number | null>(value);

  useEffect(() => {
    if (value === lastEmittedRef.current) return;
    lastEmittedRef.current = value;
    setDisplay(formatE3ForDisplay(value));
    setLocalError(null);
  }, [value]);

  const onInput = (e: ChangeEvent<HTMLInputElement>) => {
    const next = e.target.value;
    setDisplay(next);
    const parsed = parseQuantityToE3(next);
    if (parsed === null) {
      setLocalError(null);
      lastEmittedRef.current = null;
      onChange(null);
      return;
    }
    if (Number.isNaN(parsed)) {
      setLocalError('Enter a valid quantity.');
      return;
    }
    setLocalError(null);
    lastEmittedRef.current = parsed;
    onChange(parsed);
  };

  const onBlur = (_e: FocusEvent<HTMLInputElement>) => {
    const parsed = parseQuantityToE3(display);
    if (parsed === null || Number.isNaN(parsed)) return;
    setDisplay(formatE3ForDisplay(parsed));
  };

  const displayError = error ?? localError ?? undefined;

  return (
    <TextInput
      {...(label !== undefined ? { label } : {})}
      {...(name ? { name } : {})}
      value={display}
      onChange={onInput}
      onBlur={onBlur}
      inputMode="decimal"
      required={required}
      disabled={disabled}
      {...(displayError ? { error: displayError } : {})}
      {...(placeholder ? { placeholder } : {})}
    />
  );
}
