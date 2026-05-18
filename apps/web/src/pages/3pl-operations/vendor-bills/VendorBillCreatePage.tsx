import { useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

import { Button } from '@/components/ui/Button';
import { TextInput } from '@/components/ui/TextInput';
import { VendorPicker } from '@/components/ui/pickers';
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
  const [subtotalCents, setSubtotalCents] = useState('0');
  const [taxCents, setTaxCents] = useState('0');
  const [totalCents, setTotalCents] = useState('0');
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
      subtotal_cents: subtotalCents,
      tax_cents: taxCents,
      total_cents: totalCents,
    };
    if (billNumber) body.bill_number = billNumber;
    if (purchaseOrderId) body.purchase_order_id = purchaseOrderId;
    if (dueDate) body.due_date = dueDate;
    if (reference) body.reference = reference;
    if (notes) body.notes = notes;

    const out = await create.mutateAsync(body);
    navigate(`/3pl-operations/vendor-bills/${out.id}`);
  }

  return (
    <section className="px-8 py-12 max-w-2xl mx-auto flex flex-col gap-6">
      <h1 className="text-4xl font-display tracking-wide text-ink">
        NEW VENDOR BILL
      </h1>
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
        <TextInput
          label="Currency"
          value={currency}
          onChange={(e) => setCurrency(e.target.value.toUpperCase())}
          maxLength={3}
          required
        />
        <TextInput
          label="Subtotal (cents)"
          value={subtotalCents}
          onChange={(e) => setSubtotalCents(e.target.value)}
          inputMode="numeric"
        />
        <TextInput
          label="Tax (cents)"
          value={taxCents}
          onChange={(e) => setTaxCents(e.target.value)}
          inputMode="numeric"
        />
        <TextInput
          label="Total (cents)"
          value={totalCents}
          onChange={(e) => setTotalCents(e.target.value)}
          inputMode="numeric"
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
            onClick={() => navigate('/3pl-operations/vendor-bills')}
          >
            Cancel
          </Button>
        </div>
      </form>
    </section>
  );
}
