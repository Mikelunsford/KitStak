import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

import {
  LineItemsEditor,
  draftToPostBody,
  type LineDraft,
} from '@/components/forms/LineItemsEditor';
import { Button } from '@/components/ui/Button';
import { PageHeader } from '@/components/ui/PageHeader';
import { Select } from '@/components/ui/Select';
import { TextInput } from '@/components/ui/TextInput';
import { CustomerPicker, ProjectPicker } from '@/components/ui/pickers';
import { useCreateShipment } from '@/lib/hooks/useOps';
import { useWarehousesList } from '@/lib/hooks/useInventory';
import { useProject } from '@/lib/hooks/useProjects';
import { createShipmentLineItem } from '@/lib/services/shipmentLineItemsService';
import { parseProjectIdParam } from '@/lib/urlParams';
import type { Shipment } from '@/lib/types/vendors_inventory_ops';

import { deriveShipmentCustomerFromProject } from './deriveShipmentCustomerFromProject';

/**
 * ShipmentCreatePage. Closes G-SHIP-FORM-01 plus G-SHIP-LINES-01 (the
 * Phase 7 follow-up to retire the raw-JSON line textarea — bug B3 from
 * the 2026-05-21 E2E smoke walk, journal entry
 * `03-workspace/journal/2026-05-21-e2e-smoke-investigation.md`).
 *
 * Operator picks the warehouse, optional customer, optional project, plus
 * a structured list of line items via the shared `LineItemsEditor`. The
 * flow is two-stage: POST the header to `/shipments` (no line payload
 * accepted by the create schema), then POST each staged line to
 * `/shipments/:id/line-items`. This mirrors the working detail-page
 * editor (`ShipmentDetailPage.tsx`).
 *
 * project_id is sent at top level. F-Wave9-AUDIT-V3-WAVE-C2-01 wired the
 * ops-api ShipmentCreate Zod schema to accept it, so the value is now
 * persisted to the shipments row instead of being silently stripped.
 * F-Wave9-AUDIT-V3-WAVE-C3-01 hardens the deep-link prefill with a UUID
 * guard so a malformed `?project_id=` URL falls back to null.
 *
 * F-Wave10-UI-KIT-01: migrated to the shared UI kit (PageHeader replaces the
 * hand-rolled h1; the warehouse select uses the shared Select primitive).
 */
