import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import { Button } from '@/components/ui/Button';
import { PageHeader } from '@/components/ui/PageHeader';
import { TextInput } from '@/components/ui/TextInput';
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
      onSuccess: () => navigate(`/purchasing/vendor-bills/${id}`),
    });
  }

  if (query.isLoading) {
    return <p className="px-8 py-10 font-sans text-ink-dim">Loading.</p>;
  }
  if (!query.data) {
    return (
      <p className="px-8 py-10 font-sans text-accent">Vendor bill not found.</p>
    );
  }

  return (
    <section className="mx-auto flex max-w-2xl flex-col gap-6 px-8 py-10">
      <PageHeader title="Edit vendor bill" />
      <form onSubmit={onSubmit} className="flex flex-col gap-4 font-sans">
        <TextInput
          label="Bill number"
          value={billNumber}
          onChange={(e) => setBillNumber(e.target.value)}
        />
        <TextInput
          label="Bill date"
          type="date"
          value={billDate}
          onChange={(e) => setBillDate(e.target.value)}
          required
        />
        <TextInput
          label="Due date"
          type="date"
          value={dueDate}
          onChange={(e) => setDueDate(e.target.value)}
        />
        <TextInput
          label="Currency"
          value={currency}
          onChange={(e) => setCurrency(e.target.value.toUpperCase())}
          maxLength={3}
          required
        />
        <DollarInput
          label="Subtotal"
          value={subtotalCents}
          onChange={setSubtotalCents}
        />
        <DollarInput label="Tax" value={taxCents} onChange={setTaxCents} />
        <DollarInput
          label="Total"
          value={totalCents}
          onChange={setTotalCents}
        />
        <TextInput
          label="Reference"
          value={reference}
          onChange={(e) => setReference(e.target.value)}
        />
        <label className="flex flex-col gap-2">
          <span className="font-sans text-sm text-ink-dim tracking-wide uppercase">
            Notes
          </span>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            className="bg-bg-2 border border-line text-ink px-4 py-3 font-sans focus:outline-none focus:border-accent"
          />
        </label>
        {error ? <p className="text-accent text-sm">{error}</p> : null}
        {update.error ? (
          <p className="text-accent text-sm">
            {update.error instanceof Error
              ? update.error.message
              : 'Failed to save.'}
          </p>
        ) : null}
        <Button type="submit" disabled={update.isPending} className="self-start">
          {update.isPending ? 'Saving.' : 'Save'}
        </Button>
      </form>
    </section>
  );
}
