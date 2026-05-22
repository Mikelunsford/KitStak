import { Link, useSearchParams } from 'react-router-dom';

import { ListEmptyState } from '@/components/shell/ListEmptyState';
import { Button } from '@/components/ui/Button';
import { useQuotesList } from '@/lib/hooks/useQuotes';
import { formatCents } from '@/lib/money';

// Quote states the list page accepts via ?state=. Mirrored from
// QuoteStateSchema to avoid passing an arbitrary string to the wire
// (matches PR #103's parseEntityTypeParam validation approach).
const ALLOWED_QUOTE_STATES = new Set<string>([
  'draft',
  'submitted',
  'revise_requested',
  'approved',
  'project_pending',
  'cancelled',
]);

function parseStateParam(raw: string | null): string | undefined {
  if (!raw) return undefined;
  return ALLOWED_QUOTE_STATES.has(raw) ? raw : undefined;
}

export function QuotesListPage() {
  // UX-Q5: support ?state= deep-links from the dashboard work card
  // ("Quotes awaiting approval" -> ?state=submitted). Invalid values fall
  // back to the unfiltered list rather than rejecting the navigation.
  const [searchParams] = useSearchParams();
  const stateFilter = parseStateParam(searchParams.get('state'));

  const { data, isLoading, error } = useQuotesList(
    stateFilter ? { state: stateFilter } : {},
  );
  return (
    <section className="px-8 py-12 max-w-6xl mx-auto flex flex-col gap-6">
      <header className="flex items-center justify-between">
        <h1 className="text-4xl font-display tracking-wide text-ink">QUOTES</h1>
        <Link to="/3pl-operations/quotes/new">
          <Button variant="primary">New Quote</Button>
        </Link>
      </header>
      {stateFilter ? (
        <p className="text-xs font-sans uppercase tracking-wider text-ink-dim">
          Filtering by state: {stateFilter}
        </p>
      ) : null}
      {isLoading && <p className="text-ink-dim">Loading.</p>}
      {error && <p className="text-accent">Failed to load quotes.</p>}
      {data && data.length === 0 && !stateFilter ? (
        <ListEmptyState
          entity="quote"
          explainer="Quotes are priced proposals for a customer order."
          addLabel="Add quote"
          addTo="/3pl-operations/quotes/new"
        />
      ) : null}
      {data && data.length > 0 && (
        <table className="w-full border border-line">
          <thead className="bg-bg-2 text-left text-sm font-display tracking-wider text-ink">
            <tr>
              <th className="px-4 py-2">Number</th>
              <th className="px-4 py-2">Title</th>
              <th className="px-4 py-2">State</th>
              <th className="px-4 py-2">Total</th>
            </tr>
          </thead>
          <tbody>
            {data.map((q) => (
              <tr key={q.id} className="border-t border-line">
                <td className="px-4 py-2 font-mono text-sm">
                  <Link to={`/3pl-operations/quotes/${q.id}`} className="text-ink hover:text-accent">
                    {q.number}
                  </Link>
                </td>
                <td className="px-4 py-2">{q.title ?? '.'}</td>
                <td className="px-4 py-2">{q.state}</td>
                <td className="px-4 py-2 font-mono text-sm">
                  {formatCents(q.total_cents, q.currency_code)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
