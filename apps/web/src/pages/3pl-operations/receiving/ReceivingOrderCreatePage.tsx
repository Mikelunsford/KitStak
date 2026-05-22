import { useMemo, useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

import {
  LineItemsEditor,
  draftToPostBody,
  type LineDraft,
} from '@/components/forms/LineItemsEditor';
import { Button } from '@/components/ui/Button';
import { TextInput } from '@/components/ui/TextInput';
import { VendorPicker, ProjectPicker } from '@/components/ui/pickers';
import { useCreateReceivingOrder } from '@/lib/hooks/useOps';
import { useWarehousesList } from '@/lib/hooks/useInventory';
import { createReceivingOrderLineItem } from '@/lib/services/receivingOrderLineItemsService';
import type { ReceivingOrder } from '@/lib/types/vendors_inventory_ops';

/**
 * ReceivingOrderCreatePage. Closes G-RECV-FORM-01 plus G-RECV-LINES-01
 * (the Phase 7 follow-up to retire the raw-JSON line textarea — bug B3
 * from the 2026-05-21 E2E smoke walk, journal entry
 * `03-workspace/journal/2026-05-21-e2e-smoke-investigation.md`).
 *
 * Operator picks the warehouse and (optionally) the vendor and project
 * this receipt is bound to, plus a structured list of line items via the
 * shared `LineItemsEditor`. The flow is two-stage: POST the header to
 * `/receiving-orders` (no line payload accepted by the create schema),
 * then POST each staged line to `/receiving-orders/:id/line-items`. This
 * mirrors the working detail-page editor (`ReceivingOrderDetailPage.tsx`),
 * which is the only path the line-item endpoint has been validated
 * against.
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
  const [lines, setLines] = useState<LineDraft[]>([]);
  const [linesError, setLinesError] = useState<string | null>(null);
  const [submittingLines, setSubmittingLines] = useState(false);

  const warehouseOptions = useMemo(() => warehouses.data ?? [], [warehouses.data]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setLinesError(null);

    const body: Partial<ReceivingOrder> & {
      project_id?: string;
      purchase_order_id?: string;
      vendor_id?: string;
    } = {
      warehouse_id: warehouseId,
      // payload retained as a header-level object for forward compatibility
      // with the not-yet-normalised payload.lines path the trigger reads.
      // F-Wave7-LINES-DUAL-WRITE-DROP-01 already retired the dual-write
      // but the column is still present and harmless.
      payload: {},
    };
    if (receivingNumber) body.receiving_number = receivingNumber;
    if (vendorId) body.vendor_id = vendorId;
    if (projectId) body.project_id = projectId;
    if (purchaseOrderId) body.purchase_order_id = purchaseOrderId;
    if (expectedDate) body.expected_date = expectedDate;
    if (reference) body.reference = reference;
    if (notes) body.notes = notes;

    let createdId: string;
    try {
      const out = await create.mutateAsync(body);
      createdId = out.id;
    } catch {
      // The mutation hook exposes `.error` for render; nothing else to do.
      return;
    }

    // Stage 2: POST each staged line via the dedicated endpoint. Stop on
    // the first failure so the operator can review on the detail page and
    // re-add the remainder rather than silently dropping rows.
    if (lines.length > 0) {
      setSubmittingLines(true);
      try {
        for (const draft of lines) {
          await createReceivingOrderLineItem(createdId, draftToPostBody(draft));
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'unknown error';
        setLinesError(
          `Header saved but a line failed: ${msg}. Edit the rest on the detail page.`,
        );
        setSubmittingLines(false);
        navigate(`/3pl-operations/receiving/${createdId}`);
        return;
      }
      setSubmittingLines(false);
    }

    navigate(`/3pl-operations/receiving/${createdId}`);
  }

  const pending = create.isPending || submittingLines;

  return (
    <section className="px-8 py-12 max-w-4xl mx-auto flex flex-col gap-6">
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

        <LineItemsEditor
          lines={lines}
          onChange={setLines}
          mode="receiving"
          disabled={pending}
        />
        {linesError && (
          <p className="text-accent font-sans text-sm">{linesError}</p>
        )}

        {create.error && (
          <p className="text-accent font-sans text-sm">
            {(create.error as Error).message}
          </p>
        )}

        <div className="flex gap-2">
          <Button type="submit" disabled={pending}>
            {pending ? 'Saving.' : 'Save receiving order'}
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
