// EntityPicker. The reusable typeahead combobox that replaces the native
// <select> reference pickers (F-UIUX-ENTITYPICKER-01). Hand-rolled per the
// constitution (no Radix, no headless lib), modelled on the Cmd/Ctrl-K command
// bar's listbox keyboard pattern.
//
// It is presentational and generic: the caller fetches the rows and passes
// `options`, an id accessor, and a label accessor. The picker owns the open
// state, the type-to-filter query, keyboard navigation, and an optional
// "+ {createLabel}" row that opens an inline quick-create flow.
//
// Accessibility: role=combobox input with aria-expanded / aria-controls /
// aria-autocomplete / aria-activedescendant, a role=listbox of role=option
// rows, ArrowUp/ArrowDown/Home/End/Enter/Escape, and outside-pointerdown close
// (so an option click registers before the list closes).

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import { ChevronDown, Plus, X } from 'lucide-react';

import {
  buildEntityRows,
  filterOptions,
  moveActiveIndex,
  selectedLabel,
  type EntityPickerRow,
} from './entityPickerModel';

export interface EntityPickerProps<T> {
  value: string | null;
  onChange: (id: string | null, option?: T) => void;
  options: ReadonlyArray<T>;
  getOptionId: (option: T) => string;
  getOptionLabel: (option: T) => string;
  label?: string;
  required?: boolean;
  disabled?: boolean;
  loading?: boolean;
  placeholder?: string;
  emptyText?: string;
  /**
   * When true and `onCreate` is provided, a trailing "+ {createLabel}" row
   * opens the quick-create flow. Callers gate this on the create capability.
   */
  allowCreate?: boolean;
  createLabel?: string;
  onCreate?: () => void;
}

