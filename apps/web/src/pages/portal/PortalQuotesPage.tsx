// PortalQuotesPage.

import { Link } from 'react-router-dom';
import { usePortalQuotes } from '@/lib/hooks/useCrossCutting';

export function PortalQuotesPage() {
  const query = usePortalQuotes();
  return (
    <main className="min-h-screen bg-bg px-6 py-10">
      <h1 className="mx-auto mb-6 max-w-5xl font-display text-3xl tracking-wide text-ink">
        QUOTES
      </h1>
      <div className="mx-auto max-w-5xl">
        {query.isLoading ? (
          <p className="text-sm text-ink-dim">Loading.</p>
        ) : (query.data ?? []).length === 0 ? (
          <p className="text-sm text-ink-dim">No quotes yet.</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {(query.data ?? []).map((q) => (
              <li
                key={q.id}
                className="flex items-center justify-between border border-line px-3 py-2 text-sm"
              >
                <Link to={`/portal/quotes/${q.id}`} className="text-ink hover:underline">
                  {q.number}
                </Link>
                <span className="text-ink-dim">{q.status}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}
