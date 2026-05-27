// PortalQuotesPage. Standalone listing of the customer's quotes.
//
// F-Wave9-PORTAL-NAV-01: now wrapped in PortalTopbar.
// F-Wave9-PORTAL-NO-ACTION-WIRING-01: each row gets a Download PDF action.

import { Button } from '@/components/ui/Button';
import { usePortalMe, usePortalQuotes } from '@/lib/hooks/useCrossCutting';
import { formatCents } from '@/lib/money';
import { formatDateMedium } from '@/lib/dates';
import { StatusBadge } from './components/StatusBadge';
import { PortalTopbar } from './components/PortalTopbar';
import { PortalQuoteActions } from './components/PortalQuoteActions';

interface PortalQuoteRow {
  id: string;
  number: string;
  status: string;
  issued_at: string | null;
  expires_at: string | null;
  total_cents: number | string;
  currency_code: string;
}

export function PortalQuotesPage() {
  const me = usePortalMe();
  const query = usePortalQuotes();
  const rows = (query.data ?? []) as PortalQuoteRow[];
  const customerDisplayName = me.data?.display_name ?? '';

  return (
    <>
      <PortalTopbar />
      <main className="min-h-screen bg-bg px-6 py-10">
        <h1 className="mx-auto mb-6 max-w-5xl font-display text-3xl tracking-wide text-ink">
          QUOTES
        </h1>
        <div className="mx-auto max-w-5xl">
          {query.isLoading ? (
            <p className="text-sm text-ink-dim">Loading quotes.</p>
          ) : query.isError ? (
            <div className="flex items-center justify-between border border-line bg-bg-2 px-4 py-3">
              <p className="text-sm text-accent">
                Could not load your quotes. Try again.
              </p>
              <Button
                onClick={() => query.refetch()}
                variant="secondary"
                className="px-3 py-1 text-sm"
              >
                Retry
              </Button>
            </div>
          ) : rows.length === 0 ? (
            <p className="border border-dashed border-line px-4 py-6 text-center text-sm text-ink-dim">
              No quotes yet. Approved quotes that turn into projects will show up here.
            </p>
          ) : (
            <table className="w-full border border-line text-sm">
              <thead>
                <tr className="bg-bg-2 text-left text-ink-dim">
                  <th className="px-3 py-2">Number</th>
                  <th className="px-3 py-2">Issued</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2 text-right">Total</th>
                  <th className="px-3 py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((q) => (
                  <tr key={q.id} className="border-t border-line">
                    <td className="px-3 py-2 font-mono text-ink">{q.number}</td>
                    <td className="px-3 py-2 text-ink-dim">
                      {formatDateMedium(q.issued_at)}
                    </td>
                    <td className="px-3 py-2">
                      <StatusBadge status={q.status} />
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-ink">
                      {formatCents(q.total_cents, q.currency_code)}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <PortalQuoteActions
                        quoteId={q.id}
                        quoteNumber={q.number}
                        customerDisplayName={customerDisplayName}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </main>
    </>
  );
}
