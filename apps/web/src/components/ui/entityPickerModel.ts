// Pure model helpers for EntityPicker. No React, no hooks, no DOM, so the
// load-bearing filter and keyboard-navigation logic is unit-testable without a
// renderer (the repo runs Vitest without jsdom). Mirrors the commandBarModel
// split so the combobox behaves like the Cmd/Ctrl-K palette.

export type EntityPickerRow<T> =
  | { kind: 'option'; option: T }
  | { kind: 'create' };

/**
 * Case-insensitive substring filter over the option labels. An empty or
 * whitespace-only query returns every option, so opening the combobox shows the
 * full list before the operator types.
 */
export function filterOptions<T>(
  options: ReadonlyArray<T>,
  query: string,
  getLabel: (option: T) => string,
): T[] {
  const q = query.trim().toLowerCase();
  if (q === '') return [...options];
  return options.filter((option) => getLabel(option).toLowerCase().includes(q));
}

/**
 * Build the navigable row list: one row per filtered option, then a trailing
 * "create" row when inline create is allowed. The create row is part of the
 * keyboard navigation set so ArrowDown reaches it and Enter triggers it.
 */
export function buildEntityRows<T>(
  filtered: ReadonlyArray<T>,
  allowCreate: boolean,
): EntityPickerRow<T>[] {
  const rows: EntityPickerRow<T>[] = filtered.map((option) => ({
    kind: 'option' as const,
    option,
  }));
  if (allowCreate) rows.push({ kind: 'create' });
  return rows;
}

/**
 * Move the active index by `delta` over `count` rows, wrapping at both ends.
 * With no rows the active index stays at -1. Mirrors the command bar's
 * moveIndex so combobox traversal matches the palette.
 */
export function moveActiveIndex(
  current: number,
  delta: number,
  count: number,
): number {
  if (count <= 0) return -1;
  // Normalise current into range first so a stale index from a prior, longer
  // result set cannot push the result out of bounds.
  const base = current < 0 ? (delta > 0 ? -1 : 0) : current;
  return (base + delta + count) % count;
}

/**
 * The label shown in the closed combobox: the selected option's label, or an
 * empty string when nothing is selected (the placeholder then shows) or when the
 * selected id is no longer in the option set.
 */
export function selectedLabel<T>(
  options: ReadonlyArray<T>,
  value: string | null,
  getId: (option: T) => string,
  getLabel: (option: T) => string,
): string {
  if (value == null) return '';
  const match = options.find((option) => getId(option) === value);
  return match ? getLabel(match) : '';
}
