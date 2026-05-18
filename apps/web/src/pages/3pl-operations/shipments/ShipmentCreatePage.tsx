import { useMemo, useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

import { Button } from '@/components/ui/Button';
import { TextInput } from '@/components/ui/TextInput';
import { CustomerPicker, ProjectPicker } from '@/components/ui/pickers';
import { useCreateShipment } from '@/lib/hooks/useOps';
import { useWarehousesList } from '@/lib/hooks/useInventory';
import type { Shipment } from '@/lib/types/vendors_inventory_ops';

/**
 * ShipmentCreatePage. Closes G-SHIP-FORM-01. Operator picks the warehouse,
 * optional customer, optional project, plus a JSON line payload. Lines stay
 * in payload JSON per the operator decision to defer normalization
 * (G-SHIP-LINES-01) to Phase 7. project_id is sent at top level; the
 * ops-api ShipmentCreate Zod schema does not yet accept it, so the value
 * is silently stripped until the handler catches up.
 */
export function ShipmentCreatePage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const create = useCreateShipment();
  const warehouses = useWarehousesList();

  const prefilledCustomerId = searchParams.get('customer_id');
  const prefilledProjectId = searchParams.get('project_id');

  const [shipmentNumber, setShipmentNumber] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [customerId, setCustomerId] = useState<string | null>(prefilledCustomerId);
  const [projectId, setProjectId] = useState<string | null>(prefilledProjectId);
  const [shipDate, setShipDate] = useState('');
  const [carrier, setCarrier] = useState('');
  const [trackingNumber, setTrackingNumber] = useState('');
  const [notes, setNotes] = useState('');
  const [linesJson, setLinesJson] = useState(
    '[\n  { "item_id": "", "name": "", "quantity": 0 }\n]',
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

    const body: Partial<Shipment> & {
      project_id?: string;
      customer_id?: string;
    } = {
      warehouse_id: warehouseId,
      payload: { lines },
    };
    if (shipmentNumber) body.shipment_number = shipmentNumber;
    if (customerId) body.customer_id = customerId;
    if (projectId) body.project_id = projectId;
    if (shipDate) body.ship_date = shipDate;
    if (carrier) body.carrier = carrier;
    if (trackingNumber) body.tracking_number = trackingNumber;
    if (notes) body.notes = notes;

    const out = await create.mutateAsync(body);
    navigate(`/3pl-operations/shipments/${out.id}`);
  }

  return (
    <section className="px-8 py-12 max-w-2xl mx-auto flex flex-col gap-6">
      <h1 className="text-4xl font-display tracking-wide text-ink">
        NEW SHIPMENT
      </h1>
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <TextInput
          label="Shipment number"
          value={shipmentNumber}
          onChange={(e) => setShipmentNumber(e.target.value)}
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
        <CustomerPicker
          value={customerId}
          onChange={(v) => {
            setCustomerId(v);
            if (v !== customerId) setProjectId(null);
          }}
          label="Customer (optional)"
        />
        <ProjectPicker
          value={projectId}
          onChange={setProjectId}
          label="Project (optional)"
          filter={customerId ? { customer_id: customerId } : undefined}
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
            {create.isPending ? 'Saving.' : 'Save shipment'}
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
