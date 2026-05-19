import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import { AuditTimeline } from '@/components/shell/AuditTimeline';
import { Button } from '@/components/ui/Button';
import { TextInput } from '@/components/ui/TextInput';
import { ItemPicker } from '@/components/ui/pickers';
import {
  useInvoice,
  useInvoiceLineItems,
  useCreateInvoiceLineItem,
  useDeleteInvoiceLineItem,
  useSendInvoice,
  useCancelInvoice,
} from '@/lib/hooks/useInvoices';
import { useCustomer } from '@/lib/hooks/useCustomer';
import { useProject } from '@/lib/hooks/useProjects';
import { useQuote } from '@/lib/hooks/useQuotes';
import { useItem } from '@/lib/hooks/useItems';
import { usePayments } from '@/lib/hooks/usePayments';
import { formatCents } from '@/lib/money';

/**
 * InvoiceDetailPage. Closes G-INV-DETAIL-01 and G-PAY-FLOW-01. Adds
 * customer / project / quote breadcrumbs, add-line form, payments section,
 * and a "Receive payment" CTA that pre-fills customer + invoice on the
 * PaymentCreatePage.
 */
export function InvoiceDetailPage() {
  const { id } = useParams();
  const invoiceId = id ?? '';
  const navigate = useNavigate();
  const invoice = useInvoice(invoiceId);
  const lines = useInvoiceLineItems(invoiceId);
  const addLine = useCreateInvoiceLineItem(invoiceId);
  const deleteLine = useDeleteInvoiceLineItem(invoiceId);
  const sendMutation = useSendInvoice();
  const cancelMutation = useCancelInvoice();

  const customerId = invoice.data?.customer_id ?? null;
  const projectId = invoice.data?.project_id ?? null;
  const sourceQuoteId = invoice.data?.quote_id ?? null;

  const customer = useCustomer(customerId ?? undefined);
  const project = useProject(projectId ?? undefined);
  const sourceQuote = useQuote(sourceQuoteId ?? undefined);
  const payments = usePayments(
    customerId ? { customer_id: customerId } : {},
  );

  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [lineDesc, setLineDesc] = useState('');
  const [lineQty, setLineQty] = useState('1');
  const [linePrice, setLinePrice] = useState('0');
  const [showAddLine, setShowAddLine] = useState(false);

  const selectedItem = useItem(selectedItemId ?? undefined);

  if (!invoiceId) return <p>Missing invoice id.</p>;
  if (invoice.isLoading) return <p className="px-8 py-8">Loading.</p>;
  if (invoice.error || !invoice.data)
    return <p className="px-8 py-8 text-accent">Invoice not found.</p>;

  const inv = invoice.data;
  const canSend = inv.status === 'draft' || inv.status === 'pending';
  const canCancel = ['draft', 'pending', 'sent', 'on_hold'].includes(inv.status);
  const canEditLines = inv.status === 'draft';
  const canReceivePayment = ['sent', 'partially_paid', 'overdue'].includes(inv.status);

  const onPickItem = (itemId: string | null) => {
    setSelectedItemId(itemId);
    if (itemId && selectedItem.data) {
      setLineDesc(selectedItem.data.name);
      setLinePrice(String(selectedItem.data.unit_price_cents));
    }
  };

  const onAddLine = (e: FormEvent) => {
    e.preventDefault();
    const qtyNum = Number(lineQty);
    const priceNum = Number(linePrice);
    const lineTotal = String(Math.round(qtyNum * priceNum));
    // F-Wave7-MUTATION-ERRORS-SWEEP-01: mutate(input, { onSuccess }) so a
    // 4xx surfaces in the inline error renderer below the form.
    addLine.mutate(
      {
        description: lineDesc,
        quantity: lineQty,
        unit_price_cents: linePrice,
        line_total_cents: lineTotal,
        ...(selectedItemId ? { item_id: selectedItemId } : {}),
      },
      {
        onSuccess: () => {
          setSelectedItemId(null);
          setLineDesc('');
          setLineQty('1');
          setLinePrice('0');
          setShowAddLine(false);
        },
      },
    );
  };

  const onReceivePayment = () => {
    const params = new URLSearchParams();
    if (customerId) params.set('customer_id', customerId);
    params.set('invoice_id', invoiceId);
    navigate(`/3pl-operations/payments/new?${params.toString()}`);
  };

  const invoicePayments = (payments.data ?? []).filter((p) =>
    // Payments are listed by customer; the per-invoice allocation requires a
    // join over payment_allocations which is not yet on the SPA. Show all
    // customer payments and label the link for the operator to follow.
    p.customer_id === customerId,
  );

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
          <div className="text-ink-dim text-sm mt-2 flex flex-col gap-1">
            {customerId && (
              <span>
                Customer:{' '}
                <Link
                  to={`/crm/customers/${customerId}`}
                  className="text-ink hover:text-accent"
                >
                  {customer.data?.display_name ?? customerId}
                </Link>
              </span>
            )}
            {projectId && (
              <span>
                Project:{' '}
                <Link
                  to={`/3pl-operations/projects/${projectId}`}
                  className="text-ink hover:text-accent"
                >
                  {project.data?.project.number ?? projectId}
                </Link>
              </span>
            )}
            {sourceQuoteId && (
              <span>
                Source quote:{' '}
                <Link
                  to={`/3pl-operations/quotes/${sourceQuoteId}`}
                  className="text-ink hover:text-accent"
                >
                  {sourceQuote.data?.quote.number ?? sourceQuoteId}
                </Link>
              </span>
            )}
          </div>
        </div>
        <div className="flex gap-2 flex-wrap">
          {canSend && (
            <Button onClick={() => sendMutation.mutate(invoiceId)} disabled={sendMutation.isPending}>
              Send
            </Button>
          )}
          {canReceivePayment && (
            <Button onClick={onReceivePayment} variant="secondary">
              Receive payment
            </Button>
          )}
          {canCancel && (
            <Button
              variant="ghost"
              onClick={() => cancelMutation.mutate(invoiceId)}
              disabled={cancelMutation.isPending}
            >
              Cancel
            </Button>
          )}
        </div>
      </header>

      {(sendMutation.error || cancelMutation.error) && (
        <p className="font-sans text-sm text-accent">
          {(sendMutation.error instanceof Error && sendMutation.error.message) ||
            (cancelMutation.error instanceof Error && cancelMutation.error.message) ||
            'Action failed.'}
        </p>
      )}

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Stat label="Subtotal" value={formatCents(inv.subtotal_cents, inv.currency_code)} />
        <Stat label="Tax" value={formatCents(inv.tax_total_cents, inv.currency_code)} />
        <Stat label="Paid" value={formatCents(inv.paid_cents, inv.currency_code)} />
        <Stat label="Balance" value={formatCents(inv.balance_cents, inv.currency_code)} />
      </div>

      <section>
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="text-2xl font-display tracking-wide text-ink">LINE ITEMS</h2>
          {canEditLines && !showAddLine && (
            <Button variant="secondary" onClick={() => setShowAddLine(true)}>
              Add line
            </Button>
          )}
        </div>
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
                <th className="py-2"></th>
              </tr>
            </thead>
            <tbody>
              {(lines.data ?? []).map((l) => (
                <tr key={l.id} className="border-b border-line">
                  <td className="py-2">{l.description}</td>
                  <td className="py-2 text-right">{String(l.quantity)}</td>
                  <td className="py-2 text-right">
                    {formatCents(l.unit_price_cents, inv.currency_code)}
                  </td>
                  <td className="py-2 text-right">{String(l.tax_rate_snapshot)}</td>
                  <td className="py-2 text-right">
                    {formatCents(l.line_total_cents, inv.currency_code)}
                  </td>
                  <td className="py-2 text-right">
                    {canEditLines && (
                      <Button variant="ghost" onClick={() => deleteLine.mutate(l.id)}>
                        Remove
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {canEditLines && showAddLine && (
          <form
            onSubmit={onAddLine}
            className="flex flex-col gap-3 border border-line p-4 mt-4"
          >
            <h3 className="font-display tracking-wider text-ink">ADD LINE</h3>
            <ItemPicker
              value={selectedItemId}
              onChange={onPickItem}
              label="Item (optional, pre-fills description and price)"
              filter={{ active: true }}
            />
            <div className="flex gap-3 flex-wrap items-end">
              <TextInput
                label="Description"
                value={lineDesc}
                onChange={(e) => setLineDesc(e.target.value)}
                required
              />
              <TextInput
                label="Qty"
                value={lineQty}
                onChange={(e) => setLineQty(e.target.value)}
                inputMode="decimal"
              />
              <TextInput
                label="Unit price (cents)"
                value={linePrice}
                onChange={(e) => setLinePrice(e.target.value)}
                inputMode="numeric"
              />
              <Button type="submit" disabled={addLine.isPending}>
                {addLine.isPending ? 'Adding.' : 'Add'}
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setShowAddLine(false)}
              >
                Cancel
              </Button>
            </div>
            {addLine.error && (
              <p className="font-sans text-sm text-accent">
                {addLine.error instanceof Error
                  ? addLine.error.message
                  : 'Add line failed.'}
              </p>
            )}
          </form>
        )}
      </section>

      <section>
        <h2 className="text-2xl font-display tracking-wide text-ink mb-3">PAYMENTS</h2>
        {!customerId ? (
          <p className="text-ink-dim text-sm">
            Attach a customer to surface payments.
          </p>
        ) : invoicePayments.length === 0 ? (
          <p className="text-ink-dim text-sm">
            No payments received from this customer yet.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {invoicePayments.map((p) => (
              <li
                key={p.id}
                className="border border-line p-3 flex items-baseline justify-between"
              >
                <span className="font-mono text-sm text-ink">{p.payment_number}</span>
                <span className="text-ink-dim text-sm">
                  {formatCents(p.amount_cents, p.currency_code)} ·{' '}
                  unapplied {formatCents(p.unapplied_cents, p.currency_code)}
                </span>
              </li>
            ))}
          </ul>
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
