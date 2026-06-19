// DataTable. Shared list table for operator surfaces (F-Wave10-UI-KIT-01).
//
// Replaces the per-page hand-rolled <table> markup. One consistent header
// style (mono uppercase), hover rows, per-column alignment (right-align numeric
// columns for money), a skeleton loading state, and an integrated empty state
// that keeps the table frame instead of blanking the page.
//
// Presentational and generic over the row type. Cells render through the
// column's render(row), so a cell can return a Link, a StatusBadge, or
// formatCents output. Server pagination stays external (see Pagination /
// CursorPager). Column-level sort (F-Wave10-UI-KIT-DATATABLE-SORT-01) is now
// supported, opt-in: a column with a `sortKey` renders a clickable header that
// calls onSort and shows the active-sort arrow. Columns without a sortKey, or a
// table without onSort, render plain headers exactly as before.
//
// Reference-number disclosure (R-W14-READ-03): an opt-in `renderRowDetails`
// prop adds a leading chevron toggle to each row that reveals an "Additional
// details" row spanning all columns. This is where the reference number now
// lives, off the main view. DataTable itself stays hook-free and directly
// callable (the existing element-walk tests rely on that); the per-row open
// state lives in the ExpandableDataRow sub-component, whose pure view
// (ExpandableDataRowView) is unit-tested without a DOM.

import { useState, type ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';

export type ColumnAlign = 'left' | 'right' | 'center';
export type SortDir = 'asc' | 'desc';

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
  /**
   * When set (and the table has onSort), the header is a button that calls
   * onSort(sortKey). This is the server sort_by value, not the column key.
   */
  sortKey?: string;
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
  /** Active sort column (matches a column's sortKey). */
  sortBy?: string;
  /** Active sort direction. */
  sortDir?: SortDir;
  /** Called with a column's sortKey when its header is clicked. */
  onSort?: (sortKey: string) => void;
  /**
   * Opt-in per-row disclosure. When provided, each row gets a leading chevron
   * toggle that reveals this content (the reference number and any secondary
   * codes) in an Additional details row spanning every column.
   */
  renderRowDetails?: (row: T) => ReactNode;
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

/** Stable id linking a row's toggle button to its Additional details region. */
export function rowDetailsRegionId(rowKey: string): string {
  return `row-details-${rowKey}`;
}

/**
 * Total column count for a body-spanning cell (empty state, details row),
 * accounting for the leading toggle column when row details are enabled.
 */
export function bodyColSpan(columnCount: number, hasRowDetails: boolean): number {
  return columnCount + (hasRowDetails ? 1 : 0);
}

interface ExpandableDataRowViewProps<T> {
  row: T;
  columns: ReadonlyArray<DataColumn<T>>;
  open: boolean;
  onToggle: () => void;
  regionId: string;
  renderRowDetails: (row: T) => ReactNode;
}

/**
 * Pure, hook-free expandable row. The data row carries a leading chevron toggle
 * wired (aria-expanded, aria-controls) to a details row below it. The details
 * row stays mounted and hidden when closed so the toggle always announces a
 * real target. Unit-tested by an element-tree walk.
 */
export function ExpandableDataRowView<T>({
  row,
  columns,
  open,
  onToggle,
  regionId,
  renderRowDetails,
}: ExpandableDataRowViewProps<T>) {
  return (
    <>
      <tr className="border-t border-line hover:bg-bg-2">
        <td className="w-8 px-2 py-3 align-top">
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={open}
            aria-controls={regionId}
            aria-label="Additional details"
            className="inline-flex items-center justify-center rounded p-0.5 text-ink-dim hover:text-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            <ChevronRight
              aria-hidden="true"
              className={`h-4 w-4 transition-transform ${open ? 'rotate-90' : ''}`}
            />
          </button>
        </td>
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
      <tr hidden={!open} className="border-t border-line bg-bg-2">
        <td
          id={regionId}
          colSpan={bodyColSpan(columns.length, true)}
          className="px-4 py-3"
          data-testid="datatable-row-details"
        >
          <div className="flex flex-col gap-1 font-sans text-sm text-ink-dim">
            <span className="font-mono text-xs uppercase tracking-wide text-ink-dim">
              Additional details
            </span>
            {renderRowDetails(row)}
          </div>
        </td>
      </tr>
    </>
  );
}

interface ExpandableDataRowProps<T> {
  row: T;
  columns: ReadonlyArray<DataColumn<T>>;
  rowKey: string;
  renderRowDetails: (row: T) => ReactNode;
}

function ExpandableDataRow<T>({
  row,
  columns,
  rowKey,
  renderRowDetails,
}: ExpandableDataRowProps<T>) {
  const [open, setOpen] = useState(false);
  return (
    <ExpandableDataRowView
      row={row}
      columns={columns}
      open={open}
      onToggle={() => setOpen((prev) => !prev)}
      regionId={rowDetailsRegionId(rowKey)}
      renderRowDetails={renderRowDetails}
    />
  );
}

export function DataTable<T>({
  columns,
  rows,
  getRowKey,
  loading = false,
  loadingRows = 5,
  empty,
  sortBy,
  sortDir,
  onSort,
  renderRowDetails,
}: DataTableProps<T>) {
  const view = resolveTableView(loading, rows.length);
  const hasRowDetails = Boolean(renderRowDetails);
  const spanAll = bodyColSpan(columns.length, hasRowDetails);

  return (
    <div className="overflow-x-auto border border-line">
      <table className="w-full border-collapse text-left font-sans text-sm">
        <thead>
          <tr className="border-b border-line bg-bg-2">
            {hasRowDetails ? (
              <th scope="col" className="w-8 px-2 py-2.5">
                <span className="sr-only">Additional details</span>
              </th>
            ) : null}
            {columns.map((col) => {
              const sortable = Boolean(col.sortKey && onSort);
              const active = sortable && sortBy === col.sortKey;
              return (
                <th
                  key={col.key}
                  scope="col"
                  aria-sort={
                    active ? (sortDir === 'asc' ? 'ascending' : 'descending') : undefined
                  }
                  className={`px-4 py-2.5 font-mono text-xs uppercase tracking-wide text-ink-dim ${alignClass(
                    col.align,
                  )}`}
                >
                  {sortable ? (
                    <button
                      type="button"
                      onClick={() => onSort!(col.sortKey!)}
                      className={`inline-flex items-center gap-1 uppercase tracking-wide hover:text-ink ${
                        active ? 'text-ink' : ''
                      }`}
                    >
                      {col.header}
                      <span aria-hidden="true" className="text-[0.6rem]">
                        {active ? (sortDir === 'asc' ? '↑' : '↓') : '↕'}
                      </span>
                    </button>
                  ) : (
                    col.header
                  )}
                </th>
              );
            })}
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
                  {hasRowDetails ? (
                    <td className="w-8 px-2 py-3">
                      <span className="block h-3 w-3 animate-pulse rounded bg-bg-2" />
                    </td>
                  ) : null}
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
                colSpan={spanAll}
                className="px-4 py-10 text-center text-ink-dim"
                data-testid="datatable-empty"
              >
                {empty ?? 'Nothing to show.'}
              </td>
            </tr>
          ) : null}

          {view === 'rows'
            ? rows.map((row) =>
                renderRowDetails ? (
                  <ExpandableDataRow
                    key={getRowKey(row)}
                    row={row}
                    columns={columns}
                    rowKey={getRowKey(row)}
                    renderRowDetails={renderRowDetails}
                  />
                ) : (
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
                ),
              )
            : null}
        </tbody>
      </table>
    </div>
  );
}
