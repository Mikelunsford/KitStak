import { Link } from 'react-router-dom';

import { Button } from '@/components/ui/Button';
import { useQuotesList } from '@/lib/hooks/useQuotes';
import { formatCents } from '@/lib/money';

export function QuotesListPage() {
  const { data, isLoading, error } = useQuotesList();
  return (
    <section className="px-8 py-12 max-w-6xl mx-auto flex flex-col gap-6">
      <header className="flex items-center justify-between">
        <h1 className="text-4xl font-display tracking-wide text-ink">QUOTES</h1>
        <Link to="/3pl-operations/quotes/new">
          <Button variant="primary">New Quote</Button>
        </Link>
      </header>
      {isLoading && <p className="text-ink-dim">Loading.</p>}
      {error && <p className="text-accent">Failed to load quotes.</p>}
      {data && (
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
