// ColorField. A labeled colour control pairing a native colour swatch (which
// opens the OS colour wheel / spectrum) with a synced hex text field and a
// small preview chip. Controlled: the parent owns the raw hex string so a
// mid-edit value is never clobbered, and validation stays on the existing
// HexColorSchema at save time. Tailwind brand tokens only, no new dependency.

import type { ReactElement } from 'react';

export interface ColorFieldProps {
  label?: string;
  name?: string;
  /** Raw hex string from the parent (with or without leading #). */
  value: string;
  /** Called with the raw value from whichever control the user edited. */
  onChange: (value: string) => void;
  error?: string;
}

// Fallback fed to the native swatch when the current value is not yet a valid
// six-digit hex. The swatch's `value` prop must be a full #rrggbb string or the
// browser resets it to #000000, so we never hand it a partial value.
const SWATCH_FALLBACK = '#000000';

/**
 * Normalise a user-typed hex colour to canonical `#rrggbb`.
 *
 * Accepts an optional leading `#`, three-digit shorthand (expanded by doubling
 * each nibble), and any letter case (lower-cased on the way out). Returns null
 * when the input is not a valid three- or six-digit hex colour, so callers can
 * fall back to a safe default for the native swatch.
 */
export function normalizeHexColor(input: string): string | null {
  const trimmed = input.trim();
  const m = /^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(trimmed);
  if (!m || !m[1]) return null;
  const raw = m[1];
  const full =
    raw.length === 3 ? raw.split('').map((c) => c + c).join('') : raw;
  return `#${full.toLowerCase()}`;
}

export function ColorField({
  label,
  name,
  value,
  onChange,
  error,
}: ColorFieldProps): ReactElement {
  const inputId = name;
  const normalized = normalizeHexColor(value);
  const swatchValue = normalized ?? SWATCH_FALLBACK;

  return (
    <label className="flex flex-col gap-2" htmlFor={inputId}>
      {label && (
        <span className="font-sans text-sm text-ink-dim tracking-wide uppercase">
          {label}
        </span>
      )}
      <div className="flex items-center gap-3">
        <input
          type="color"
          aria-label={label ? `${label} swatch` : 'Colour swatch'}
          value={swatchValue}
          onChange={(e) => onChange(e.target.value)}
          className="h-12 w-12 shrink-0 cursor-pointer border border-line bg-bg-2 p-1"
        />
        <input
          id={inputId}
          name={name}
          type="text"
          inputMode="text"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="#000000"
          className="flex-1 bg-bg-2 border border-line text-ink px-4 py-3 font-mono focus:outline-none focus:border-accent"
        />
      </div>
      {error && <span className="font-sans text-sm text-danger">{error}</span>}
    </label>
  );
}
