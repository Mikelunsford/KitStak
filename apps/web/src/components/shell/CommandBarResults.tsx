// Presentational result list for the Cmd/Ctrl-K command bar (R-W13-SRCH-01,
// F-UIUX-PALETTE-VERBS-01).
//
// Pure given props and free of any data-fetching imports (no apiClient, no
// search hook) so it can be unit-tested by walking the returned element tree
// under Vitest's node environment (the repo runs without jsdom and the search
// hook chain pulls in Supabase env that is absent at test time).
//
// Uses the listbox/option ARIA pattern. The container (CommandBar) owns the
// text input and drives the active row through aria-activedescendant, so DOM
// focus stays on the input while arrow keys move the highlighted option. Action
// verbs and entity matches render as one unified list of CommandRow so a single
// flat index and one listbox cover both.

import type { CommandRow, CommandRowGroup } from './commandBarModel';

export const LISTBOX_ID = 'command-bar-listbox';

export function optionId(index: number): string {
  return `command-bar-option-${index}`;
}

export interface CommandBarResultsProps {
  groups: CommandRowGroup[];
  activeIndex: number;
  onSelect: (row: CommandRow) => void;
  onHover: (flatIndex: number) => void;
}

export function CommandBarResults({
  groups,
  activeIndex,
  onSelect,
  onHover,
}: CommandBarResultsProps) {
  let flatIndex = -1;
  return (
    <ul
      id={LISTBOX_ID}
      role="listbox"
      aria-label="Search results"
      data-testid="command-bar-listbox"
      className="max-h-80 overflow-y-auto"
    >
      {groups.map((g) => (
        <li key={g.key} role="group" aria-label={g.label}>
          <p
            data-testid="command-bar-group-label"
            className="px-3 pt-3 pb-1 font-sans text-xs uppercase tracking-wide text-ink-dim"
          >
            {g.label}
          </p>
          <ul>
            {g.rows.map((row) => {
              flatIndex += 1;
              const index = flatIndex;
              const active = index === activeIndex;
              return (
                <li key={row.key}>
                  <button
                    type="button"
                    id={optionId(index)}
                    role="option"
                    aria-selected={active}
                    data-testid="command-bar-option"
                    data-active={active ? 'true' : 'false'}
                    data-flat-index={index}
                    // onMouseDown (not onClick) so the selection fires before
                    // the input blur that would otherwise close the palette.
                    onMouseDown={(e) => {
                      e.preventDefault();
                      onSelect(row);
                    }}
                    onMouseMove={() => onHover(index)}
                    className={`flex w-full items-center justify-between px-3 py-2 text-left text-sm ${
                      active ? 'bg-bg' : 'hover:bg-bg'
                    }`}
                  >
                    <span className="truncate font-medium text-ink">
                      {row.title}
                    </span>
                    {row.subtitle ? (
                      <span className="ml-3 truncate text-xs text-ink-dim">
                        {row.subtitle}
                      </span>
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
        </li>
      ))}
    </ul>
  );
}
