import { Link } from 'react-router-dom';

import { useCreditNotes } from '@/lib/hooks/useCreditNotes';
import { formatCents } from '@/lib/money';

/**
 * CreditNotesListPage. Lists credit notes for the active org.
 */
export function CreditNotesListPage() {
  const { data, isLoading, error } = useCreditNotes();

  return (
    <section className="px-8 py-8 flex flex-col gap-6">
      <header className="flex items-center justify-between">
        <h1 className="text-4xl font-display tracking-wide text-ink">CREDIT NOTES</h1>
      </header>

      {isLoading ? (
        <p className="text-ink-dim">Loading credit notes.</p>
      ) : error ? (
        <p className="text-accent">Failed to load credit notes.</p>
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
            {(data ?? []).map((cn) => (
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
    </section>
  );
}
