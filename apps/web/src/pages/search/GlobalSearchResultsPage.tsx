// GlobalSearchResultsPage. Renders the grouped result set returned by
// /search-api/search.

import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import { useGlobalSearch } from '@/lib/hooks/useCrossCutting';

export function GlobalSearchResultsPage() {
  const [params] = useSearchParams();
  const q = params.get('q') ?? '';
  const query = useGlobalSearch(q);

  const totals = useMemo(() => {
    if (!query.data) return 0;
    return Object.values(query.data.groups).reduce(
      (sum, items) => sum + (items?.length ?? 0),
      0,
    );
  }, [query.data]);

  return (
    <section className="mx-auto max-w-5xl px-6 py-8">
      <header className="mb-6">
        <h1 className="font-display text-3xl tracking-wide text-ink">
          SEARCH RESULTS
        </h1>
        <p className="text-sm text-ink-dim">
          {q ? `Showing matches for "${q}".` : 'Enter a query to search.'}
        </p>
      </header>

      {!q ? null : query.isLoading ? (
        <p className="text-sm text-ink-dim">Searching.</p>
      ) : query.isError ? (
        <p className="text-sm text-ink-dim">Search is unavailable. Try again.</p>
      ) : totals === 0 ? (
        <p className="text-sm text-ink-dim">No results.</p>
      ) : (
        <div className="flex flex-col gap-6">
          {Object.entries(query.data?.groups ?? {}).map(([group, items]) =>
            items && items.length > 0 ? (
              <section key={group}>
                <h2 className="mb-2 font-display text-lg tracking-wider text-ink">
                  {group.toUpperCase()}
                </h2>
                <ul className="flex flex-col">
                  {items.map((it) => (
                    <li key={`${it.entity_type}-${it.entity_id}`} className="border-b border-line py-2">
                      <Link to={it.href} className="flex items-baseline justify-between text-sm">
                        <span className="font-medium text-ink">{it.title}</span>
                        {it.subtitle ? (
                          <span className="text-ink-dim">{it.subtitle}</span>
                        ) : null}
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null,
          )}
        </div>
      )}
    </section>
  );
}
