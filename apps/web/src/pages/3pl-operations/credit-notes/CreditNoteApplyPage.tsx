// CreditNoteApplyPage. Migration to the shared UI kit (F-Wave10-UI-KIT-01,
// 3PL CRUD tail): PageHeader replaces the hand-rolled title, the allocation
// invoice picker becomes the kit Select, and the Add-line / Apply buttons
// become the kit Button. The allocation logic, the sent-invoice scope, and the
// raw integer-cents amount inputs are preserved verbatim. The missing status
// guard (apply renders regardless of FSM state) is intentionally left as-is;
// F-Wave10-CREDIT-NOTE-APPLY-FSM-01 owns adding the canApply gate.

import { useState, type FormEvent } from 'react';
import { useParams, useNavigate } from 'react-router-dom';

import { Button } from '@/components/ui/Button';
import { PageHeader } from '@/components/ui/PageHeader';
import { Select } from '@/components/ui/Select';
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
            .map((a) => ({
              invoice_id: a.invoice_id,
              amount_cents: a.amount_cents,
            })),
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
    <section className="mx-auto flex max-w-2xl flex-col gap-6 px-8 py-12">
      <PageHeader eyebrow="Invoicing / Credit notes" title="Apply credit note" />
      <p className="font-sans text-ink-dim">
        Applying {cn.data.credit_note_number} (
        {formatCents(
          cn.data.amount_cents as number | string,
          cn.data.currency_code,
        )}
        ). Already applied:{' '}
        {formatCents(
          cn.data.applied_cents as number | string,
          cn.data.currency_code,
        )}
        .
      </p>

      <form className="flex flex-col gap-3" onSubmit={onSubmit}>
        {allocations.map((a, i) => (
          <div key={i} className="flex gap-2">
            <Select
              value={a.invoice_id}
              onChange={(e) => setAlloc(i, 'invoice_id', e.target.value)}
              className="flex-1"
              aria-label={`Invoice for allocation ${i + 1}`}
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
              aria-label={`Amount in cents for allocation ${i + 1}`}
              className="w-40 bg-bg-2 border border-line px-3 py-2 text-ink tabular-nums"
            />
          </div>
        ))}
        <Button
          type="button"
          variant="secondary"
          onClick={addRow}
          className="self-start"
        >
          Add line
        </Button>

        {apply.error && (
          <p className="text-accent font-sans text-sm">
            {(apply.error as Error).message}
          </p>
        )}

        <div className="flex gap-2">
          <Button type="submit" disabled={apply.isPending}>
            {apply.isPending ? 'Applying.' : 'Apply'}
          </Button>
        </div>
      </form>
    </section>
  );
}
