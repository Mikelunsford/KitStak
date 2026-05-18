import { useState, type FormEvent } from 'react';
import { useParams, useNavigate } from 'react-router-dom';

import { useApplyCreditNote, useCreditNote } from '@/lib/hooks/useCreditNotes';
import { useInvoices } from '@/lib/hooks/useInvoices';
import { formatCents } from '@/lib/money';

export function CreditNoteApplyPage() {
  const { id } = useParams();
  const creditNoteId = id ?? '';
  const navigate = useNavigate();
  const cn = useCreditNote(creditNoteId);
  const invoices = useInvoices({ status: 'sent' });
  const apply = useApplyCreditNote();

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
    if (!creditNoteId) return;
    try {
      await apply.mutateAsync({
        id: creditNoteId,
        body: {
          allocations: allocations
            .filter((a) => a.invoice_id && a.amount_cents)
            .map((a) => ({ invoice_id: a.invoice_id, amount_cents: a.amount_cents })),
        },
      });
      navigate(`/invoicing/credit-notes/${creditNoteId}`);
    } catch {
      // surfaced via mutation state
    }
  }

  if (cn.isLoading) return <p className="px-8 py-8">Loading.</p>;
  if (cn.error || !cn.data)
    return <p className="px-8 py-8 text-accent">Credit note not found.</p>;

  return (
    <section className="px-8 py-8 max-w-2xl flex flex-col gap-6">
      <h1 className="text-4xl font-display tracking-wide text-ink">APPLY CREDIT NOTE</h1>
      <p className="font-sans text-ink-dim">
        Applying {cn.data.credit_note_number} (
        {formatCents(cn.data.amount_cents as number | string, cn.data.currency_code)}). Already applied:{' '}
        {formatCents(cn.data.applied_cents as number | string, cn.data.currency_code)}.
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
