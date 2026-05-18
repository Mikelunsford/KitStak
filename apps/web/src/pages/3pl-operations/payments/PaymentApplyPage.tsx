import { useState, type FormEvent } from 'react';
import { useParams, useNavigate } from 'react-router-dom';

import { useApplyPayment, usePayment } from '@/lib/hooks/usePayments';
import { useInvoices } from '@/lib/hooks/useInvoices';
import { formatCents } from '@/lib/money';

/**
 * PaymentApplyPage. Single-form allocation: amount per invoice id. The full
 * picker UI ships later; Wave 2 takes a JSON-style list to validate the
 * server side of the contract.
 */
export function PaymentApplyPage() {
  const { id } = useParams();
  const paymentId = id ?? '';
  const navigate = useNavigate();
  const payment = usePayment(paymentId);
  const invoices = useInvoices({ status: 'sent' });
  const apply = useApplyPayment();

  const [allocations, setAllocations] = useState<
    Array<{ invoice_id: string; amount_cents: string }>
  >([{ invoice_id: '', amount_cents: '0' }]);

  function setAlloc(i: number, key: 'invoice_id' | 'amount_cents', v: string) {
    setAllocations((prev) => {
      const next = [...prev];
      next[i] = { ...next[i]!, [key]: v };
      return next;
    });
  }

  function addRow() {
    setAllocations((prev) => [...prev, { invoice_id: '', amount_cents: '0' }]);
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!paymentId) return;
    try {
      await apply.mutateAsync({
        id: paymentId,
        body: {
          allocations: allocations
            .filter((a) => a.invoice_id && a.amount_cents)
            .map((a) => ({
              invoice_id: a.invoice_id,
              amount_cents: a.amount_cents,
            })),
        },
      });
      navigate('/invoicing/payments');
    } catch {
      // surfaced via mutation state
    }
  }

  if (payment.isLoading) return <p className="px-8 py-8">Loading.</p>;
  if (payment.error || !payment.data)
    return <p className="px-8 py-8 text-accent">Payment not found.</p>;

  return (
    <section className="px-8 py-8 max-w-2xl flex flex-col gap-6">
      <h1 className="text-4xl font-display tracking-wide text-ink">APPLY PAYMENT</h1>
      <p className="font-sans text-ink-dim">
        Allocating {payment.data.payment_number} (
        {formatCents(payment.data.amount_cents as number | string, payment.data.currency_code)}
        ). Unapplied:{' '}
        {formatCents(payment.data.unapplied_cents as number | string, payment.data.currency_code)}.
      </p>

      <form className="flex flex-col gap-3" onSubmit={onSubmit}>
        {allocations.map((a, i) => (
          <div key={i} className="flex gap-2">
            <select
              value={a.invoice_id}
              onChange={(e) => setAlloc(i, 'invoice_id', e.target.value)}
              className="flex-1 bg-bg-2 border border-line px-3 py-2 text-ink font-sans"
            >
              <option value="">Select invoice</option>
              {(invoices.data ?? []).map((inv) => (
                <option key={inv.id} value={inv.id}>
                  {inv.invoice_number}
                </option>
              ))}
            </select>
            <input
              type="text"
              value={a.amount_cents}
              onChange={(e) => setAlloc(i, 'amount_cents', e.target.value)}
              placeholder="Amount cents"
              className="w-40 bg-bg-2 border border-line px-3 py-2 text-ink font-mono"
            />
          </div>
        ))}
        <button
          type="button"
          onClick={addRow}
          className="self-start px-3 py-1 border border-line text-ink text-xs font-display tracking-wider"
        >
          + ADD LINE
        </button>

        {apply.error && (
          <p className="text-accent font-sans text-sm">
            {(apply.error as Error).message}
          </p>
        )}

        <div className="flex gap-2">
          <button
            type="submit"
            disabled={apply.isPending}
            className="px-4 py-2 bg-accent text-on-primary font-display tracking-wider text-sm disabled:opacity-50"
          >
            APPLY
          </button>
        </div>
      </form>
    </section>
  );
}
