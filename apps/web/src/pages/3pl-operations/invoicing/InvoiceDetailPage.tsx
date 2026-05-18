import { useParams } from 'react-router-dom';

import { AuditTimeline } from '@/components/shell/AuditTimeline';
import {
  useInvoice,
  useInvoiceLineItems,
  useSendInvoice,
  useCancelInvoice,
} from '@/lib/hooks/useInvoices';
import { formatCents } from '@/lib/money';

/**
 * InvoiceDetailPage. Header, line items, balance summary, and the
 * AuditTimeline component bound to entity_type='invoice'. The send and cancel
 * actions are guarded server-side; the SPA hides them when status forbids.
 */
export function InvoiceDetailPage() {
  const { id } = useParams();
  const invoiceId = id ?? '';
  const invoice = useInvoice(invoiceId);
  const lines = useInvoiceLineItems(invoiceId);
  const sendMutation = useSendInvoice();
  const cancelMutation = useCancelInvoice();

  if (!invoiceId) return <p>Missing invoice id.</p>;
  if (invoice.isLoading) return <p className="px-8 py-8">Loading.</p>;
  if (invoice.error || !invoice.data)
    return <p className="px-8 py-8 text-accent">Invoice not found.</p>;

  const inv = invoice.data;
  const canSend = inv.status === 'draft' || inv.status === 'pending';
  const canCancel = ['draft', 'pending', 'sent', 'on_hold'].includes(inv.status);

  return (
    <section className="px-8 py-8 flex flex-col gap-8">
      <header className="flex items-center justify-between">
        <div>
          <p className="text-xs uppercase text-ink-dim font-sans">Invoice</p>
          <h1 className="text-4xl font-display tracking-wide text-ink">
            {inv.invoice_number}
          </h1>
          <p className="text-ink-dim font-sans uppercase text-xs mt-1">
            Status: {inv.status}
          </p>
        </div>
        <div className="flex gap-2">
          {canSend && (
            <button
              type="button"
              className="px-4 py-2 bg-accent text-on-primary font-display tracking-wider text-sm disabled:opacity-50"
              onClick={() => sendMutation.mutate(invoiceId)}
              disabled={sendMutation.isPending}
            >
              SEND
            </button>
          )}
          {canCancel && (
            <button
              type="button"
              className="px-4 py-2 border border-line text-ink font-display tracking-wider text-sm disabled:opacity-50"
              onClick={() => cancelMutation.mutate(invoiceId)}
              disabled={cancelMutation.isPending}
            >
              CANCEL
            </button>
          )}
        </div>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Stat label="Subtotal" value={formatCents(inv.subtotal_cents as number | string, inv.currency_code)} />
        <Stat label="Tax" value={formatCents(inv.tax_total_cents as number | string, inv.currency_code)} />
        <Stat label="Paid" value={formatCents(inv.paid_cents as number | string, inv.currency_code)} />
        <Stat label="Balance" value={formatCents(inv.balance_cents as number | string, inv.currency_code)} />
      </div>

      <section>
        <h2 className="text-2xl font-display tracking-wide text-ink mb-3">LINE ITEMS</h2>
        {lines.isLoading ? (
          <p className="text-ink-dim">Loading lines.</p>
        ) : (
          <table className="w-full text-sm font-sans border-collapse">
            <thead>
              <tr className="text-left text-ink-dim border-b border-line">
                <th className="py-2">Description</th>
                <th className="py-2 text-right">Qty</th>
                <th className="py-2 text-right">Unit</th>
                <th className="py-2 text-right">Tax rate</th>
                <th className="py-2 text-right">Line total</th>
              </tr>
            </thead>
            <tbody>
              {(lines.data ?? []).map((l) => (
                <tr key={l.id} className="border-b border-line">
                  <td className="py-2">{l.description}</td>
                  <td className="py-2 text-right">{String(l.quantity)}</td>
                  <td className="py-2 text-right">
                    {formatCents(l.unit_price_cents as number | string, inv.currency_code)}
                  </td>
                  <td className="py-2 text-right">{String(l.tax_rate_snapshot)}</td>
                  <td className="py-2 text-right">
                    {formatCents(l.line_total_cents as number | string, inv.currency_code)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section>
        <h2 className="text-2xl font-display tracking-wide text-ink mb-3">HISTORY</h2>
        <AuditTimeline entityType="invoice" entityId={invoiceId} />
      </section>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-bg-2 border border-line p-4">
      <p className="text-xs uppercase text-ink-dim font-sans">{label}</p>
      <p className="text-2xl font-mono text-ink">{value}</p>
    </div>
  );
}
