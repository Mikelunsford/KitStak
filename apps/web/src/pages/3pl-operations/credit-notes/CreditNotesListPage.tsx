import { useState } from 'react';
import { Link } from 'react-router-dom';

import { ListEmptyState } from '@/components/shell/ListEmptyState';
import { useCreditNotes } from '@/lib/hooks/useCreditNotes';
import { formatCents } from '@/lib/money';

const PAGE_SIZE = 50;

/**
 * CreditNotesListPage. Lists credit notes for the active org.
 */
export function CreditNotesListPage() {
  const [page, setPage] = useState(0);
  const { data, isLoading, error } = useCreditNotes();

  const totalCount = data?.length ?? 0;
  const pageCount = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const pageStart = page * PAGE_SIZE;
  const pageRows = (data ?? []).slice(pageStart, pageStart + PAGE_SIZE);

  return (
    <section className="px-8 py-8 flex flex-col gap-6">
      <header className="flex items-center justify-between">
        <h1 className="text-4xl font-display tracking-wide text-ink">CREDIT NOTES</h1>
        <Link to="/3pl-operations/credit-notes/new" className="px-4 py-2 bg-accent text-on-primary font-sans text-sm">New credit note</Link>
      </header>

      {isLoading ? (
        <p className="text-ink-dim">Loading credit notes.</p>
      ) : error ? (
        <p className="text-accent">Failed to load credit notes.</p>
      ) : (data?.length ?? 0) === 0 ? (
        <ListEmptyState
          entity="credit note"
          explainer="Credit notes reverse part or all of an invoice."
          addLabel="Add credit note"
          addTo="/3pl-operations/credit-notes/new"
        />
      ) : (
        <table className="w-full text-sm font-sans border-collapse">
          <thead>
            <tr className="text-left text-ink-dim border-b border-line">
              <th className="py-2">Number</th>
              <th className="py-2">Status</th>
              <th className="py-2 text-right">Amount</th>
              <th className="py-2 text-right">Applied</th>
            </tr>
          </thead>
          <tbody>
            {pageRows.map((cn) => (
              <tr key={cn.id} className="border-b border-line">
                <td className="py-2">
                  <Link
                    to={`/invoicing/credit-notes/${cn.id}`}
                    className="text-ink hover:text-accent"
                  >
                    {cn.credit_note_number}
                  </Link>
                </td>
                <td className="py-2 uppercase text-ink-dim">{cn.status}</td>
                <td className="py-2 text-right">
                  {formatCents(cn.amount_cents as number | string, cn.currency_code)}
                </td>
                <td className="py-2 text-right">
                  {formatCents(cn.applied_cents as number | string, cn.currency_code)}
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
