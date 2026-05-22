import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import { ListEmptyState } from '@/components/shell/ListEmptyState';
import { useInvoices } from '@/lib/hooks/useInvoices';
import { formatCents } from '@/lib/money';

const ALLOWED_INVOICE_STATUSES = new Set<string>([
  'draft',
  'sent',
  'partially_paid',
  'paid',
  'overdue',
  'cancelled',
]);

function parseInvoiceStatusParam(raw: string | null): string | undefined {
  if (raw && ALLOWED_INVOICE_STATUSES.has(raw)) return raw;
  return undefined;
}

/**
 * InvoicesListPage. Lists invoices in the active org. Status filter chips,
 * paginated through TanStack Query. The full ledger view ships with sorting
 * and customer filter in a later wave; Wave 2 focuses on chassis correctness.
 *
 * UX-Q5: accepts ?status= deep-links from the dashboard work card
 * ("Unpaid invoices" -> ?status=sent). The filter is captured into local
 * state on mount so the operator can change it via the chips.
 */
export function InvoicesListPage() {
  const [searchParams] = useSearchParams();
  const [status, setStatus] = useState<string | undefined>(() =>
    parseInvoiceStatusParam(searchParams.get('status')),
  );
  const { data, isLoading, error } = useInvoices(status ? { status } : {});

  return (
    <section className="px-8 py-8 flex flex-col gap-6">
      <header className="flex items-center justify-between">
        <h1 className="text-4xl font-display tracking-wide text-ink">INVOICES</h1>
        <Link
          to="/invoicing/invoices/new"
          className="px-4 py-2 bg-accent text-on-primary font-display tracking-wider text-sm"
        >
          NEW INVOICE
        </Link>
      </header>

      <nav className="flex gap-2 flex-wrap" aria-label="Filter by status">
        {[undefined, 'draft', 'sent', 'partially_paid', 'paid', 'overdue', 'cancelled'].map(
          (s) => (
            <button
              key={s ?? 'all'}
              type="button"
              className={
                'px-3 py-1 border border-line text-xs font-sans uppercase ' +
                (status === s ? 'bg-ink text-bg' : 'bg-bg-2 text-ink')
              }
              onClick={() => setStatus(s)}
            >
              {s ?? 'all'}
            </button>
          ),
        )}
      </nav>

      {isLoading ? (
        <p className="text-ink-dim">Loading invoices.</p>
      ) : error ? (
        <p className="text-accent">Failed to load invoices.</p>
      ) : (data?.length ?? 0) === 0 && !status ? (
        <ListEmptyState
          entity="invoice"
          explainer="Invoices bill a customer for delivered work."
          addLabel="Add invoice"
          addTo="/invoicing/invoices/new"
        />
      ) : (
        <table className="w-full text-sm font-sans border-collapse">
          <thead>
            <tr className="text-left text-ink-dim border-b border-line">
              <th className="py-2">Number</th>
              <th className="py-2">Status</th>
              <th className="py-2">Issue date</th>
              <th className="py-2 text-right">Total</th>
              <th className="py-2 text-right">Balance</th>
            </tr>
          </thead>
          <tbody>
            {(data ?? []).map((inv) => (
              <tr key={inv.id} className="border-b border-line">
                <td className="py-2">
                  <Link
                    to={`/invoicing/invoices/${inv.id}`}
                    className="text-ink hover:text-accent"
                  >
                    {inv.invoice_number}
                  </Link>
                </td>
                <td className="py-2 uppercase text-ink-dim">{inv.status}</td>
                <td className="py-2 text-ink-dim">{inv.issue_date ?? '-'}</td>
                <td className="py-2 text-right">
                  {formatCents(inv.total_cents as number | string, inv.currency_code)}
                </td>
                <td className="py-2 text-right">
                  {formatCents(inv.balance_cents as number | string, inv.currency_code)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
