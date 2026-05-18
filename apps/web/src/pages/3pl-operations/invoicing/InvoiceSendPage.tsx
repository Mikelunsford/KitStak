import { useParams, useNavigate } from 'react-router-dom';

import { useInvoice, useSendInvoice } from '@/lib/hooks/useInvoices';
import { formatCents } from '@/lib/money';

/**
 * InvoiceSendPage. Confirms the send action before transitioning the invoice
 * to sent. The auto-JE trigger fires on the DB side once the row flips state.
 */
export function InvoiceSendPage() {
  const { id } = useParams();
  const invoiceId = id ?? '';
  const navigate = useNavigate();
  const invoice = useInvoice(invoiceId);
  const send = useSendInvoice();

  if (!invoiceId) return <p>Missing invoice id.</p>;
  if (invoice.isLoading) return <p className="px-8 py-8">Loading.</p>;
  if (invoice.error || !invoice.data)
    return <p className="px-8 py-8 text-accent">Invoice not found.</p>;

  const inv = invoice.data;

  async function onConfirm() {
    try {
      await send.mutateAsync(invoiceId);
      navigate(`/invoicing/invoices/${invoiceId}`);
    } catch {
      // surfaced via mutation state
    }
  }

  return (
    <section className="px-8 py-8 max-w-xl flex flex-col gap-6">
      <h1 className="text-4xl font-display tracking-wide text-ink">SEND INVOICE</h1>
      <p className="font-sans text-ink-dim">
        Sending {inv.invoice_number} for{' '}
        {formatCents(inv.total_cents as number | string, inv.currency_code)} will
        post the auto-journal entry when the finance feature is on for this org.
      </p>
      {send.error && (
        <p className="text-accent font-sans text-sm">
          {(send.error as Error).message}
        </p>
      )}
      <div className="flex gap-2">
        <button
          type="button"
          disabled={send.isPending}
          onClick={onConfirm}
          className="px-4 py-2 bg-accent text-on-primary font-display tracking-wider text-sm disabled:opacity-50"
        >
          CONFIRM SEND
        </button>
        <button
          type="button"
          onClick={() => navigate(`/invoicing/invoices/${invoiceId}`)}
          className="px-4 py-2 border border-line text-ink font-display tracking-wider text-sm"
        >
          CANCEL
        </button>
      </div>
    </section>
  );
}
