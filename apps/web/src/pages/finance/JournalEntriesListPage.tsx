import { useState } from 'react';
import { Link } from 'react-router-dom';

import { useJournalEntries } from '@/lib/hooks/useJournalEntries';

const PAGE_SIZE = 50;

/**
 * JournalEntriesListPage. Reverse-chronological list. The per-route
 * finance.journal_entries.enabled flag is server-enforced; the SPA renders
 * the 403 message inline when the flag is off.
 */
export function JournalEntriesListPage() {
  const [page, setPage] = useState(0);
  const { data, isLoading, error } = useJournalEntries();

  const totalCount = data?.length ?? 0;
  const pageCount = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const pageStart = page * PAGE_SIZE;
  const pageRows = (data ?? []).slice(pageStart, pageStart + PAGE_SIZE);

  return (
    <section className="px-8 py-8 flex flex-col gap-6">
      <header className="flex items-center justify-between">
        <h1 className="text-4xl font-display tracking-wide text-ink">JOURNAL ENTRIES</h1>
        <Link to="/finance/journal-entries/new" className="px-4 py-2 bg-accent text-on-primary font-sans text-sm">New journal entry</Link>
      </header>

      {isLoading ? (
        <p className="text-ink-dim">Loading entries.</p>
      ) : error ? (
        <p className="text-accent font-sans">
          {(error as Error).message ||
            'Journal entries unavailable for this org.'}
        </p>
      ) : (
        <table className="w-full text-sm font-sans border-collapse">
          <thead>
            <tr className="text-left text-ink-dim border-b border-line">
              <th className="py-2">Number</th>
              <th className="py-2">Date</th>
              <th className="py-2">Period</th>
              <th className="py-2">Source</th>
              <th className="py-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {pageRows.map((je) => (
              <tr key={je.id} className="border-b border-line">
                <td className="py-2">
                  <Link
                    to={`/finance/journal-entries/${je.id}`}
                    className="text-ink hover:text-accent"
                  >
                    {je.entry_number}
                  </Link>
                </td>
                <td className="py-2 text-ink-dim">{je.entry_date}</td>
                <td className="py-2 text-ink-dim font-mono">
                  {je.period_year}-{String(je.period_month).padStart(2, '0')}
                </td>
                <td className="py-2 text-ink-dim uppercase">{je.source_type}</td>
                <td className="py-2 text-ink-dim uppercase">{je.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {totalCount > PAGE_SIZE ? (
        <nav className="flex items-center gap-3 font-sans text-sm" aria-label="Pagination">
          <button
            type="button"
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={page === 0}
            className="px-3 py-1 border border-line bg-bg-2 text-ink disabled:opacity-40"
          >
            Prev
          </button>
          <span className="text-ink-dim">
            {page + 1} of {pageCount}
          </span>
          <button
            type="button"
            onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
            disabled={page >= pageCount - 1}
            className="px-3 py-1 border border-line bg-bg-2 text-ink disabled:opacity-40"
          >
            Next
          </button>
        </nav>
      ) : null}
    </section>
  );
}
