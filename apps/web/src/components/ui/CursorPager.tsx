// CursorPager. Prev/Next pager for keyset-paginated lists (Workstream C of the
// 2026-06-17 UI scan). Keyset pagination has no total row count, so this is a
// deliberately simpler pager than Pagination: the page owns a stack of cursors
// (push next_cursor on Next, pop on Prev) and passes canPrev/canNext plus the
// handlers. Renders nothing when neither direction is available (a single-page
// result), so a short list shows no pager chrome.

export interface CursorPagerProps {
  canPrev: boolean;
  canNext: boolean;
  onPrev: () => void;
  onNext: () => void;
  /** Optional context line, e.g. "Showing 50". No total is available in keyset mode. */
  label?: string;
}

export function CursorPager({ canPrev, canNext, onPrev, onNext, label }: CursorPagerProps) {
  if (!canPrev && !canNext) return null;
  return (
    <nav
      className="flex items-center justify-between gap-3 font-sans text-sm"
      aria-label="Pagination"
    >
      <span className="text-ink-dim">{label ?? ''}</span>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onPrev}
          disabled={!canPrev}
          className="border border-line bg-bg-2 px-3 py-1 text-ink disabled:opacity-40"
        >
          Prev
        </button>
        <button
          type="button"
          onClick={onNext}
          disabled={!canNext}
          className="border border-line bg-bg-2 px-3 py-1 text-ink disabled:opacity-40"
        >
          Next
        </button>
      </div>
    </nav>
  );
}
