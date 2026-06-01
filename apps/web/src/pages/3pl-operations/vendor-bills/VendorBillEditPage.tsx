import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import { DollarInput } from '@/components/forms/DollarInput';
import { useVendorBill, useUpdateVendorBill } from '@/lib/hooks/useVendorBills';
import { VendorBillPatchSchema } from '@/lib/types/vendors_inventory_ops';
import type { VendorBill } from '@/lib/types/vendors_inventory_ops';

export function VendorBillEditPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const query = useVendorBill(id);
  const update = useUpdateVendorBill(id ?? '');

  const [billNumber, setBillNumber] = useState('');
  const [billDate, setBillDate] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [subtotalCents, setSubtotalCents] = useState<number | null>(0);
  const [taxCents, setTaxCents] = useState<number | null>(0);
  const [totalCents, setTotalCents] = useState<number | null>(0);
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (query.data) {
      setBillNumber(query.data.bill_number ?? '');
      setBillDate(query.data.bill_date);
      setDueDate(query.data.due_date ?? '');
      setCurrency(query.data.currency_code);
      setSubtotalCents(Number(query.data.subtotal_cents));
      setTaxCents(Number(query.data.tax_cents));
      setTotalCents(Number(query.data.total_cents));
      setReference(query.data.reference ?? '');
      setNotes(query.data.notes ?? '');
    }
  }, [query.data]);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const draft = {
      bill_number: billNumber || null,
      bill_date: billDate,
      due_date: dueDate || null,
      currency_code: currency,
      subtotal_cents: String(subtotalCents ?? 0),
      tax_cents: String(taxCents ?? 0),
      total_cents: String(totalCents ?? 0),
      reference: reference || null,
      notes: notes || null,
    };
    const parsed = VendorBillPatchSchema.safeParse(draft);
    if (!parsed.success) {
      setError(parsed.error.issues.map((i) => i.message).join('; '));
      return;
    }
    // Zod has validated the shape; cast to the service Partial type.
    const patch: Partial<VendorBill> = parsed.data as Partial<VendorBill>;
    update.mutate(patch, {
      onSuccess: () => navigate(`/3pl-operations/vendor-bills/${id}`),
    });
  }

  if (query.isLoading) {
    return <p className="px-8 py-10 font-sans text-ink-dim">Loading.</p>;
  }
  if (!query.data) {
    return <p className="px-8 py-10 font-sans text-accent">Vendor bill not found.</p>;
  }

  return (
    <section className="px-8 py-10 max-w-2xl mx-auto flex flex-col gap-6">
      <h1 className="text-4xl font-display tracking-wide text-ink">EDIT VENDOR BILL</h1>
      <form onSubmit={onSubmit} className="flex flex-col gap-4 font-sans">
        <label className="flex flex-col gap-1">
          <span className="text-sm text-ink-dim">Bill number</span>
          <input
            type="text"
            value={billNumber}
            onChange={(e) => setBillNumber(e.target.value)}
            className="bg-bg-2 border border-line px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm text-ink-dim">Bill date</span>
          <input
            type="date"
            value={billDate}
            onChange={(e) => setBillDate(e.target.value)}
            required
            className="bg-bg-2 border border-line px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm text-ink-dim">Due date</span>
          <input
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            className="bg-bg-2 border border-line px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm text-ink-dim">Currency</span>
          <input
            type="text"
            value={currency}
            onChange={(e) => setCurrency(e.target.value.toUpperCase())}
            maxLength={3}
            required
            className="bg-bg-2 border border-line px-3 py-2"
          />
        </label>
        <DollarInput
          label="Subtotal"
          value={subtotalCents}
          onChange={setSubtotalCents}
        />
        <DollarInput
          label="Tax"
          value={taxCents}
          onChange={setTaxCents}
        />
        <DollarInput
          label="Total"
          value={totalCents}
          onChange={setTotalCents}
        />
        <label className="flex flex-col gap-1">
          <span className="text-sm text-ink-dim">Reference</span>
          <input
            type="text"
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            className="bg-bg-2 border border-line px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm text-ink-dim">Notes</span>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            className="bg-bg-2 border border-line px-3 py-2"
          />
        </label>
        {error ? <p className="text-accent text-sm">{error}</p> : null}
        {update.error ? (
          <p className="text-accent text-sm">
            {update.error instanceof Error ? update.error.message : 'Failed to save.'}
          </p>
        ) : null}
        <button
          type="submit"
          disabled={update.isPending}
          className="self-start px-4 py-2 bg-accent text-on-primary font-display tracking-wider disabled:opacity-50"
        >
          {update.isPending ? 'SAVING.' : 'SAVE'}
        </button>
      </form>
    </section>
  );
}
