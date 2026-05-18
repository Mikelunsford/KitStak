import { useMemo, useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

import { Button } from '@/components/ui/Button';
import { TextInput } from '@/components/ui/TextInput';
import { VendorPicker, ProjectPicker } from '@/components/ui/pickers';
import { useCreateReceivingOrder } from '@/lib/hooks/useOps';
import { useWarehousesList } from '@/lib/hooks/useInventory';
import type { ReceivingOrder } from '@/lib/types/vendors_inventory_ops';

/**
 * ReceivingOrderCreatePage. Closes G-RECV-FORM-01. Operator picks the
 * warehouse and (optionally) the vendor and project this receipt is bound
 * to, plus a free-form line payload edited as JSON. Normalized line storage
 * (G-RECV-LINES-01) is a Phase 7 follow-up; the ops-api handler stores the
 * payload object verbatim today, so this page exposes the same shape the
 * downstream stock-movement trigger already reads.
 *
 * Note: the new project_id column was added by migration 0046. The ops-api
 * ReceivingCreate Zod schema does not yet enumerate project_id, so the field
 * is sent at top level and silently stripped server-side until 6.5-B (or a
 * later wave) extends the create schema. The picker is wired now so the
 * carry-through lands once the handler catches up.
 */
export function ReceivingOrderCreatePage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const create = useCreateReceivingOrder();
  const warehouses = useWarehousesList();

  const prefilledVendorId = searchParams.get('vendor_id');
  const prefilledProjectId = searchParams.get('project_id');
  const prefilledPoId = searchParams.get('purchase_order_id');

  const [receivingNumber, setReceivingNumber] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [vendorId, setVendorId] = useState<string | null>(prefilledVendorId);
  const [projectId, setProjectId] = useState<string | null>(prefilledProjectId);
  const [purchaseOrderId, setPurchaseOrderId] = useState(prefilledPoId ?? '');
  const [expectedDate, setExpectedDate] = useState('');
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [linesJson, setLinesJson] = useState(
    '[\n  { "item_id": "", "name": "", "quantity_expected": 0 }\n]',
  );
  const [linesError, setLinesError] = useState<string | null>(null);

  const warehouseOptions = useMemo(() => warehouses.data ?? [], [warehouses.data]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setLinesError(null);

    let lines: unknown = [];
    const trimmed = linesJson.trim();
    if (trimmed.length > 0) {
      try {
        lines = JSON.parse(trimmed);
        if (!Array.isArray(lines)) {
          setLinesError('Lines must be a JSON array.');
          return;
        }
      } catch (err) {
        setLinesError(`Invalid JSON: ${(err as Error).message}`);
        return;
      }
    }

    const body: Partial<ReceivingOrder> & {
      project_id?: string;
      purchase_order_id?: string;
      vendor_id?: string;
    } = {
      warehouse_id: warehouseId,
      payload: { lines },
    };
    if (receivingNumber) body.receiving_number = receivingNumber;
    if (vendorId) body.vendor_id = vendorId;
    if (projectId) body.project_id = projectId;
    if (purchaseOrderId) body.purchase_order_id = purchaseOrderId;
    if (expectedDate) body.expected_date = expectedDate;
    if (reference) body.reference = reference;
    if (notes) body.notes = notes;

    const out = await create.mutateAsync(body);
    navigate(`/3pl-operations/receiving/${out.id}`);
  }

  return (
    <section className="px-8 py-12 max-w-2xl mx-auto flex flex-col gap-6">
      <h1 className="text-4xl font-display tracking-wide text-ink">
        NEW RECEIVING ORDER
      </h1>
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <TextInput
          label="Receiving number"
          value={receivingNumber}
          onChange={(e) => setReceivingNumber(e.target.value)}
        />
        <label className="flex flex-col gap-2">
          <span className="font-sans text-sm text-ink-dim tracking-wide uppercase">
            Warehouse
            <span className="text-accent ml-1">*</span>
          </span>
          <select
            value={warehouseId}
            onChange={(e) => setWarehouseId(e.target.value)}
            required
            disabled={warehouses.isLoading}
            className="bg-bg-2 border border-line text-ink px-4 py-3 font-sans focus:outline-none focus:border-accent disabled:opacity-50"
          >
            <option value="">
              {warehouses.isLoading ? 'Loading.' : 'Select a warehouse.'}
            </option>
            {warehouseOptions.map((w) => (
              <option key={w.id} value={w.id}>
                {w.code} · {w.display_name}
              </option>
            ))}
          </select>
        </label>
        <VendorPicker
          value={vendorId}
          onChange={setVendorId}
          label="Vendor (optional)"
        />
        <ProjectPicker
          value={projectId}
          onChange={setProjectId}
          label="Project (optional)"
        />
        <TextInput
          label="Purchase order id (optional)"
          value={purchaseOrderId}
          onChange={(e) => setPurchaseOrderId(e.target.value)}
          placeholder="optional uuid"
        />
        <TextInput
          label="Expected date"
          type="date"
          value={expectedDate}
          onChange={(e) => setExpectedDate(e.target.value)}
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
        <label className="flex flex-col gap-2">
          <span className="font-sans text-sm text-ink-dim tracking-wide uppercase">
            Lines (JSON array)
          </span>
          <textarea
            value={linesJson}
            onChange={(e) => setLinesJson(e.target.value)}
            rows={6}
            spellCheck={false}
            className="bg-bg-2 border border-line text-ink px-4 py-3 font-mono text-sm focus:outline-none focus:border-accent"
          />
          {linesError && (
            <span className="text-accent font-sans text-sm">{linesError}</span>
          )}
        </label>

        {create.error && (
          <p className="text-accent font-sans text-sm">
            {(create.error as Error).message}
          </p>
        )}

        <div className="flex gap-2">
          <Button type="submit" disabled={create.isPending}>
            {create.isPending ? 'Saving.' : 'Save receiving order'}
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => navigate('/3pl-operations/receiving')}
          >
            Cancel
          </Button>
        </div>
      </form>
    </section>
  );
}
