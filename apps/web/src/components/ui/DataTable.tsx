// DataTable. Shared list table for operator surfaces (F-Wave10-UI-KIT-01).
//
// Replaces the per-page hand-rolled <table> markup. One consistent header
// style (mono uppercase), hover rows, per-column alignment (right-align mono
// numerics for money), a skeleton loading state, and an integrated empty
// state that keeps the table frame instead of blanking the page.
//
// Presentational and generic over the row type. Cells render through the
// column's render(row), so a cell can return a Link, a StatusBadge, or
// formatCents output. Sorting and server pagination are deliberately external
// (see Pagination) so this component stays a pure renderer; column-level sort
// is a planned follow-up (F-Wave10-UI-KIT-DATATABLE-SORT-01).

import type { ReactNode } from 'react';

export type ColumnAlign = 'left' | 'right' | 'center';

export interface DataColumn<T> {
  /** Stable key for the column (used as the React key). */
  key: string;
  /** Header cell content. */
  header: ReactNode;
  /** Cell renderer for a row. */
  render: (row: T) => ReactNode;
  /** Cell + header text alignment. Defaults to left. */
  align?: ColumnAlign;
  /** Extra classes applied to every cell in the column. */
  cellClassName?: string;
}

export interface DataTableProps<T> {
  columns: ReadonlyArray<DataColumn<T>>;
  rows: ReadonlyArray<T>;
  getRowKey: (row: T) => string;
  /** When true, render skeleton rows instead of data. */
  loading?: boolean;
  /** Number of skeleton rows to render while loading. Defaults to 5. */
  loadingRows?: number;
  /** Node rendered (spanning all columns) when there are no rows. */
  empty?: ReactNode;
}

/**
 * Pure view-state resolver. Keeps the render branch logic unit-testable
 * without a DOM. `loading` wins over emptiness so a slow first load never
 * flashes the empty state.
 */
export function resolveTableView(
  loading: boolean,
  rowCount: number,
): 'loading' | 'empty' | 'rows' {
  if (loading) return 'loading';
  if (rowCount === 0) return 'empty';
  return 'rows';
}

export function alignClass(align?: ColumnAlign): string {
  if (align === 'right') return 'text-right';
  if (align === 'center') return 'text-center';
  return 'text-left';
}

export function DataTable<T>({
  columns,
  rows,
  getRowKey,
  loading = false,
  loadingRows = 5,
  empty,
}: DataTableProps<T>) {
  const view = resolveTableView(loading, rows.length);

  return (
    <div className="overflow-x-auto border border-line">
      <table className="w-full border-collapse text-left font-sans text-sm">
        <thead>
          <tr className="border-b border-line bg-bg-2">
            {columns.map((col) => (
              <th
                key={col.key}
                className={`px-4 py-2.5 font-mono text-xs uppercase tracking-wide text-ink-dim ${alignClass(
                  col.align,
                )}`}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {view === 'loading'
            ? Array.from({ length: loadingRows }).map((_, rowIdx) => (
                <tr
                  key={`skeleton-${rowIdx}`}
                  className="border-t border-line"
                  data-testid="datatable-skeleton-row"
                >
                  {columns.map((col) => (
                    <td key={col.key} className="px-4 py-3">
                      <span className="block h-3 w-3/4 animate-pulse rounded bg-bg-2" />
                    </td>
                  ))}
                </tr>
              ))
            : null}

          {view === 'empty' ? (
            <tr>
              <td
                colSpan={columns.length}
                className="px-4 py-10 text-center text-ink-dim"
                data-testid="datatable-empty"
              >
                {empty ?? 'Nothing to show.'}
              </td>
            </tr>
          ) : null}

          {view === 'rows'
            ? rows.map((row) => (
                <tr
                  key={getRowKey(row)}
                  className="border-t border-line hover:bg-bg-2"
                >
                  {columns.map((col) => (
                    <td
                      key={col.key}
                      className={`px-4 py-3 align-top ${alignClass(col.align)} ${
                        col.cellClassName ?? ''
                      }`}
                    >
                      {col.render(row)}
                    </td>
                  ))}
                </tr>
              ))
            : null}
        </tbody>
      </table>
    </div>
  );
}
