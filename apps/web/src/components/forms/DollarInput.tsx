import { useEffect, useRef, useState, type ChangeEvent, type FocusEvent } from 'react';

import { TextInput } from '@/components/ui/TextInput';
import { roundHalfEven } from '@/lib/money';

/**
 * DollarInput. Operator types human dollars ("5.00" or "$5"). Component
 * stores integer cents (500) via the `onChange` callback. Closes the
 * cents-trap audit item for SPA forms by ending visible "(cents)" labels.
 *
 * Constitutional invariants:
 *   - Storage stays BIGINT cents on the wire (`onChange` emits an integer).
 *   - Half-even rounding via `@/lib/money#roundHalfEven` so the SPA's
 *     display-to-storage conversion matches the server-side money math.
 *   - No new top-level deps; reuses the hand-rolled TextInput shell so
 *     styling and accessibility (label, error, focus ring) inherit.
 *
 * The component holds an internal display string so the input is fully
 * controlled even while the operator is mid-edit ("5." is a valid in-flight
 * state). On blur the display normalises to "5.00" and the parent receives
 * the canonical cents value.
 */
export interface DollarInputProps {
  /** Stored value in integer cents. `null` renders an empty field. */
  value: number | null;
  /** Called with the integer cents value (or null for empty input). */
  onChange: (cents: number | null) => void;
  label?: string;
  name?: string;
  required?: boolean;
  disabled?: boolean;
  error?: string;
  placeholder?: string;
  /** Permit negative values (credit notes, refunds). Defaults to false. */
  allowNegative?: boolean;
}

/**
 * Parse a user-typed dollar string into integer cents.
 * Strips currency symbol, commas, whitespace. Returns `null` for empty
 * input and `NaN` for unparseable input.
 *
 * Parses lexically (digits + optional decimal) rather than via
 * `Number(x) * 100` so half-cent boundaries land on the same integer
 * the server-side money math would produce. `5.015` becomes 502 cents
 * via banker's rounding without floating-point drift biasing the result.
 */
export function parseDollarsToCents(
  raw: string,
  options: { allowNegative?: boolean } = {},
): number | null {
  const { allowNegative = false } = options;
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  // Strip "$", commas, and whitespace inside the value.
  const cleaned = trimmed.replace(/[$,\s]/g, '');
  if (cleaned === '' || cleaned === '-' || cleaned === '.') return NaN;

  // Lexical parse: optional sign, digits, optional decimal + digits.
  const match = /^(-?)(\d*)(?:\.(\d*))?$/.exec(cleaned);
  if (!match) return NaN;
  const sign = match[1] === '-' ? -1 : 1;
  const wholePart = match[2] ?? '';
  const fracPart = match[3] ?? '';
  if (wholePart === '' && fracPart === '') return NaN;
  if (!allowNegative && sign === -1) return NaN;

  const whole = wholePart === '' ? 0 : Number(wholePart);
  if (!Number.isFinite(whole)) return NaN;

  // Pad/truncate the fractional part to exactly 3 digits, then apply
  // half-even rounding on the third digit to produce integer cents.
  const fracPadded = (fracPart + '000').slice(0, 3);
  const fracMilli = Number(fracPadded);
  if (!Number.isFinite(fracMilli)) return NaN;
  // whole cents from the first two fractional digits + half-even on the third.
  const tenths = Math.floor(fracMilli / 10); // first two digits as cents
  const milliRemainder = fracMilli - tenths * 10; // third digit (0-9)
  // roundHalfEven semantics on the half-cent: treat cents + 0.x where x = milliRemainder/10
  const centsBeforeRounding = whole * 100 + tenths + milliRemainder / 10;
  return sign * roundHalfEven(centsBeforeRounding);
}

/**
 * Format integer cents back into a 2-decimal dollar display string.
 * Negative values render with a leading minus, no parentheses (operator
 * preference: credit notes show "-5.00" not "(5.00)").
 */
export function formatCentsForDisplay(cents: number | null): string {
  if (cents === null) return '';
  const dollars = cents / 100;
  const sign = dollars < 0 ? '-' : '';
  return `${sign}${Math.abs(dollars).toFixed(2)}`;
}

export function DollarInput({
  value,
  onChange,
  label,
  name,
  required = false,
  disabled = false,
  error,
  placeholder,
  allowNegative = false,
}: DollarInputProps) {
  // Internal display string lets the operator type freely (incl. "5."
  // mid-edit) without the parent's integer value clobbering the field.
  const [display, setDisplay] = useState<string>(() => formatCentsForDisplay(value));
  const [localError, setLocalError] = useState<string | null>(null);
  // Track the cents value we last EMITTED so we can distinguish operator
  // edits ("5.") from external prop changes (pre-fill from server fetch).
  const lastEmittedRef = useRef<number | null>(value);

  // Sync from parent only when the prop changes to a value we did not just
  // emit ourselves. This keeps "5." or other in-flight strings intact
  // during typing but accepts external pre-fills.
  useEffect(() => {
    if (value === lastEmittedRef.current) return;
    lastEmittedRef.current = value;
    setDisplay(formatCentsForDisplay(value));
    setLocalError(null);
  }, [value]);

  const onInput = (e: ChangeEvent<HTMLInputElement>) => {
    const next = e.target.value;
    setDisplay(next);
    const parsed = parseDollarsToCents(next, { allowNegative });
    if (parsed === null) {
      setLocalError(null);
      lastEmittedRef.current = null;
      onChange(null);
      return;
    }
    if (Number.isNaN(parsed)) {
      setLocalError('Enter a valid dollar amount.');
      return;
    }
    setLocalError(null);
    lastEmittedRef.current = parsed;
    onChange(parsed);
  };

  const onBlur = (_e: FocusEvent<HTMLInputElement>) => {
    const parsed = parseDollarsToCents(display, { allowNegative });
    if (parsed === null || Number.isNaN(parsed)) return;
    setDisplay(formatCentsForDisplay(parsed));
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
