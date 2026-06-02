// Pagination. Shared pager for list surfaces (F-Wave10-UI-KIT-01).
//
// The page math lives in the pure `paginate` helper so it is unit-testable
// and reusable by both client-side slicing (today) and server-driven paging
// (the F-WS7-SERVER-PAGINATION follow-up). The component is a thin renderer:
// a "Rows X-Y of N" range, Prev / Next, and the current page indicator.

export interface PageInfo {
  /** Total number of pages (>= 1). */
  pageCount: number;
  /** Zero-based start index of the current page's slice. */
  sliceStart: number;
  /** Exclusive end index of the current page's slice. */
  sliceEnd: number;
  /** 1-based first row number on the current page (0 when empty). */
  rangeStart: number;
  /** 1-based last row number on the current page (0 when empty). */
  rangeEnd: number;
  canPrev: boolean;
  canNext: boolean;
}

/**
 * Compute paging math for a zero-based page index. Defensive: clamps the page
 * into range and treats a non-positive pageSize as a single page so a caller
 * misconfiguration never divides by zero or returns a negative slice.
 */
export function paginate(
  totalCount: number,
  pageSize: number,
  page: number,
): PageInfo {
  const total = Math.max(0, Math.trunc(totalCount));
  const size = Math.max(1, Math.trunc(pageSize));
  const pageCount = Math.max(1, Math.ceil(total / size));
  const safePage = Math.min(Math.max(0, Math.trunc(page)), pageCount - 1);
  const sliceStart = safePage * size;
  const sliceEnd = Math.min(sliceStart + size, total);
  const rangeStart = total === 0 ? 0 : sliceStart + 1;
  const rangeEnd = sliceEnd;
  return {
    pageCount,
    sliceStart,
    sliceEnd,
    rangeStart,
    rangeEnd,
    canPrev: safePage > 0,
    canNext: safePage < pageCount - 1,
  };
}

export interface PaginationProps {
  /** Zero-based current page. */
  page: number;
  totalCount: number;
  pageSize: number;
  onPageChange: (nextPage: number) => void;
}

export function Pagination({
  page,
  totalCount,
  pageSize,
  onPageChange,
}: PaginationProps) {
  const info = paginate(totalCount, pageSize, page);

  return (
    <nav
      className="flex items-center justify-between gap-3 font-sans text-sm"
      aria-label="Pagination"
    >
      <span className="text-ink-dim">
        Rows {info.rangeStart}-{info.rangeEnd} of {totalCount}
      </span>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => onPageChange(Math.max(0, page - 1))}
          disabled={!info.canPrev}
          className="border border-line bg-bg-2 px-3 py-1 text-ink disabled:opacity-40"
        >
          Prev
        </button>
        <span className="text-ink-dim">
          {Math.min(page, info.pageCount - 1) + 1} of {info.pageCount}
        </span>
        <button
          type="button"
          onClick={() => onPageChange(Math.min(info.pageCount - 1, page + 1))}
          disabled={!info.canNext}
          className="border border-line bg-bg-2 px-3 py-1 text-ink disabled:opacity-40"
        >
          Next
        </button>
      </div>
    </nav>
  );
}
