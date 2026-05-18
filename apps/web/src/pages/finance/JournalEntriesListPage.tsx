import { Link } from 'react-router-dom';

import { useJournalEntries } from '@/lib/hooks/useJournalEntries';

/**
 * JournalEntriesListPage. Reverse-chronological list. The per-route
 * finance.journal_entries.enabled flag is server-enforced; the SPA renders
 * the 403 message inline when the flag is off.
 */
export function JournalEntriesListPage() {
  const { data, isLoading, error } = useJournalEntries();

  return (
    <section className="px-8 py-8 flex flex-col gap-6">
      <header className="flex items-center justify-between">
        <h1 className="text-4xl font-display tracking-wide text-ink">JOURNAL ENTRIES</h1>
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
            {(data ?? []).map((je) => (
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
    </section>
  );
}