export function EntityPicker<T>({
  value,
  onChange,
  options,
  getOptionId,
  getOptionLabel,
  label,
  required = false,
  disabled = false,
  loading = false,
  placeholder = 'Select.',
  emptyText = 'No matches.',
  allowCreate = false,
  createLabel = 'New',
  onCreate,
}: EntityPickerProps<T>): JSX.Element {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const baseId = useId();
  const inputId = `${baseId}-input`;
  const listboxId = `${baseId}-listbox`;
  const optionId = (i: number) => `${baseId}-opt-${i}`;

  const canCreate = allowCreate && onCreate !== undefined;

  const filtered = useMemo(
    () => filterOptions(options, query, getOptionLabel),
    [options, query, getOptionLabel],
  );
  const rows = useMemo(
    () => buildEntityRows(filtered, canCreate),
    [filtered, canCreate],
  );
  const currentLabel = useMemo(
    () => selectedLabel(options, value, getOptionId, getOptionLabel),
    [options, value, getOptionId, getOptionLabel],
  );

  // Close on outside pointerdown. We close on pointerdown rather than input blur
  // so a click on an option row still fires its onClick before the list unmounts.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (!containerRef.current?.contains(e.target as Node)) {
        setOpen(false);
        setQuery('');
      }
    }
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  // Keep the active row in range as the filtered set shrinks or grows.
  useEffect(() => {
    setActiveIndex((cur) =>
      rows.length === 0 ? 0 : Math.min(Math.max(cur, 0), rows.length - 1),
    );
  }, [rows.length]);

  const openList = useCallback(() => {
    if (disabled || loading) return;
    setOpen(true);
    setQuery('');
    setActiveIndex(0);
  }, [disabled, loading]);

  const choose = useCallback(
    (row: EntityPickerRow<T>) => {
      if (row.kind === 'create') {
        setOpen(false);
        setQuery('');
        onCreate?.();
        return;
      }
      onChange(getOptionId(row.option), row.option);
      setOpen(false);
      setQuery('');
    },
    [onChange, getOptionId, onCreate],
  );

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (!open) {
          openList();
          return;
        }
        setActiveIndex((cur) => moveActiveIndex(cur, 1, rows.length));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (!open) {
          openList();
          return;
        }
        setActiveIndex((cur) => moveActiveIndex(cur, -1, rows.length));
        return;
      }
      if (e.key === 'Home') {
        if (!open) return;
        e.preventDefault();
        setActiveIndex(0);
        return;
      }
      if (e.key === 'End') {
        if (!open) return;
        e.preventDefault();
        setActiveIndex(rows.length - 1);
        return;
      }
      if (e.key === 'Enter') {
        if (!open) return;
        e.preventDefault();
        const row = rows[activeIndex];
        if (row) choose(row);
        return;
      }
      if (e.key === 'Escape') {
        if (!open) return;
        e.preventDefault();
        setOpen(false);
        setQuery('');
      }
    },
    [open, openList, rows, activeIndex, choose],
  );

  const clear = useCallback(() => {
    onChange(null);
    setQuery('');
    setOpen(false);
    inputRef.current?.focus();
  }, [onChange]);

  const showClear = value != null && !required && !disabled && !loading;
  const inputValue = open ? query : currentLabel;

  return (
    <div className="flex flex-col gap-2">
      {label && (
        <label
          htmlFor={inputId}
          className="font-sans text-sm text-ink-dim tracking-wide uppercase"
        >
          {label}
          {required && <span className="text-accent ml-1">*</span>}
        </label>
      )}
      <div ref={containerRef} className="relative">
        <input
          id={inputId}
          ref={inputRef}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={listboxId}
          aria-autocomplete="list"
          aria-activedescendant={
            open && rows[activeIndex] ? optionId(activeIndex) : undefined
          }
          autoComplete="off"
          required={required && value == null}
          disabled={disabled || loading}
          value={inputValue}
          placeholder={loading ? 'Loading.' : placeholder}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            setActiveIndex(0);
          }}
          onFocus={openList}
          onKeyDown={onKeyDown}
          className="w-full bg-bg-2 border border-line text-ink px-4 py-3 pr-16 font-sans focus:outline-none focus:border-accent disabled:opacity-50"
        />
        <div className="absolute inset-y-0 right-0 flex items-center gap-1 pr-2">
          {showClear && (
            <button
              type="button"
              aria-label="Clear selection"
              onClick={clear}
              className="p-1 text-ink-dim hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          )}
          <ChevronDown className="h-4 w-4 text-ink-dim" aria-hidden="true" />
        </div>

        {open && (
          <ul
            id={listboxId}
            role="listbox"
            className="absolute z-20 mt-1 max-h-64 w-full overflow-auto border border-line bg-bg-2 shadow-xl"
          >
            {rows.length === 0 ? (
              <li className="px-4 py-3 font-sans text-sm text-ink-dim">
                {emptyText}
              </li>
            ) : (
              rows.map((row, i) => {
                const active = i === activeIndex;
                if (row.kind === 'create') {
                  return (
                    <li
                      key="__create"
                      id={optionId(i)}
                      role="option"
                      aria-selected={active}
                      onMouseDown={(e) => e.preventDefault()}
                      onMouseEnter={() => setActiveIndex(i)}
                      onClick={() => choose(row)}
                      className={`flex cursor-pointer items-center gap-2 border-t border-line px-4 py-3 font-sans text-sm text-accent ${
                        active ? 'bg-bg' : ''
                      }`}
                    >
                      <Plus className="h-4 w-4" aria-hidden="true" />
                      {createLabel}
                    </li>
                  );
                }
                const id = getOptionId(row.option);
                const selected = id === value;
                return (
                  <li
                    key={id}
                    id={optionId(i)}
                    role="option"
                    aria-selected={selected}
                    onMouseDown={(e) => e.preventDefault()}
                    onMouseEnter={() => setActiveIndex(i)}
                    onClick={() => choose(row)}
                    className={`cursor-pointer px-4 py-3 font-sans text-sm ${
                      active ? 'bg-bg' : ''
                    } ${selected ? 'text-accent' : 'text-ink'}`}
                  >
                    {getOptionLabel(row.option)}
                  </li>
                );
              })
            )}
          </ul>
        )}
      </div>
    </div>
  );
}