export function ShipmentCreatePage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const create = useCreateShipment();
  const warehouses = useWarehousesList();

  const prefilledCustomerId = searchParams.get('customer_id');
  // F-Wave9-AUDIT-V3-WAVE-C3-01: defend against malformed `?project_id=`
  // deep-link values so a bad URL falls back to null rather than poisoning
  // the picker or generating a 422 on submit. The server side (C2,
  // PR #133) accepts a UUID or null here on ShipmentCreate.
  const prefilledProjectId = parseProjectIdParam(searchParams.get('project_id'));

  // F-Wave9-AUTO-NUMBERING-01 (B8): the ops-api POST /shipments handler now
  // allocates SHP-YYYY-NNNNN via the numbering chassis when `shipment_number`
  // is absent, so the SPA no longer asks the operator to type it. Per-org
  // prefix / pad / reset policy is configurable from the numbering admin
  // page.
  const [warehouseId, setWarehouseId] = useState('');
  const [customerId, setCustomerId] = useState<string | null>(prefilledCustomerId);
  const [projectId, setProjectId] = useState<string | null>(prefilledProjectId);
  const [shipDate, setShipDate] = useState('');
  const [carrier, setCarrier] = useState('');
  const [trackingNumber, setTrackingNumber] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<LineDraft[]>([]);
  const [linesError, setLinesError] = useState<string | null>(null);
  const [submittingLines, setSubmittingLines] = useState(false);

  const warehouseOptions = useMemo(() => warehouses.data ?? [], [warehouses.data]);

  // B4 (Wave B): when the operator selects a project, auto-derive the
  // customer from that project's customer_id so the form stays
  // consistent without forcing two picks. Operator can still override
  // the CustomerPicker after; the effect only fires when the project
  // changes, and the pure helper deduplicates against the current
  // customer so a redundant setState does not loop.
  const project = useProject(projectId ?? undefined);
  useEffect(() => {
    // getProject returns a { project, phases } envelope; the customer
    // id lives on the inner row.
    const derived = deriveShipmentCustomerFromProject(
      project.data?.project,
      customerId,
    );
    if (derived) setCustomerId(derived);
  }, [project.data, customerId]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setLinesError(null);

    const body: Partial<Shipment> & {
      project_id?: string;
      customer_id?: string;
    } = {
      warehouse_id: warehouseId,
      payload: {},
    };
    if (customerId) body.customer_id = customerId;
    if (projectId) body.project_id = projectId;
    if (shipDate) body.ship_date = shipDate;
    if (carrier) body.carrier = carrier;
    if (trackingNumber) body.tracking_number = trackingNumber;
    if (notes) body.notes = notes;

    let createdId: string;
    try {
      const out = await create.mutateAsync(body);
      createdId = out.id;
    } catch {
      return;
    }

    if (lines.length > 0) {
      setSubmittingLines(true);
      try {
        for (const draft of lines) {
          await createShipmentLineItem(createdId, draftToPostBody(draft));
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'unknown error';
        setLinesError(
          `Header saved but a line failed: ${msg}. Edit the rest on the detail page.`,
        );
        setSubmittingLines(false);
        navigate(`/3pl-operations/shipments/${createdId}`);
        return;
      }
      setSubmittingLines(false);
    }

    navigate(`/3pl-operations/shipments/${createdId}`);
  }

  const pending = create.isPending || submittingLines;

  return (
    <section className="px-8 py-12 max-w-4xl mx-auto flex flex-col gap-6">
      <PageHeader eyebrow="Ship / Shipments" title="New shipment" />
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <label className="flex flex-col gap-2">
          <span className="font-sans text-sm text-ink-dim tracking-wide uppercase">
            Warehouse
            <span className="text-accent ml-1">*</span>
          </span>
          <Select
            value={warehouseId}
            onChange={(e) => setWarehouseId(e.target.value)}
            required
            disabled={warehouses.isLoading}
          >
            <option value="">
              {warehouses.isLoading ? 'Loading.' : 'Select a warehouse.'}
            </option>
            {warehouseOptions.map((w) => (
              <option key={w.id} value={w.id}>
                {w.code} · {w.display_name}
              </option>
            ))}
          </Select>
        </label>
        {/* B4 (Wave B): Project sits above Customer so the natural flow
            "pick the project this shipment is for, customer auto-fills"
            mirrors the operator's mental model. The effect above derives
            customer_id from the selected project; the operator can still
            override via the CustomerPicker below. */}
        <ProjectPicker
          value={projectId}
          onChange={setProjectId}
          label="Project (optional)"
          filter={customerId ? { customer_id: customerId } : undefined}
        />
        <CustomerPicker
          value={customerId}
          onChange={(v) => {
            setCustomerId(v);
            if (v !== customerId) setProjectId(null);
          }}
          label="Customer (optional)"
        />
        <TextInput
          label="Ship date"
          type="date"
          value={shipDate}
          onChange={(e) => setShipDate(e.target.value)}
        />
        <TextInput
          label="Carrier"
          value={carrier}
          onChange={(e) => setCarrier(e.target.value)}
        />
        <TextInput
          label="Tracking number"
          value={trackingNumber}
          onChange={(e) => setTrackingNumber(e.target.value)}
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
          mode="shipment"
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
            {pending ? 'Saving.' : 'Save shipment'}
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => navigate('/3pl-operations/shipments')}
          >
            Cancel
          </Button>
        </div>
      </form>
    </section>
  );
}
