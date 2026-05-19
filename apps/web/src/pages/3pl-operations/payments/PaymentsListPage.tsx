import { Link } from 'react-router-dom';

import { usePayments } from '@/lib/hooks/usePayments';
import { formatCents } from '@/lib/money';

/**
 * PaymentsListPage. Inflow ledger by received_at desc.
 */
export function PaymentsListPage() {
  const { data, isLoading, error } = usePayments();

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
            {(data ?? []).map((p) => (
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
    </section>
  );
}
