import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { z } from 'zod';

import { useCreatePurchaseOrder } from '@/lib/hooks/usePurchaseOrders';

const FormSchema = z.object({
  vendor_id: z.string().uuid('Must be a vendor UUID'),
  po_number: z.string().optional(),
  currency_code: z.string().length(3),
  order_date: z.string().optional(),
  expected_date: z.string().optional(),
});

export function POCreatePage() {
  const navigate = useNavigate();
  const create = useCreatePurchaseOrder();
  const [vendorId, setVendorId] = useState('');
  const [poNumber, setPoNumber] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [orderDate, setOrderDate] = useState('');
  const [expectedDate, setExpectedDate] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const parsed = FormSchema.safeParse({
      vendor_id: vendorId,
      po_number: poNumber || undefined,
      currency_code: currency,
      order_date: orderDate || undefined,
      expected_date: expectedDate || undefined,
    });
    if (!parsed.success) {
      const fe: Record<string, string> = {};
      for (const issue of parsed.error.issues) fe[String(issue.path[0])] = issue.message;
      setErrors(fe);
      return;
    }
    setErrors({});
    const out = await create.mutateAsync({
      vendor_id: parsed.data.vendor_id,
      currency_code: parsed.data.currency_code,
      po_number: parsed.data.po_number ?? null,
      ...(parsed.data.order_date ? { order_date: parsed.data.order_date } : {}),
      ...(parsed.data.expected_date ? { expected_date: parsed.data.expected_date } : {}),
    });
    navigate(`/3pl-operations/purchase-orders/${out.id}`);
  }

  return (
    <section className="px-8 py-12 max-w-2xl mx-auto flex flex-col gap-6">
      <h1 className="text-4xl font-display tracking-wide text-ink">NEW PURCHASE ORDER</h1>
      <form onSubmit={onSubmit} className="flex flex-col gap-4 font-sans text-sm">
        <Field label="Vendor ID" error={errors.vendor_id}>
          <input value={vendorId} onChange={(e) => setVendorId(e.target.value)} className="border border-line bg-bg-2 px-3 py-2 text-ink" />
        </Field>
        <Field label="PO number" error={errors.po_number}>
          <input value={poNumber} onChange={(e) => setPoNumber(e.target.value)} className="border border-line bg-bg-2 px-3 py-2 text-ink" />
        </Field>
        <Field label="Currency" error={errors.currency_code}>
          <input value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())} maxLength={3} className="border border-line bg-bg-2 px-3 py-2 text-ink" />
        </Field>
        <Field label="Order date (YYYY-MM-DD)" error={errors.order_date}>
          <input type="date" value={orderDate} onChange={(e) => setOrderDate(e.target.value)} className="border border-line bg-bg-2 px-3 py-2 text-ink" />
        </Field>
        <Field label="Expected date" error={errors.expected_date}>
          <input type="date" value={expectedDate} onChange={(e) => setExpectedDate(e.target.value)} className="border border-line bg-bg-2 px-3 py-2 text-ink" />
        </Field>
        <button type="submit" disabled={create.isPending} className="self-start px-4 py-2 bg-accent text-on-primary">
          {create.isPending ? 'Saving.' : 'Create'}
        </button>
      </form>
    </section>
  );
}

function Field({ label, error, children }: { label: string; error?: string | undefined; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-ink-dim">{label}</span>
      {children}
      {error ? <span className="text-accent text-xs">{error}</span> : null}
    </label>
  );
}
