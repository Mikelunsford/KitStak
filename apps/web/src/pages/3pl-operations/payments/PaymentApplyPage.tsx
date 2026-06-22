import { useState, type FormEvent } from 'react';
import { useParams, useNavigate } from 'react-router-dom';

import { Button } from '@/components/ui/Button';
import { PageHeader } from '@/components/ui/PageHeader';
import { Select } from '@/components/ui/Select';
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
    <section className="mx-auto flex max-w-2xl flex-col gap-6 px-8 py-8">
      <PageHeader title="Apply payment" />
      <p className="font-sans text-ink-dim">
        Allocating {payment.data.payment_number} (
        {formatCents(payment.data.amount_cents as number | string, payment.data.currency_code)}
        ). Unapplied:{' '}
        {formatCents(payment.data.unapplied_cents as number | string, payment.data.currency_code)}.
      </p>

      <form className="flex flex-col gap-3" onSubmit={onSubmit}>
        {allocations.map((a, i) => (
          <div key={i} className="flex gap-2">
            <Select
              className="flex-1"
              value={a.invoice_id}
              onChange={(e) => setAlloc(i, 'invoice_id', e.target.value)}
            >
              <option value="">Select invoice</option>
              {(invoices.data ?? []).map((inv) => (
                <option key={inv.id} value={inv.id}>
                  {inv.invoice_number}
                </option>
              ))}
            </Select>
            <input
              type="text"
              value={a.amount_cents}
              onChange={(e) => setAlloc(i, 'amount_cents', e.target.value)}
              placeholder="Amount cents"
              className="w-40 bg-bg-2 border border-line px-3 py-2 text-ink tabular-nums"
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
          <Button type="submit" variant="primary" disabled={apply.isPending}>
            APPLY
          </Button>
        </div>
      </form>
    </section>
  );
}
