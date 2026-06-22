import { useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

import { Button } from '@/components/ui/Button';
import { PageHeader } from '@/components/ui/PageHeader';
import { TextInput } from '@/components/ui/TextInput';
import { DollarInput } from '@/components/forms/DollarInput';
import { VendorPicker } from '@/components/ui/pickers';
import { CurrencyField } from '@/components/ui/CurrencyField';
import { useCreateVendorBill } from '@/lib/hooks/useVendorBills';
import type { VendorBill } from '@/lib/types/vendors_inventory_ops';

/**
 * VendorBillCreatePage. Closes G-VB-FORM-01. Captures the bill header
 * (vendor, optional PO link, bill number, dates, currency, totals) so an
 * operator can record an inbound vendor invoice in one step. Vendor bills
 * have no normalized line-items table today (vendor_bill_line_items does
 * not exist in the schema), so totals are captured directly. A line-items
 * surface lands once the schema grows that table; this page is the seam.
 */
export function VendorBillCreatePage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const create = useCreateVendorBill();

  const prefilledVendorId = searchParams.get('vendor_id');
  const prefilledPoId = searchParams.get('purchase_order_id');

  const [billNumber, setBillNumber] = useState('');
  const [vendorId, setVendorId] = useState<string | null>(prefilledVendorId);
  const [purchaseOrderId, setPurchaseOrderId] = useState(prefilledPoId ?? '');
  const [billDate, setBillDate] = useState(
    new Date().toISOString().slice(0, 10),
  );
  const [dueDate, setDueDate] = useState('');
  const [currency, setCurrency] = useState('USD');
  // PR A2: cents fields hold integer cents via DollarInput.
  const [subtotalCents, setSubtotalCents] = useState<number | null>(0);
  const [taxCents, setTaxCents] = useState<number | null>(0);
  const [totalCents, setTotalCents] = useState<number | null>(0);
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (!vendorId) {
      setError('Vendor is required.');
      return;
    }

    const body: Partial<VendorBill> = {
      vendor_id: vendorId,
      bill_date: billDate,
      currency_code: currency,
      subtotal_cents: String(subtotalCents ?? 0),
      tax_cents: String(taxCents ?? 0),
      total_cents: String(totalCents ?? 0),
    };
    if (billNumber) body.bill_number = billNumber;
    if (purchaseOrderId) body.purchase_order_id = purchaseOrderId;
    if (dueDate) body.due_date = dueDate;
    if (reference) body.reference = reference;
    if (notes) body.notes = notes;

    const out = await create.mutateAsync(body);
    navigate(`/purchasing/vendor-bills/${out.id}`);
  }

  return (
    <section className="px-8 py-12 max-w-2xl mx-auto flex flex-col gap-6">
      <PageHeader title="New vendor bill" />
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <TextInput
          label="Bill number"
          value={billNumber}
          onChange={(e) => setBillNumber(e.target.value)}
        />
        <VendorPicker
          value={vendorId}
          onChange={setVendorId}
          label="Vendor"
          required
        />
        <TextInput
          label="Purchase order id (optional)"
          value={purchaseOrderId}
          onChange={(e) => setPurchaseOrderId(e.target.value)}
          placeholder="optional uuid"
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
          required
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

        <details className="border border-line bg-bg-2/40">
          <summary className="px-4 py-2 cursor-pointer text-sm text-ink-dim tracking-wide uppercase">
            Advanced (optional)
          </summary>
          <div className="flex flex-col gap-4 p-4 border-t border-line">
            <CurrencyField value={currency} onChange={setCurrency} />
          </div>
        </details>

        {(error || create.error) && (
          <p className="text-accent font-sans text-sm">
            {error ?? (create.error as Error).message}
          </p>
        )}

        <div className="flex gap-2">
          <Button type="submit" disabled={create.isPending}>
            {create.isPending ? 'Saving.' : 'Save vendor bill'}
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => navigate('/purchasing/vendor-bills')}
          >
            Cancel
          </Button>
        </div>
      </form>
    </section>
  );
}
