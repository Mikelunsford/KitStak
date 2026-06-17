// CommandBar. The persistent Cmd/Ctrl-K global search palette (R-W13-SRCH-01).
//
// Hand-rolled per the constitution: no combobox/command-palette dependency.
// Built from the existing components/ui idiom, lib/apiClient.ts (through the
// searchService -> useGlobalSearch hook), a hand-rolled debounce hook, and
// lucide-react icons. Results come straight from search-api, which scopes every
// row by org_id, so the palette never sees another tenant's records.
//
// Spans customers, quotes, invoices, projects, items, and job runs. Keyboard
// model:
//   Cmd/Ctrl-K  toggle open (wired globally in AppShell)
//   ArrowDown   move active row down (wraps)
//   ArrowUp     move active row up (wraps)
//   Enter       navigate to the active row's record route
//   Escape      close the palette
//   Tab/Shift-Tab  trapped inside the dialog while open
//
// The result list uses the listbox/option ARIA pattern with
// aria-activedescendant so the active row is announced without moving DOM focus
// off the text input.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search } from 'lucide-react';

import { useGlobalSearch } from '@/lib/hooks/useCrossCutting';
import { useDebouncedValue } from '@/lib/hooks/useDebouncedValue';
import { useCapabilities } from '@/lib/hooks/useCapabilities';
import { useOrgFlags } from '@/lib/hooks/useOrgFlags';
import {
  buildCommandGroups,
  flattenRows,
  moveIndex,
  type CommandRow,
} from './commandBarModel';
import { ACTION_VERBS, visibleActionVerbs } from './commandBarActions';
import {
  CommandBarResults,
  LISTBOX_ID,
  optionId,
} from './CommandBarResults';

const DEBOUNCE_MS = 200;

// -------------------------------------------------------------------------
// Container. Owns input state, the debounced query, keyboard navigation, the
// focus trap, and navigation on selection.
// -------------------------------------------------------------------------
export interface CommandBarProps {
  open: boolean;
  onClose: () => void;
}

export function CommandBar({ open, onClose }: CommandBarProps) {
  const navigate = useNavigate();
  const [value, setValue] = useState('');
  const [activeIndex, setActiveIndex] = useState(-1);
  const debounced = useDebouncedValue(value.trim(), DEBOUNCE_MS);

  const inputRef = useRef<HTMLInputElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);

  const query = useGlobalSearch(debounced, { enabled: open && debounced.length > 0 });

  const { can } = useCapabilities();
  const flags = useOrgFlags().data;

  // Action verbs (filtered by query + capability + entitlement) lead the list,
  // then entity matches from search-api. Verbs are local, so they show
  // immediately without waiting on the network round-trip.
  const actionRows = useMemo(
    () => visibleActionVerbs(ACTION_VERBS, debounced, can, flags),
    [debounced, can, flags],
  );
  const groups = useMemo(
    () => buildCommandGroups(actionRows, query.data),
    [actionRows, query.data],
  );
  const flat = useMemo(() => flattenRows(groups), [groups]);

  // Reset the query and active row each time the palette opens, then focus the
  // input. A stale query from a prior open would flash old results.
  useEffect(() => {
    if (!open) return;
    setValue('');
    setActiveIndex(-1);
    // Focus after paint so the input exists in the DOM.
    const handle = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(handle);
  }, [open]);

  // Keep the active row in range as results change. When new results arrive,
  // default the highlight to the first row so Enter has an obvious target.
  useEffect(() => {
    if (flat.length === 0) {
      setActiveIndex(-1);
    } else {
      setActiveIndex((cur) => (cur < 0 || cur >= flat.length ? 0 : cur));
    }
  }, [flat.length]);

  const select = useCallback(
    (row: CommandRow) => {
      onClose();
      navigate(row.href);
    },
    [navigate, onClose],
  );

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIndex((cur) => moveIndex(cur, 1, flat.length));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIndex((cur) => moveIndex(cur, -1, flat.length));
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        const item = flat[activeIndex];
        if (item) select(item);
        return;
      }
      if (e.key === 'Tab') {
        // Focus trap: the input is the only tabbable control by default; if a
        // result button has been reached via mouse, Tab still cycles back to
        // the input so focus never leaves the dialog.
        e.preventDefault();
        inputRef.current?.focus();
      }
    },
    [activeIndex, flat, onClose, select],
  );

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 px-4 pt-24"
      data-testid="command-bar-overlay"
      onMouseDown={() => onClose()}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Global search"
        data-testid="command-bar-dialog"
        className="w-full max-w-xl border border-line bg-bg-2 shadow-xl"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <div className="flex items-center gap-2 border-b border-line px-3 py-2">
          <Search className="h-4 w-4 text-ink-dim" aria-hidden="true" />
          <input
            ref={inputRef}
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="Search customers, quotes, invoices, projects, items, jobs."
            className="w-full bg-transparent text-sm text-ink placeholder:text-ink-dim focus:outline-none"
            role="combobox"
            aria-expanded={flat.length > 0}
            aria-controls={LISTBOX_ID}
            aria-autocomplete="list"
            aria-activedescendant={
              activeIndex >= 0 ? optionId(activeIndex) : undefined
            }
            aria-label="Global search"
            data-testid="command-bar-input"
          />
        </div>

        {flat.length > 0 ? (
          <CommandBarResults
            groups={groups}
            activeIndex={activeIndex}
            onSelect={select}
            onHover={setActiveIndex}
          />
        ) : query.isLoading && debounced.length > 0 ? (
          <p className="px-3 py-3 text-sm text-ink-dim">Searching.</p>
        ) : query.isError ? (
          <p className="px-3 py-3 text-sm text-ink-dim">
            Search is unavailable. Try again.
          </p>
        ) : debounced.length > 0 ? (
          <p data-testid="command-bar-empty" className="px-3 py-3 text-sm text-ink-dim">
            No results.
          </p>
        ) : (
          <p className="px-3 py-3 text-sm text-ink-dim">
            Type to search across your workspace.
          </p>
        )}
      </div>
    </div>
  );
}
