// PortalInvoicesPage. Standalone listing of the customer's invoices.
//
// Same table chassis + formatters as the dashboard section. The standalone
// page exists for customers who want a focused view (e.g. bookmark
// /portal/invoices to land on just the billing list).
//
// F-Wave9-PORTAL-NAV-01: now wrapped in the shared PortalTopbar so the
// page is reachable from the dashboard and the customer can navigate
// between sections without backing out to /portal.

import { Button } from '@/components/ui/Button';
import { usePortalInvoices, usePortalMe } from '@/lib/hooks/useCrossCutting';
import { formatCents } from '@/lib/money';
import { formatDateMedium } from '@/lib/dates';
import { StatusBadge } from './components/StatusBadge';
import { PortalTopbar } from './components/PortalTopbar';
import { PortalInvoiceActions } from './components/PortalInvoiceActions';

interface PortalInvoiceRow {
  id: string;
  number: string;
  status: string;
  issued_at: string | null;
  due_at: string | null;
  total_cents: number | string;
  balance_cents: number | string;
  currency_code: string;
}

export function PortalInvoicesPage() {
  const me = usePortalMe();
  const query = usePortalInvoices();
  const rows = (query.data ?? []) as PortalInvoiceRow[];
  const customerDisplayName = me.data?.display_name ?? '';

  return (
    <>
      <PortalTopbar />
      <main className="min-h-screen bg-bg px-6 py-10">
        <h1 className="mx-auto mb-6 max-w-5xl font-display text-3xl tracking-wide text-ink">
          INVOICES
        </h1>
        <div className="mx-auto max-w-5xl">
          {query.isLoading ? (
            <p className="text-sm text-ink-dim">Loading invoices.</p>
          ) : query.isError ? (
            <div className="flex items-center justify-between border border-line bg-bg-2 px-4 py-3">
              <p className="text-sm text-accent">
                Could not load your invoices. Try again.
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
              No invoices yet. Your billing history will appear here.
            </p>
          ) : (
            <table className="w-full border border-line text-sm">
              <thead>
                <tr className="bg-bg-2 text-left text-ink-dim">
                  <th className="px-3 py-2">Number</th>
                  <th className="px-3 py-2">Issued</th>
                  <th className="px-3 py-2">Due</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2 text-right">Balance</th>
                  <th className="px-3 py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((inv) => (
                  <tr key={inv.id} className="border-t border-line">
                    <td className="px-3 py-2 font-mono text-ink">{inv.number}</td>
                    <td className="px-3 py-2 text-ink-dim">
                      {formatDateMedium(inv.issued_at)}
                    </td>
                    <td className="px-3 py-2 text-ink-dim">
                      {formatDateMedium(inv.due_at)}
                    </td>
                    <td className="px-3 py-2">
                      <StatusBadge status={inv.status} />
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-ink">
                      {formatCents(inv.balance_cents, inv.currency_code)}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <PortalInvoiceActions
                        invoiceId={inv.id}
                        invoiceNumber={inv.number}
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
