// FilterBar. Shared list toolbar (F-Wave10-UI-KIT-01). Renders filter controls
// in a row (search, selects), with a second row of removable active-filter
// chips and a Clear-all affordance. Presentational: the parent owns the filter
// state (typically the URL search params) and supplies the chips plus their
// clear handlers.

import type { ReactNode } from 'react';

export interface FilterChip {
  /** Stable key for the chip. */
  key: string;
  /** Human label, e.g. "Status: Submitted". */
  label: string;
  /** Clears just this filter. */
  onClear: () => void;
}

export interface FilterBarProps {
  /** Filter controls (search input, selects). */
  children?: ReactNode;
  /** Active filter chips. When empty, the chip row is omitted. */
  chips?: ReadonlyArray<FilterChip>;
  /** Clears every active filter at once. Shown only when chips exist. */
  onClearAll?: () => void;
}

export function FilterBar({ children, chips = [], onClearAll }: FilterBarProps) {
  return (
    <div className="flex flex-col gap-3">
      {children ? (
        <div className="flex flex-wrap items-center gap-3">{children}</div>
      ) : null}
      {chips.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          {chips.map((chip) => (
            <button
              key={chip.key}
              type="button"
              onClick={chip.onClear}
              className="inline-flex items-center gap-1 border border-line bg-bg-2 px-2 py-1 font-sans text-xs text-ink-dim hover:text-ink"
            >
              {chip.label}
              <span aria-hidden="true">x</span>
              <span className="sr-only">Remove filter</span>
            </button>
          ))}
          {onClearAll ? (
            <button
              type="button"
              onClick={onClearAll}
              className="font-sans text-xs font-semibold text-accent hover:text-accent-bright focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              Clear all
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
