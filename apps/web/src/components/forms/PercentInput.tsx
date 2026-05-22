import { useEffect, useRef, useState, type ChangeEvent, type FocusEvent } from 'react';

import { TextInput } from '@/components/ui/TextInput';
import { roundHalfEven } from '@/lib/money';

/**
 * PercentInput. Operator types human percent ("10" or "10.5"). Component
 * stores integer basis points (1000 / 1050) via the `onChange` callback.
 * Closes the BPS-trap audit item for SPA forms by ending visible "(bps)"
 * labels.
 *
 * Constitutional invariants:
 *   - Storage stays basis-points integers on the wire.
 *   - Half-even rounding via `@/lib/money#roundHalfEven`.
 *   - No new top-level deps; reuses the hand-rolled TextInput shell.
 */
export interface PercentInputProps {
  /** Stored value in integer basis points (1% = 100 bps). `null` is empty. */
  value: number | null;
  /** Called with the integer bps value (or null for empty input). */
  onChange: (bps: number | null) => void;
  label?: string;
  name?: string;
  required?: boolean;
  disabled?: boolean;
  error?: string;
  placeholder?: string;
}

/**
 * Parse a user-typed percent string into integer basis points.
 * Strips "%", commas, whitespace. Returns `null` for empty input and
 * `NaN` for unparseable input. Rejects negative.
 *
 * Parses lexically (digits + optional decimal) rather than via
 * `Number(x) * 100` so half-bps boundaries land on the same integer
 * the server-side money math would produce.
 */
export function parsePercentToBps(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  const cleaned = trimmed.replace(/[%,\s]/g, '');
  if (cleaned === '' || cleaned === '.' || cleaned === '-') return NaN;

  const match = /^(\d*)(?:\.(\d*))?$/.exec(cleaned);
  if (!match) return NaN;
  const wholePart = match[1] ?? '';
  const fracPart = match[2] ?? '';
  if (wholePart === '' && fracPart === '') return NaN;

  const whole = wholePart === '' ? 0 : Number(wholePart);
  if (!Number.isFinite(whole)) return NaN;

  // 1% = 100 bps. Pad/truncate fractional to 3 digits so we have a
  // milli-percent precision, then half-even on the third digit.
  const fracPadded = (fracPart + '000').slice(0, 3);
  const fracMilli = Number(fracPadded);
  if (!Number.isFinite(fracMilli)) return NaN;
  const tenths = Math.floor(fracMilli / 10); // first two digits as bps
  const milliRemainder = fracMilli - tenths * 10;
  const bpsBeforeRounding = whole * 100 + tenths + milliRemainder / 10;
  return roundHalfEven(bpsBeforeRounding);
}

/**
 * Format integer bps back into a percent display string with up to two
 * fractional digits. 1050 -> "10.5", 1000 -> "10".
 */
export function formatBpsForDisplay(bps: number | null): string {
  if (bps === null) return '';
  const pct = bps / 100;
  // Drop trailing zeros from the fractional part but keep up to 2 places.
  // 1050 -> 10.5, 1000 -> 10, 1075 -> 10.75
  const fixed = pct.toFixed(2);
  return fixed.replace(/\.?0+$/, '');
}

export function PercentInput({
  value,
  onChange,
  label,
  name,
  required = false,
  disabled = false,
  error,
  placeholder,
}: PercentInputProps) {
  const [display, setDisplay] = useState<string>(() => formatBpsForDisplay(value));
  const [localError, setLocalError] = useState<string | null>(null);
  const lastEmittedRef = useRef<number | null>(value);

  useEffect(() => {
    if (value === lastEmittedRef.current) return;
    lastEmittedRef.current = value;
    setDisplay(formatBpsForDisplay(value));
    setLocalError(null);
  }, [value]);

  const onInput = (e: ChangeEvent<HTMLInputElement>) => {
    const next = e.target.value;
    setDisplay(next);
    const parsed = parsePercentToBps(next);
    if (parsed === null) {
      setLocalError(null);
      lastEmittedRef.current = null;
      onChange(null);
      return;
    }
    if (Number.isNaN(parsed)) {
      setLocalError('Enter a valid percent.');
      return;
    }
    setLocalError(null);
    lastEmittedRef.current = parsed;
    onChange(parsed);
  };

  const onBlur = (_e: FocusEvent<HTMLInputElement>) => {
    const parsed = parsePercentToBps(display);
    if (parsed === null || Number.isNaN(parsed)) return;
    setDisplay(formatBpsForDisplay(parsed));
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
