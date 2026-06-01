import { useState } from 'react';
import { Link } from 'react-router-dom';

import { ListEmptyState } from '@/components/shell/ListEmptyState';
import { usePayments } from '@/lib/hooks/usePayments';
import { formatCents } from '@/lib/money';

const PAGE_SIZE = 50;

/**
 * PaymentsListPage. Inflow ledger by received_at desc.
 */
export function PaymentsListPage() {
  const [page, setPage] = useState(0);
  const { data, isLoading, error } = usePayments();

  const totalCount = data?.length ?? 0;
  const pageCount = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const pageStart = page * PAGE_SIZE;
  const pageRows = (data ?? []).slice(pageStart, pageStart + PAGE_SIZE);

  return (
    <section className="px-8 py-8 flex flex-col gap-6">
      <header className="flex items-center justify-between">
        <h1 className="text-4xl font-display tracking-wide text-ink">PAYMENTS</h1>
        <Link to="/3pl-operations/payments/new" className="px-4 py-2 bg-accent text-on-primary font-sans text-sm">New payment</Link>
      </header>

      {isLoading ? (
        <p className="text-ink-dim">Loading payments.</p>
      ) : error ? (
        <p className="text-accent">Failed to load payments.</p>
      ) : (data?.length ?? 0) === 0 ? (
        <ListEmptyState
          entity="payment"
          explainer="Payments record cash received against an invoice."
          addLabel="Add payment"
          addTo="/3pl-operations/payments/new"
        />
      ) : (
        <table className="w-full text-sm font-sans border-collapse">
          <thead>
            <tr className="text-left text-ink-dim border-b border-line">
              <th className="py-2">Number</th>
              <th className="py-2">Received</th>
              <th className="py-2 text-right">Amount</th>
              <th className="py-2 text-right">Unapplied</th>
            </tr>
          </thead>
          <tbody>
            {pageRows.map((p) => (
              <tr key={p.id} className="border-b border-line">
                <td className="py-2">
                  <Link
                    to={`/invoicing/payments/${p.id}/apply`}
                    className="text-ink hover:text-accent"
                  >
                    {p.payment_number}
                  </Link>
                </td>
                <td className="py-2 text-ink-dim">
                  {new Date(p.received_at).toLocaleDateString()}
                </td>
                <td className="py-2 text-right">
                  {formatCents(p.amount_cents as number | string, p.currency_code)}
                </td>
                <td className="py-2 text-right">
                  {formatCents(p.unapplied_cents as number | string, p.currency_code)}
                </td>
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
