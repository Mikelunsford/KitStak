// ListToolbar. The shared list toolbar (Workstream C of the 2026-06-17 UI scan).
// Composes FilterBar with a debounced free-text search box and a slot for facet
// controls (status, customer, kind, date, amount selects), plus the active
// filter chips and a Clear-all. Column sort lives in the DataTable headers, so
// the toolbar owns search and facets, not sort.
//
// Presentational: the page (or the useServerList hook) owns the search and facet
// state, the debounce, and the chip list. The search box is uncontrolled-feeling
// but fully controlled; the page debounces the value before it reaches the query.

import type { ReactNode } from 'react';
import { Search } from 'lucide-react';

import { FilterBar, type FilterChip } from './FilterBar';

export interface ListToolbarProps {
  /** Current search box value (raw input; the page debounces before querying). */
  searchValue: string;
  onSearchChange: (value: string) => void;
  searchPlaceholder?: string;
  /** Facet controls (Select elements). Rendered after the search box. */
  children?: ReactNode;
  /** Active filter chips (search + facets). */
  chips?: ReadonlyArray<FilterChip>;
  /** Clears every active filter at once. */
  onClearAll?: () => void;
}

export function ListToolbar({
  searchValue,
  onSearchChange,
  searchPlaceholder = 'Search',
  children,
  chips = [],
  onClearAll,
}: ListToolbarProps) {
  return (
    <FilterBar chips={chips} {...(onClearAll ? { onClearAll } : {})}>
      <label className="flex items-center gap-2">
        <span className="sr-only">Search</span>
        <span className="flex items-center gap-2 border border-line bg-bg-2 px-2 py-1">
          <Search className="h-4 w-4 text-ink-dim" aria-hidden="true" />
          <input
            type="search"
            value={searchValue}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder={searchPlaceholder}
            className="w-48 bg-transparent font-sans text-sm text-ink placeholder:text-ink-dim focus:outline-none"
          />
        </span>
      </label>
      {children}
    </FilterBar>
  );
}
